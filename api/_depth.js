// [ADD] 포인트 주변 수심(해저 지형) - 지역별로 가장 촘촘한 공개 자료를 골라 씁니다.
//  한국 연안: 국립해양조사원 자연과학용 수심(150m, 공공데이터포털 KHOA_API_KEY)
//  유럽 바다: EMODnet Bathymetry DTM(약 115m, ERDDAP)
//  미국·미국령(하와이·괌·사이판·푸에르토리코 등): NOAA NCEI DEM 모자이크(수 m~수십 m, 있는 곳만)
//  그 밖(호주·동남아 등): GMRT(Global Multi-Resolution Topography, GEBCO + 다중빔 조사 자료 합본)
//  결과: 포인트 중심 약 ±1.3km 정격자(z = 고도 m, 음수 = 수심) + 요약(300m 안 최대·평균, 1km 안 최대)
//  포인트마다 한 번 받으면 Redis에 오래(180일) 저장 - 지형은 거의 안 바뀌어요.
const { redisPipeline } = require('./_redis');

const HALF_LAT = 0.012; // 약 1.33km
const KEY_VER = 'depth:v1:';
// [ADD] 거친 해외 자료(GEBCO 수준)를 "원래 위치 그대로" 쓰기. true면 해안선(OSM)에 맞춘 평행 이동·가짜 육지 지우기·해안선 0m 잇기·산호초 보정을 모두 건너뛰어요.
//  보정은 칸마다 외부 서버(Overpass)에 의존해서, 일부 칸만 실패하면 이웃 칸과 위치가 어긋나 네모난 이음새가 생겼어요(예: 멕시코 소코로).
//  원본 그대로면 모든 칸이 같은 규칙이라 이음새가 없어요. 대신 해안 가까운 곳은 원본 자료(약 450m 칸) 정확도만큼 위성 사진 해안선과 어긋날 수 있어요.
//  예전 방식으로 되돌리려면 false로 바꾸세요.
const RAW_COARSE = true;
const SRC = {
  khoa: { name: '국립해양조사원 자연과학용 수심', short: 'KHOA', res: 150, license: '공공누리 제1유형' },
  emodnet: { name: 'EMODnet Bathymetry DTM', short: 'EMODnet', res: 115, license: 'CC BY 4.0' },
  noaa: { name: 'NOAA NCEI DEM Global Mosaic', short: 'NOAA', res: 0, license: 'Public domain' },
  gmrt: { name: 'GMRT (Global Multi-Resolution Topography)', short: 'GMRT', res: 0, license: 'CC BY 4.0' }
};

async function getText(url, opt = {}, ms = 15000) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { ...opt, signal: ctl.signal }); const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 120)}`); return t; }
  finally { clearTimeout(tm); }
}
const box = (lat, lon) => { const hl = HALF_LAT / Math.cos(lat * Math.PI / 180); return { s: lat - HALF_LAT, n: lat + HALF_LAT, w: lon - hl, e: lon + hl }; };
const inKorea = (lat, lon) => lat > 32 && lat < 39 && lon > 124 && lon < 132;
const inEmodnet = (lat, lon) => lat > 11 && lat < 90 && lon > -70.5 && lon < 43 && !(lon < -30 && lat < 55); // 유럽 바다 + 북대서양 일부
const inUsArea = (lat, lon) => (lon < -60 && lat > 15) || (lon < -150 && lat > 15 && lat < 30) || (lon > 144 && lon < 146.5 && lat > 13 && lat < 21) || (lon < -168 && lat < -10 && lat > -16) || (lon > -68 && lon < -64 && lat > 17 && lat < 19);

// 흩어진 점 → 정격자(가장 가까운 점, maxDist m 안)
function gridFromPoints(pts, b, dla, dlo, maxDist) {
  const rows = Math.round((b.n - b.s) / dla) + 1, cols = Math.round((b.e - b.w) / dlo) + 1;
  const kx = 111320 * Math.cos((b.s + b.n) / 2 * Math.PI / 180), H = new Map();
  pts.forEach(p => { const k = Math.floor((p[0] - b.s) / dla) + '_' + Math.floor((p[1] - b.w) / dlo); (H.get(k) || H.set(k, []).get(k)).push(p); });
  const z = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const la = b.s + i * dla, lo = b.w + j * dlo; let best = null, bd = 1e9;
    for (let a = i - 1; a <= i + 1; a++) for (let c = j - 1; c <= j + 1; c++) (H.get(a + '_' + c) || []).forEach(p => { const d = Math.hypot((p[0] - la) * 111320, (p[1] - lo) * kx); if (d < bd) { bd = d; best = p; } });
    z.push(best && bd <= maxDist ? Math.round(best[2] * 10) / 10 : null);
  }
  return { la0: b.s, lo0: b.w, dla, dlo, rows, cols, z };
}

// ── 국립해양조사원(150m, 약간 기울어진 격자 → 정격자로) ──
async function fromKhoa(b) {
  const key = process.env.KHOA_API_KEY; if (!key) return null;
  const r4 = v => v.toFixed(4), lat = (b.s + b.n) / 2;
  const page = async (no) => {
    const t = await getText(`https://apis.data.go.kr/1192136/waterDepth/GetWaterDepthApiService?serviceKey=${encodeURIComponent(key)}&type=json&ymin=${r4(b.s)}&ymax=${r4(b.n)}&xmin=${r4(b.w)}&xmax=${r4(b.e)}&pageNo=${no}&numOfRows=300`, {}, 12000);
    const j = JSON.parse(t), body = (j.response && j.response.body) || j.body || {}, head = (j.response && j.response.header) || j.header || {};
    if (head.resultCode && head.resultCode !== '00') { if (head.resultCode === '03') return { total: 0, rows: [] }; throw new Error(`${head.resultCode} ${head.resultMsg || ''}`); }
    let it = body.items && body.items.item; if (it && !Array.isArray(it)) it = [it];
    return { total: +body.totalCount || 0, rows: (it || []).map(x => [+x.lat, +x.lot, -(+x.dpwt)]).filter(r => r.every(Number.isFinite)) };
  };
  const first = await page(1); if (!first.total) return null;
  // [FIX] 예전엔 나머지 쪽을 한꺼번에(최대 19개) 요청하고 실패한 쪽은 조용히 빼서, 타일 일부가 통째로 비어 "육지"(검은 네모)로 그려졌어요.
  //  → 4개씩 나눠 받고, 실패하면 2번 더 시도, 그래도 실패하면 이 타일은 저장하지 않고 다음에 다시
  const rows = first.rows.slice(), pages = Math.min(40, Math.ceil(first.total / 300)), todo = Array.from({ length: pages - 1 }, (_, i) => i + 2);
  const one = async (no) => { for (let k = 0; ; k++) { try { return await page(no); } catch (e) { if (k >= 2) throw e; await new Promise(r => setTimeout(r, 600 * (k + 1))); } } };
  for (let i = 0; i < todo.length; i += 4) (await Promise.all(todo.slice(i, i + 4).map(one))).forEach(m => rows.push(...m.rows));
  if (rows.length < Math.min(first.total, pages * 300) * 0.95) throw new Error(`khoa partial ${rows.length}/${first.total}`);
  if (rows.length < 4) return null;
  // 지도 타일끼리 이어 붙도록 격자 시작점을 전 세계 공통 눈금(위도 0.00135°, 경도 0.0016°)에 맞춤
  const dla = 0.00135, dlo = 0.0016, gb = { s: Math.ceil(b.s / dla) * dla, n: b.n, w: Math.ceil(b.w / dlo) * dlo, e: b.e };
  return { src: 'khoa', res: 150, nullLand: true, kp: true, grid: gridFromPoints(rows, gb, dla, dlo, 110) };
}

// ── EMODnet(ERDDAP griddap CSV) ──
async function fromEmodnet(b) {
  const f = v => v.toFixed(5);
  const t = await getText(`https://erddap.emodnet.eu/erddap/griddap/dtm_2020_v2_e0bf_e7e4_5b8f.csv?elevation%5B(${f(b.s)}):1:(${f(b.n)})%5D%5B(${f(b.w)}):1:(${f(b.e)})%5D`, {}, 15000);
  const pts = t.split('\n').slice(2).map(l => l.split(',').map(Number)).filter(r => r.length === 3 && r.every(Number.isFinite));
  if (pts.length < 4 || pts.every(p => p[2] >= 0)) return null;
  const lats = [...new Set(pts.map(p => p[0]))].sort((a, c) => a - c), lons = [...new Set(pts.map(p => p[1]))].sort((a, c) => a - c);
  const li = new Map(lats.map((v, i) => [v, i])), lj = new Map(lons.map((v, i) => [v, i]));
  const z = new Array(lats.length * lons.length).fill(null);
  pts.forEach(p => { z[li.get(p[0]) * lons.length + lj.get(p[1])] = Math.round(p[2] * 10) / 10; });
  return { src: 'emodnet', res: 115, grid: { la0: lats[0], lo0: lons[0], dla: lats[1] - lats[0], dlo: lons[1] - lons[0], rows: lats.length, cols: lons.length, z } };
}

// ── NOAA DEM 모자이크(getSamples) - 고해상도(100m 이하)인 곳만 사용 ──
async function fromNoaa(b) {
  // 전 세계 공통 눈금(1/1200° ≈ 90m)의 점들을 1,000개씩 나눠 조회
  const d = 1 / 1200, la0 = Math.ceil(b.s / d) * d, lo0 = Math.ceil(b.w / d) * d;
  const rowsN = Math.floor((b.n - la0) / d) + 1, colsN = Math.floor((b.e - lo0) / d) + 1, pts = [];
  if (rowsN * colsN > 12000) return null;
  for (let i = 0; i < rowsN; i++) for (let j = 0; j < colsN; j++) pts.push([lo0 + j * d, la0 + i * d]);
  const chunks = []; for (let k = 0; k < pts.length; k += 1000) chunks.push(pts.slice(k, k + 1000));
  const res = await Promise.all(chunks.map(async (ch, ci) => {
    const body = new URLSearchParams({ f: 'json', geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', geometry: JSON.stringify({ points: ch, spatialReference: { wkid: 4326 } }) });
    const j = JSON.parse(await getText('https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/getSamples', { method: 'POST', body }, 20000));
    return (j.samples || []).map(s => ({ ...s, locationId: s.locationId + ci * 1000 }));
  }));
  const S = res.flat(); if (S.length < pts.length * 0.8) return null;
  const N = colsN;
  const resDeg = Math.max(...S.map(s => +s.resolution || 1)); // 가장 거친 칸 기준
  const resM = resDeg * 111320; if (!(resM <= 100)) return null; // GEBCO 수준(460m)이면 GMRT가 나아요
  const z = new Array(rowsN * colsN).fill(null);
  S.forEach(s => { const v = +s.value; if (Number.isFinite(v) && Math.abs(v) < 12000) z[s.locationId] = Math.round(v * 10) / 10; });
  return { src: 'noaa', res: Math.max(3, Math.round(resM)), grid: { la0, lo0, dla: d, dlo: d, rows: rowsN, cols: colsN, z } };
}

// ── GMRT(ESRI ASCII 격자, 위쪽 줄이 북쪽) ──
async function fromGmrt(b, opt = {}) {
  const q = `minlongitude=${b.w.toFixed(5)}&maxlongitude=${b.e.toFixed(5)}&minlatitude=${b.s.toFixed(5)}&maxlatitude=${b.n.toFixed(5)}&format=esriascii&resolution=high`;
  // [ADD] topo-mask = 실제 다중빔 조사(고해상도)가 있는 칸만 값이 있음 → 나머지는 GEBCO(약 450m)를 늘린 거친 값
  const [t, tm] = await Promise.all([getText(`https://www.gmrt.org/services/GridServer?${q}`, {}, 20000), (opt.mask === false ? Promise.resolve(null) : getText(`https://www.gmrt.org/services/GridServer?${q}&layer=topo-mask`, {}, 20000).catch(() => null))]);
  const L = t.trim().split('\n'), hd = {}; let k = 0;
  for (; k < L.length && /^[a-z_]+\s/i.test(L[k]); k++) { const [a, v] = L[k].trim().split(/\s+/); hd[a.toLowerCase()] = +v; }
  const cols = hd.ncols, rows = hd.nrows, cs = hd.cellsize, nod = hd.nodata_value; if (!cols || !rows || !cs) return null;
  const vals = L.slice(k).join(' ').trim().split(/\s+/).map(Number);
  const z = new Array(rows * cols).fill(null);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const v = vals[r * cols + c]; if (Number.isFinite(v) && v !== nod) z[(rows - 1 - r) * cols + c] = Math.round(v * 10) / 10; }
  let hiFrac = null;
  if (tm) { const mv = tm.trim().split('\n').filter(l => !/^[a-z_]+\s/i.test(l)).join(' ').trim().split(/\s+/).map(Number); let sea = 0, hi = 0;
    for (let i = 0; i < vals.length; i++) { if (!(vals[i] < 0) || vals[i] === nod) continue; sea++; if (Number.isFinite(mv[i]) && mv[i] !== nod) hi++; }
    hiFrac = sea ? hi / sea : 0; }
  return { src: 'gmrt', res: Math.round(cs * 111320), hiFrac, grid: { la0: hd.yllcorner + cs / 2, lo0: hd.xllcorner + cs / 2, dla: cs, dlo: cs, rows, cols, z } };
}

// 요약: 포인트에서 300m·1km 안 물(z<0) 칸의 최대·평균 수심, 포인트 지점 수심
function summarize(g, lat, lon) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180);
  const ring = (rm) => { let mx = 0, s = 0, n = 0; for (let i = 0; i < g.rows; i++) for (let j = 0; j < g.cols; j++) {
    const v = g.z[i * g.cols + j]; if (v == null || v >= 0) continue;
    const d = Math.hypot((g.la0 + i * g.dla - lat) * 111320, (g.lo0 + j * g.dlo - lon) * kx); if (d > rm) continue;
    mx = Math.max(mx, -v); s += -v; n++; } return n ? { max: Math.round(mx), avg: Math.round(s / n), n } : null; };
  let near = ring(300), wide = 300; if (!near) { near = ring(500); wide = 500; } // 좌표가 육지에 찍힌 포인트
  const far = ring(1000);
  // 포인트 지점(쌍선형, 네 칸 다 있을 때만)
  const fi = (lat - g.la0) / g.dla, fj = (lon - g.lo0) / g.dlo, i = Math.floor(fi), j = Math.floor(fj);
  let at = null;
  if (i >= 0 && j >= 0 && i < g.rows - 1 && j < g.cols - 1) { const q = [g.z[i * g.cols + j], g.z[i * g.cols + j + 1], g.z[(i + 1) * g.cols + j], g.z[(i + 1) * g.cols + j + 1]];
    if (q.every(v => v != null)) { const a = fi - i, c = fj - j; const v = q[0] * (1 - a) * (1 - c) + q[1] * (1 - a) * c + q[2] * a * (1 - c) + q[3] * a * c; at = v < 0 ? Math.round(-v) : 0; } }
  return near || far ? { max300: near && near.max, avg300: near && near.avg, radius: wide, max1k: far && far.max, at } : null;
}

// 격자에서 b(남북동서) 범위만 잘라내기
function cropGrid(g, b) {
  const i0 = Math.max(0, Math.floor((b.s - g.la0) / g.dla)), i1 = Math.min(g.rows - 1, Math.ceil((b.n - g.la0) / g.dla));
  const j0 = Math.max(0, Math.floor((b.w - g.lo0) / g.dlo)), j1 = Math.min(g.cols - 1, Math.ceil((b.e - g.lo0) / g.dlo));
  const rows = i1 - i0 + 1, cols = j1 - j0 + 1, z = new Array(rows * cols);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) z[i * cols + j] = g.z[(i0 + i) * g.cols + j0 + j];
  return { la0: g.la0 + i0 * g.dla, lo0: g.lo0 + j0 * g.dlo, dla: g.dla, dlo: g.dlo, rows, cols, z };
}
// 지역별 순서대로 시도 → 첫 성공
async function depthAt(lat, lon, opt = {}) {
  lat = +(+lat).toFixed(4); lon = +(+lon).toFixed(4);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ck = KEY_VER + lat + '_' + lon;
  const SF = await sigFor(box(lat, lon)), profs = SF.profs; let pf = SF.sig; // [ADD] 포인트 현지 지형 + 최소 수심 구역(바뀌면 다시 계산)
  if (!opt.fresh) { try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) { const o = JSON.parse(result); if (!(o.src === 'gmrt' && !o.sf8) && !(RAW_COARSE && o.coarse && !o.raw) && (o.pf || '') === pf) return o; } } catch (_) {} } // [FIX] 해외(GMRT) 옛 저장본은 위치 보정·가짜 육지 지우기 전이라 다시 계산
  const order = inKorea(lat, lon) ? [fromKhoa, fromGmrt] : inEmodnet(lat, lon) ? [fromEmodnet, fromGmrt] : inUsArea(lat, lon) ? [fromNoaa, fromGmrt] : [fromNoaa, fromGmrt];
  const errors = [];
  for (const fn of order) {
    try {
      const bx = box(lat, lon);
      let r, fix = {};
      if (fn === fromGmrt) { // [FIX] 지도 수심 타일과 똑같이: 해안선 기준 위치 보정 + 해안선 0m 연결(옮길 여유만큼 넓게 받아서 보정 후 잘라냄)
        const P = 0.02; r = await fn({ s: bx.s - P, n: bx.n + P, w: bx.w - P, e: bx.e + P });
        if (!r) continue;
        fix.coarse = !(r.hiFrac >= 0.5); fix.sf4 = true; fix.sf5 = true; fix.sf6 = true; fix.sf7 = true; fix.sf8 = true;
        if (fix.coarse && RAW_COARSE) { fix.raw = true; fix.coastFixed = true; }
        else if (fix.coarse) {
          const n = 2 ** DTILE_Z, tx = Math.floor((lon + 180) / 360 * n), rr = lat * Math.PI / 180, ty = Math.floor((1 - Math.log(Math.tan(rr) + 1 / Math.cos(rr)) / Math.PI) / 2 * n);
          try { await warpByShiftField(r.grid, tx, ty); const A = await areaControls(tx, ty); landFix(r.grid, A.segsAll); shoreTaper(r.grid, A.segsAll); try { reefFix(r.grid, await reefSegs(tx, ty)); } catch (_) {} fix.coastFixed = true; }
          catch (e) { fix.coastFixed = false; }
          delete r.grid._segs; delete r.grid._segsAll;
        }
        r.grid = cropGrid(r.grid, bx);
      } else r = await fn(bx);
      if (!r) continue;
      if (profs.length) { try { const n2 = 2 ** DTILE_Z, ttx = Math.floor((lon + 180) / 360 * n2), rr2 = lat * Math.PI / 180, tty = Math.floor((1 - Math.log(Math.tan(rr2) + 1 / Math.cos(rr2)) / Math.PI) / 2 * n2);
        applyProfiles(r.grid, profs, (await areaControls(ttx, tty)).segsAll); fix.pf = pf; } catch (_) { fix.pf = ''; } } // 포인트 현지 지형
      if (SF.fixes.length) applyFixes(r.grid, SF.fixes); if (fix.pf === undefined) fix.pf = pf; // [ADD] 최소 수심 구역
      const sum = summarize(r.grid, lat, lon);
      if (!sum) continue;
      const out = { ok: true, lat, lon, src: r.src, srcName: SRC[r.src].name, srcShort: SRC[r.src].short, license: SRC[r.src].license, res: r.res, ...sum, ...fix, grid: r.grid, saved: Date.now() };
      try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String(fix.coarse && !fix.coastFixed ? 3600 : 180 * 86400)]]); } catch (_) {}
      return out;
    } catch (e) { errors.push(fn.name + ': ' + String(e && e.message || e).replace(/serviceKey=[^&\s]+/g, 'serviceKey=***').slice(0, 160)); }
  }
  return { ok: false, lat, lon, errors };
}

// [ADD] 거친 수심(GMRT 중 GEBCO 수준) "영점 맞추기" - OpenStreetMap 해안선 기준으로 격자 위치만 바로잡기(아래 coastShift)
//  해안선: Overpass API(OSM, ODbL) way["natural"="coastline"]. OSM 규칙상 선의 진행 방향 왼쪽이 육지예요.
async function coastSegments(b) {
  const q = `[out:json][timeout:25];way["natural"="coastline"](${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)});out geom;`;
  const t = await getText('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'otemp.app depth layer' } }, 25000);
  const j = JSON.parse(t), segs = [];
  (j.elements || []).forEach(w => { const g = w.geometry || []; for (let i = 1; i < g.length; i++) if (g[i - 1] && g[i]) segs.push([g[i - 1].lat, g[i - 1].lon, g[i].lat, g[i].lon]); });
  return segs;
}
// [CHANGE] 거친 수심 "영점 맞추기" = 값을 고치지 않고 격자 전체를 옮기기(평행 이동)만 해요.
//  OpenStreetMap 해안선(선의 왼쪽이 육지)을 기준으로, 격자를 동서남북 ±1.5km 안에서 50m씩 옮겨 보며
//  "해안선 위는 얕고, 해안에서 바다 쪽 300m는 깊은" 위치를 찾아 그만큼 옮겨요. 수심 값 자체는 원래 자료 그대로예요.
function coastShift(g, segs) {
  if (!segs.length) return null;
  const lat0 = g.la0 + (g.rows - 1) * g.dla / 2, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  // 해안선 위 점(약 60m 간격)과, 그 점에서 바다 쪽(선의 오른쪽)으로 300m 떨어진 점
  const coast = [], sea = [];
  segs.forEach(s => {
    const x1 = s[1] * kx, y1 = s[0] * ky, x2 = s[3] * kx, y2 = s[2] * ky, L = Math.hypot(x2 - x1, y2 - y1); if (!L) return;
    const nx = (y2 - y1) / L, ny = -(x2 - x1) / L; // 오른쪽(바다) 방향
    for (let d = 0; d < L; d += 60) { const x = x1 + (x2 - x1) * d / L, y = y1 + (y2 - y1) * d / L; coast.push([x, y]); sea.push([x + nx * 300, y + ny * 300]); }
  });
  if (coast.length < 5) return null;
  const step = Math.max(1, Math.floor(coast.length / 600)); // 점이 너무 많으면 골고루 줄이기
  const C = coast.filter((_, i) => i % step === 0), Sx = sea.filter((_, i) => i % step === 0);
  const z = (x, y) => { // 미터 좌표 → 격자 값(쌍선형, 밖이면 NaN, 빈 칸=육지 +2)
    const fi = (y / ky - g.la0) / g.dla, fj = (x / kx - g.lo0) / g.dlo; if (fi < 0 || fj < 0 || fi > g.rows - 1 || fj > g.cols - 1) return NaN;
    const i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j, G = (r, c) => { const v = g.z[r * g.cols + c]; return v == null ? 2 : v; };
    return G(i, j) * (1 - a) * (1 - b) + G(i, j + 1) * (1 - a) * b + G(i + 1, j) * a * (1 - b) + G(i + 1, j + 1) * a * b; };
  const score = (dx, dy) => { // 작을수록 좋음: 해안선 위 수심(얕을수록) - 0.5 × 바다 쪽 300m 수심(깊을수록)
    let a = 0, n = 0, w = 0, m = 0;
    for (let k = 0; k < C.length; k++) { const v = z(C[k][0] - dx, C[k][1] - dy), u = z(Sx[k][0] - dx, Sx[k][1] - dy);
      if (!isNaN(v)) { a += Math.max(0, -v); n++; } if (!isNaN(u)) { w += Math.max(0, -u); m++; } }
    return n < 5 || m < 5 ? Infinity : a / n - 0.5 * w / m; };
  const base = score(0, 0); let best = { dx: 0, dy: 0, s: base };
  for (let dx = -1500; dx <= 1500; dx += 100) for (let dy = -1500; dy <= 1500; dy += 100) { const s = score(dx, dy); if (s < best.s) best = { dx, dy, s }; }
  for (let dx = best.dx - 100; dx <= best.dx + 100; dx += 25) for (let dy = best.dy - 100; dy <= best.dy + 100; dy += 25) { const s = score(dx, dy); if (s < best.s) best = { dx, dy, s }; }
  // 확실히 나아질 때만 옮김(점수 차 1.5m 이상)
  if (!(base - best.s >= 1.5) || (!best.dx && !best.dy)) return { dx: 0, dy: 0, moved: false };
  g.la0 += best.dy / ky; g.lo0 += best.dx / kx;
  return { dx: best.dx, dy: best.dy, moved: true };
}

// [ADD] 옮길 거리는 칸(약 4km)마다 따로 정하면 이웃 칸과 어긋나서, 더 큰 구역(웹 메르카토르 줌 11, 한 변 약 18km) 하나에
//  한 번만 정하고 그 안의 모든 칸이 같은 거리만큼 옮겨요. 구역 전체의 해안선을 다 써서 더 안정적이에요. 결과는 180일 저장.
async function blockShift(lat, lon) {
  const Z = 11, n = 2 ** Z, bx = Math.floor((lon + 180) / 360 * n), r = lat * Math.PI / 180, by = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  const ck = `dshift:v1:${bx}_${by}`;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {}
  const LON = (v) => v / n * 360 - 180, LAT = (v) => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
  const bb = { s: LAT(by + 1) - 0.015, n: LAT(by) + 0.015, w: LON(bx) - 0.015, e: LON(bx + 1) + 0.015 };
  const q = `minlongitude=${bb.w.toFixed(5)}&maxlongitude=${bb.e.toFixed(5)}&minlatitude=${bb.s.toFixed(5)}&maxlatitude=${bb.n.toFixed(5)}&format=esriascii&resolution=med`;
  const [t, segs] = await Promise.all([getText(`https://www.gmrt.org/services/GridServer?${q}`, {}, 25000), coastSegments(bb)]);
  const L = t.trim().split('\n'), hd = {}; let k = 0;
  for (; k < L.length && /^[a-z_]+\s/i.test(L[k]); k++) { const [a, v] = L[k].trim().split(/\s+/); hd[a.toLowerCase()] = +v; }
  const cols = hd.ncols, rows = hd.nrows, cs = hd.cellsize, nod = hd.nodata_value; if (!cols || !rows || !cs) throw new Error('gmrt block');
  const vals = L.slice(k).join(' ').trim().split(/\s+/).map(Number), z = new Array(rows * cols).fill(null);
  for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) { const v = vals[rr * cols + c]; if (Number.isFinite(v) && v !== nod) z[(rows - 1 - rr) * cols + c] = v; }
  const g = { la0: hd.yllcorner + cs / 2, lo0: hd.xllcorner + cs / 2, dla: cs, dlo: cs, rows, cols, z };
  const res = coastShift(g, segs) || { dx: 0, dy: 0, moved: false };
  const out = { dx: res.dx || 0, dy: res.dy || 0, moved: !!res.moved, segs: segs.length };
  try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String(180 * 86400)]]); } catch (_) {}
  return out;
}

// [CHANGE] 이동량은 "해안선 덩어리"마다 따로 재요(작은 섬 하나, 긴 해안은 약 3km씩 나눔).
//  각 덩어리 가운데에 "이만큼 옮기면 맞는다"는 점(기준점)을 두고, 지도 위 어느 곳이든 반경 2.4km 안 기준점들의 값을
//  가까울수록 크게 섞어서 옮겨요. 기준점에서 멀어지면(먼바다) 점점 0으로. 같은 기준점을 모든 칸이 같이 쓰니 칸 경계에서 이어져요.
//  수심 값은 원본 그대로, 위치만 옮김.
const CTL_R = 2400;
async function coastLines(b) {
  const q = `[out:json][timeout:25];way["natural"="coastline"](${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)});out geom;`;
  // [FIX] 해안선 서버가 바쁘면(429·504) 다른 공개 서버로. 오류 응답(remark)을 "해안선 없음"으로 저장하지 않게 실패 처리
  let j = null, last = null;
  for (const u of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try { const t = await getText(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'otemp.app depth layer' } }, 20000);
      const r = JSON.parse(t); if (r.remark && /error|timed out|runtime/i.test(r.remark)) throw new Error('overpass ' + r.remark.slice(0, 80)); j = r; break; }
    catch (e) { last = e; }
  }
  if (!j) throw last || new Error('overpass');
  const ways = (j.elements || []).map(w => (w.geometry || []).filter(Boolean).map(p => [p.lat, p.lon])).filter(l => l.length >= 2);
  // 끝점이 이어진 길끼리 합치기(섬 하나 = 한 덩어리)
  const K = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6), lines = ways.slice();
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < lines.length && !merged; i++) for (let j = 0; j < lines.length && !merged; j++) {
      if (i === j) continue; const a = lines[i], c = lines[j];
      if (K(a[a.length - 1]) === K(c[0])) { lines[i] = a.concat(c.slice(1)); lines.splice(j, 1); merged = true; }
    }
  }
  return lines;
}
// [FIX] 주변 3×3칸의 기준점을 한 번에: 저장 안 된 칸들만 모아서 해안선 1번 + 수심 1번 받아 계산(예전엔 칸마다 따로 받아 느리고 자주 실패,
//  실패해도 조용히 넘어가서 기준점 없이 저장되는 문제가 있었어요). 하나라도 실패하면 오류 → 보정 안 된 그림은 짧게만 보관
async function areaControls(x, y) {
  const keys = []; for (const j of [-1, 0, 1]) for (const i of [-1, 0, 1]) keys.push([x + i, y + j]);
  const ck = (k) => `tctl:v3:${k[0]}_${k[1]}`, got = {}; // v3 = { c: 기준점, s: 이 칸 근처 해안선 조각 }
  try { const rs = await redisPipeline(keys.map(k => ['GET', ck(k)])); rs.forEach((r, i) => { if (r && r.result) got[i] = JSON.parse(r.result); }); } catch (_) {}
  const miss = keys.map((k, i) => i).filter(i => !got[i]);
  if (miss.length) {
    const boxes = miss.map(i => tileBox(keys[i][0], keys[i][1])), P = 0.03;
    const b = { s: Math.min(...boxes.map(t => t.s)) - P, n: Math.max(...boxes.map(t => t.n)) + P, w: Math.min(...boxes.map(t => t.w)) - P, e: Math.max(...boxes.map(t => t.e)) + P };
    const lines = await coastLines(b);
    const kx = Math.cos((b.s + b.n) / 2 * Math.PI / 180) * 111320, ky = 111320;
    // 덩어리 나누기: 둘레 6km 이하는 통째로(섬 하나), 긴 해안은 3km씩
    const chunks = [];
    lines.forEach(l => {
      let len = 0; for (let i = 1; i < l.length; i++) len += Math.hypot((l[i][1] - l[i - 1][1]) * kx, (l[i][0] - l[i - 1][0]) * ky);
      if (len <= 6000) { chunks.push(l); return; }
      let cur = [l[0]], acc = 0;
      for (let i = 1; i < l.length; i++) { const d = Math.hypot((l[i][1] - l[i - 1][1]) * kx, (l[i][0] - l[i - 1][0]) * ky); cur.push(l[i]); acc += d;
        if (acc >= 3000) { chunks.push(cur); cur = [l[i]]; acc = 0; } }
      if (cur.length >= 2) chunks.push(cur);
    });
    const cs = chunks.map(c => ({ c, la: c.reduce((a, p) => a + p[0], 0) / c.length, lo: c.reduce((a, p) => a + p[1], 0) / c.length }));
    let r = null; const need = miss.some((i, n) => cs.some(o => { const t = boxes[n]; return o.la >= t.s && o.la < t.n && o.lo >= t.w && o.lo < t.e; }));
    if (need) { r = await fromGmrt(b, { mask: false }); if (!r) throw new Error('gmrt'); }
    const sets = [];
    miss.forEach((i, n) => {
      const t = boxes[n], ctl = [];
      cs.filter(o => o.la >= t.s && o.la < t.n && o.lo >= t.w && o.lo < t.e).forEach(o => { // 가운데가 이 칸 안인 덩어리만 이 칸이 맡음
        const segs = []; for (let k = 1; k < o.c.length; k++) segs.push([o.c[k - 1][0], o.c[k - 1][1], o.c[k][0], o.c[k][1]]);
        const m = coastShift(Object.assign({}, r.grid), segs);
        if (m) ctl.push({ la: +o.la.toFixed(5), lo: +o.lo.toFixed(5), dx: m.dx, dy: m.dy, n: segs.length });
      });
      // 이 칸 근처(약 650m 여유) 해안선 조각도 같이 저장 → 해안선 = 0m 기준으로 쓰기
      const E = 0.006, inb = (la, lo) => la >= t.s - E && la <= t.n + E && lo >= t.w - E && lo <= t.e + E, sg = [];
      lines.forEach(l => { for (let k = 1; k < l.length; k++) if (inb(l[k - 1][0], l[k - 1][1]) || inb(l[k][0], l[k][1])) sg.push(q5(l[k - 1][0]), q5(l[k - 1][1]), q5(l[k][0]), q5(l[k][1])); });
      got[i] = { c: ctl, s: sg }; sets.push(['SET', ck(keys[i]), JSON.stringify(got[i]), 'EX', String(180 * 86400)]);
    });
    try { await redisPipeline(sets); } catch (_) {}
  }
  const seg4 = (a) => { const o = []; for (let k = 0; k + 3 < (a || []).length; k += 4) o.push([a[k], a[k + 1], a[k + 2], a[k + 3]]); return o; };
  return { ctl: keys.map((k, i) => (got[i] && got[i].c) || []).flat(), segs: seg4(got[4] && got[4].s), segsAll: keys.map((k, i) => seg4(got[i] && got[i].s)).flat() };
}
// [ADD] 해안선 = 수심 0m. 거친 자료(약 450m 간격)는 작은 섬 바로 옆이 50m로 뭉개져 있어서, 해안선에서 500m 안쪽만
//  "해안선 0m ↔ 500m 지점의 원래 수심" 사이를 거리에 비례해 이어 줘요(그 바깥은 원래 값 그대로). 해안선 안쪽(선의 왼쪽)은 육지로.
const SHORE_W = 500;
function shoreTaper(g, segs) {
  if (!segs.length) return 0;
  const lat0 = g.la0 + (g.rows - 1) * g.dla / 2, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  const S = segs.map(s => [(s[1] - g.lo0) * kx, (s[0] - g.la0) * ky, (s[3] - g.lo0) * kx, (s[2] - g.la0) * ky]);
  const B = 250, bins = new Map(), key = (a, b) => a + '_' + b;
  S.forEach((s, i) => { const n = Math.max(1, Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / (B / 2)));
    for (let k = 0; k <= n; k++) { const kk = key(Math.floor((s[0] + (s[2] - s[0]) * k / n) / B), Math.floor((s[1] + (s[3] - s[1]) * k / n) / B)); (bins.get(kk) || bins.set(kk, []).get(kk)).push(i); } });
  let changed = 0;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const px = c * g.dlo * kx, py = r * g.dla * ky, bx = Math.floor(px / B), by = Math.floor(py / B);
    let best = Infinity, side = 0;
    for (let ix = bx - 3; ix <= bx + 3; ix++) for (let iy = by - 3; iy <= by + 3; iy++) { const L = bins.get(key(ix, iy)); if (!L) continue;
      for (const i of L) { const s = S[i], dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1, tt = Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / L2));
        const d = Math.hypot(px - s[0] - dx * tt, py - s[1] - dy * tt); if (d < best) { best = d; side = dx * (py - s[1]) - dy * (px - s[0]); } } }
    if (!(best < SHORE_W)) continue;
    const i = r * g.cols + c, v = g.z[i];
    if (side > 0) { if (v == null || v < 0) { g.z[i] = 2; changed++; } continue; } // 육지
    const f = best / SHORE_W; // 0(해안선) ~ 1(500m)
    g.z[i] = v == null || v >= 0 ? -Math.max(0.5, 10 * f) : Math.min(-0.5, v * f); changed++;
  }
  return changed;
}
// [ADD] 가짜 육지 지우기: 거친 자료(GMRT)는 섬 위치가 어긋나 있어서, 옮긴 뒤에도 옆 칸에 섬 조각(육지 값)이 남아
//  "없는 섬"처럼 보였어요(예: 멕시코 San Benedicto 동쪽). 육지 값인 칸마다 가장 가까운 OSM 해안선(4km 안)을 찾아
//  그 선의 바다 쪽이면 가짜 육지 → 둘레 바다 수심으로 채워요. 해안선을 못 찾으면(내륙 깊숙한 곳) 그대로 둬요.
function landFix(g, segs) {
  if (!segs || !segs.length) return 0;
  const lat0 = g.la0 + (g.rows - 1) * g.dla / 2, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  const S = segs.map(s => [(s[1] - g.lo0) * kx, (s[0] - g.la0) * ky, (s[3] - g.lo0) * kx, (s[2] - g.la0) * ky]);
  const B = 400, R = 4000, NB = Math.ceil(R / B), bins = new Map(), key = (a, b) => a + '_' + b;
  S.forEach((s, i) => { const n = Math.max(1, Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / (B / 2)));
    for (let k = 0; k <= n; k++) { const kk = key(Math.floor((s[0] + (s[2] - s[0]) * k / n) / B), Math.floor((s[1] + (s[3] - s[1]) * k / n) / B)); const L = bins.get(kk) || bins.set(kk, []).get(kk); if (L[L.length - 1] !== i) L.push(i); } });
  const fake = new Uint8Array(g.rows * g.cols); let nFake = 0, nLandFix = 0;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const i = r * g.cols + c, v = g.z[i];
    const isWater = !(v == null || v >= 0);
    const px = c * g.dlo * kx, py = r * g.dla * ky, bx = Math.floor(px / B), by = Math.floor(py / B);
    let best = Infinity, side = 0, perp = 0;
    for (let ix = bx - NB; ix <= bx + NB; ix++) for (let iy = by - NB; iy <= by + NB; iy++) { const L = bins.get(key(ix, iy)); if (!L) continue;
      for (const k of L) { const q = S[k], dx = q[2] - q[0], dy = q[3] - q[1], L2 = dx * dx + dy * dy || 1, tt = Math.max(0, Math.min(1, ((px - q[0]) * dx + (py - q[1]) * dy) / L2));
        const d = Math.hypot(px - q[0] - dx * tt, py - q[1] - dy * tt), sd = dx * (py - q[1]) - dy * (px - q[0]), pp = Math.abs(sd) / Math.sqrt(L2);
        // 꼭짓점에서 거리가 같으면 더 수직인 조각으로 판단(뾰족한 곳 오판 방지)
        if (d < best - 0.5 || (Math.abs(d - best) <= 0.5 && pp > perp)) { best = d; side = sd; perp = pp; } } }
    if (!isWater) { if (best <= R && side < 0 && best > 30) { fake[i] = 1; nFake++; } continue; } // 해안선 오른쪽(바다 쪽)인데 육지 값 → 가짜 육지
    // [ADD] 반대 경우: 해안선 왼쪽(육지 쪽)으로 60m 넘게 들어간 곳인데 바다 값 → 가짜 바다(육지 안 "호수 등고선", 예: 모알보알 Basdio 뒤 숲)
    if (best <= R && side > 0 && best > 60) { g.z[i] = 2; nLandFix++; }
  }
  if (!nFake) return nLandFix;
  // 둘레 바다 값 평균으로 채우기(안쪽으로 번져 가며)
  for (let pass = 0; pass < 80 && nFake; pass++) {
    const upd = [];
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) { const i = r * g.cols + c; if (!fake[i]) continue;
      let sum = 0, n = 0; for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= g.rows || cc >= g.cols) continue;
        const j = rr * g.cols + cc, w = g.z[j]; if (!fake[j] && w != null && w < 0) { sum += w; n++; } }
      if (n) upd.push([i, sum / n]); }
    if (!upd.length) break;
    upd.forEach(([i, v]) => { g.z[i] = Math.min(-1, v); fake[i] = 0; nFake--; });
  }
  for (let i = 0; i < fake.length; i++) if (fake[i]) g.z[i] = -20; // 남은 곳(둘레가 모두 가짜) - 드묾
  return 1;
}
// [ADD] 산호초(OSM natural=reef) 반영: 거친 자료는 섬 둘레 얕은 곳이 수백 m 넓게 뭉개져 있어서(발리카삭 등)
//  에메랄드색 리프 밖도 10m 안쪽으로 그려졌어요. OSM 리프 다각형 안쪽 = 리프 위(약 2m), 리프 끝에서 바깥으로는
//  150m 안에 6m → 20m로 빠르게 깊어지게(리프 벽) 바닥값을 두고, 600m까지 20m, 1.5km에서 10m까지 바닥값을 유지해요. 원래 자료가 더 깊으면 그대로.
async function reefSegs(x, y) {
  const ck = `reef:v1:${x}_${y}`;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {}
  const t = tileBox(x, y), P = 0.012, b = { s: t.s - P, n: t.n + P, w: t.w - P, e: t.e + P };
  const q = `[out:json][timeout:25];(way["natural"="reef"](${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)});rel["natural"="reef"](${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)}););out geom;`;
  let j = null, last = null;
  for (const u of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try { const tx = await getText(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'otemp.app depth layer' } }, 20000);
      const r = JSON.parse(tx); if (r.remark && /error|timed out|runtime/i.test(r.remark)) throw new Error('overpass ' + r.remark.slice(0, 80)); j = r; break; }
    catch (e) { last = e; }
  }
  if (!j) throw last || new Error('overpass');
  const segs = [], seen = new Set();
  const addLine = (geom, id) => { if (!geom || geom.length < 2 || (id && seen.has(id))) return; if (id) seen.add(id);
    for (let k = 1; k < geom.length; k++) { const a = geom[k - 1], c = geom[k]; if (!a || !c) continue; segs.push(q5(a.lat), q5(a.lon), q5(c.lat), q5(c.lon)); } };
  (j.elements || []).forEach(e => {
    if (e.type === 'way') addLine(e.geometry, 'w' + e.id);
    else if (e.type === 'relation') (e.members || []).forEach(m => { if (m.type === 'way' && (m.role === 'outer' || m.role === 'inner' || !m.role)) addLine(m.geometry, 'w' + m.ref); });
  });
  try { await redisPipeline([['SET', ck, JSON.stringify(segs), 'EX', String(180 * 86400)]]); } catch (_) {}
  return segs;
}
function reefFix(g, flat) {
  if (!flat || flat.length < 4) return 0;
  const lat0 = g.la0 + (g.rows - 1) * g.dla / 2, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  const S = []; for (let k = 0; k + 3 < flat.length; k += 4) S.push([(flat[k + 1] - g.lo0) * kx, (flat[k] - g.la0) * ky, (flat[k + 3] - g.lo0) * kx, (flat[k + 2] - g.la0) * ky]);
  const W0 = 150, W2 = 600, W1 = 1500, B = 200, NB = Math.ceil(W1 / B), bins = new Map(), key = (a, b) => a + '_' + b;
  S.forEach((q, i) => { const n = Math.max(1, Math.ceil(Math.hypot(q[2] - q[0], q[3] - q[1]) / (B / 2)));
    for (let k = 0; k <= n; k++) { const kk = key(Math.floor((q[0] + (q[2] - q[0]) * k / n) / B), Math.floor((q[1] + (q[3] - q[1]) * k / n) / B)); const L = bins.get(kk) || bins.set(kk, []).get(kk); if (L[L.length - 1] !== i) L.push(i); } });
  let changed = 0;
  for (let r = 0; r < g.rows; r++) {
    const py = r * g.dla * ky;
    const xs = []; S.forEach(q => { if ((q[1] > py) !== (q[3] > py)) xs.push(q[0] + (py - q[1]) / (q[3] - q[1]) * (q[2] - q[0])); }); // 이 줄을 가로지르는 리프 선(안쪽 판정용)
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c, v = g.z[i]; if (v == null || v >= 0) continue; // 육지는 그대로
      const px = c * g.dlo * kx;
      let inside = false; for (const x0 of xs) if (x0 > px) inside = !inside;
      if (inside) { if (v < -2) { g.z[i] = -2; changed++; } continue; }
      const bx = Math.floor(px / B), by = Math.floor(py / B); let best = Infinity;
      for (let ix = bx - NB; ix <= bx + NB; ix++) for (let iy = by - NB; iy <= by + NB; iy++) { const L = bins.get(key(ix, iy)); if (!L) continue;
        for (const k of L) { const q = S[k], dx = q[2] - q[0], dy = q[3] - q[1], L2 = dx * dx + dy * dy || 1, tt = Math.max(0, Math.min(1, ((px - q[0]) * dx + (py - q[1]) * dy) / L2));
          const d = Math.hypot(px - q[0] - dx * tt, py - q[1] - dy * tt); if (d < best) best = d; } }
      if (!(best < W1)) continue;
      // 리프 끝 6m → 150m에서 20m → 600m까지 20m → 1.5km에서 10m(그 바깥은 바닥값 없음)
      //  [FIX] 500m에서 바로 풀었더니 거친 자료가 섬을 뭉개 만든 얕은 테(약 1km)가 섬과 떨어진 "10m 안쪽 구역"으로 남았어요(발리카삭 북동쪽)
      const floor = best <= W0 ? 6 + 14 * best / W0 : best <= W2 ? 20 : 20 - 10 * (best - W2) / (W1 - W2);
      if (-v < floor) { g.z[i] = -floor; changed++; }
    }
  }
  return changed;
}
// [ADD] 포인트별 현지 지형(관리자 입력): 상단 수심(pTop) → 바닥 수심(pMax)까지 해안(리프 끝)에서 수평 pRun m 안에 떨어짐.
//  적용 범위: 포인트에서 pR m(기본 250m)까지는 그대로, 2배 거리까지 서서히 원래 자료로. 바닥 바깥 600m까지는 바닥 수심보다 얕아지지 않게.
//  공개 자료로는 직벽(예: 페스카도르 Skull Cave)이 표현되지 않아서, 다이버가 아는 지형으로 보완하는 용도예요.
let profMemo = null;
async function profSpots() {
  if (profMemo && Date.now() - profMemo.at < 60e3) return profMemo.list;
  let list = [];
  try { const [{ result }] = await redisPipeline([['HGETALL', 'spots:extra']]); const a = result || [];
    for (let i = 1; i < a.length; i += 2) { try { const o = JSON.parse(a[i]); const mx = +o.pMax, la = +o.lat, lo = +o.lon;
      if (!(mx > 0) || !Number.isFinite(la) || !Number.isFinite(lo) || o.show === false) continue;
      list.push({ no: +o.no, lat: la, lon: lo, top: Math.max(0, +o.pTop || 0), max: mx, run: Math.max(1, +o.pRun || 10), r: Math.max(50, +o.pR || 250),
        dir: o.pDir == null || o.pDir === '' || !Number.isFinite(+o.pDir) ? null : ((+o.pDir % 360) + 360) % 360, span: Math.max(20, Math.min(340, +o.pSpan || 90)), run2: Math.max(1, +o.pRun2 || 5) }); } catch (_) {} } } catch (_) { return profMemo ? profMemo.list : []; }
  profMemo = { at: Date.now(), list }; return list;
}
// 이 영역(위도·경도 상자)에 영향을 주는 포인트 지형 목록의 짧은 표시(앱 js/depth-layer.js와 같은 계산) - 바뀌면 다시 그림
function profIn(list, b) { const E = 0.02; return list.filter(p => p.lat >= b.s - E && p.lat <= b.n + E && p.lon >= b.w - E && p.lon <= b.e + E); }
function profSig(ps) { const str = ps.map(p => `${p.no}:${p.top}/${p.max}/${p.run}/${p.r}` + (p.dir != null ? `/${Math.round(p.dir)}/${p.span}/${p.run2}` : '')).sort().join(','); if (!str) return ''; let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(36); }
// [ADD] 최소 수심 구역(관리자 입력, Redis site:cfg의 depthFix): 원 안 바다는 min m보다 얕지 않게(바깥 25%는 서서히). 육지·해안 칸은 그대로.
let fixMemo = null;
async function fixSpots() {
  if (fixMemo && Date.now() - fixMemo.at < 60e3) return fixMemo.list;
  let list = [];
  try { const [{ result }] = await redisPipeline([['GET', 'site:cfg']]); const c = result ? JSON.parse(result) : {}; list = (Array.isArray(c.depthFix) ? c.depthFix : []).filter(f => f && Number.isFinite(+f.la) && Number.isFinite(+f.lo) && +f.r > 0 && +f.min > 0).map(f => ({ la: +f.la, lo: +f.lo, r: +f.r, min: +f.min })); }
  catch (_) { return fixMemo ? fixMemo.list : []; }
  fixMemo = { at: Date.now(), list }; return list;
}
function fixIn(list, b) { const E = 0.05; return list.filter(f => f.la >= b.s - E && f.la <= b.n + E && f.lo >= b.w - E && f.lo <= b.e + E); }
function fixSig(fs) { const str = fs.map(f => `${f.la}/${f.lo}/${f.r}/${f.min}`).sort().join(','); if (!str) return ''; let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return 'f' + h.toString(36); }
// 포인트 지형 + 최소 수심 구역의 합친 표시와 목록
async function sigFor(b) { const profs = profIn(await profSpots(), b), fixes = fixIn(await fixSpots(), b); return { profs, fixes, sig: profSig(profs) + fixSig(fixes) }; }
function applyFixes(g, fixes) {
  if (!fixes || !fixes.length) return 0;
  const kx = Math.cos((g.la0 + (g.rows - 1) * g.dla / 2) * Math.PI / 180) * 111320, ky = 111320; let n = 0;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const i = r * g.cols + c, v = g.z[i]; if (v == null || v >= 0) continue; // 바다 칸만
    const la = g.la0 + r * g.dla, lo = g.lo0 + c * g.dlo;
    for (const f of fixes) { const d = Math.hypot((lo - f.lo) * kx, (la - f.la) * ky); if (d >= f.r) continue;
      const w = d <= f.r * 0.75 ? 1 : (f.r - d) / (f.r * 0.25), want = -f.min * w; if (want < g.z[i]) { g.z[i] = want; n++; } } }
  return n;
}
function applyProfiles(g, ps, segs) {
  if (!ps.length || !segs || !segs.length) return 0;
  const lat0 = g.la0 + (g.rows - 1) * g.dla / 2, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  const S = segs.map(q => [(q[1] - g.lo0) * kx, (q[0] - g.la0) * ky, (q[3] - g.lo0) * kx, (q[2] - g.la0) * ky]);
  const near = (px, py, R) => { let best = Infinity, bb = 0; for (const q of S) { const dx = q[2] - q[0], dy = q[3] - q[1];
    if (Math.min(q[0], q[2]) - R > px || Math.max(q[0], q[2]) + R < px || Math.min(q[1], q[3]) - R > py || Math.max(q[1], q[3]) + R < py) continue;
    const L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - q[0]) * dx + (py - q[1]) * dy) / L2)), d = Math.hypot(px - q[0] - dx * t, py - q[1] - dy * t); if (d < best) { best = d; bb = (Math.atan2(dy, -dx) * 180 / Math.PI + 360) % 360; } } return best < Infinity ? { d: best, bear: bb } : null; }; // bear = 바다 쪽(선의 오른쪽) 법선 방향, 북=0 시계방향
  let n = 0;
  for (const p of ps) {
    const sx = (p.lon - g.lo0) * kx, sy = (p.lat - g.la0) * ky, reach = 2 * p.r;
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const px = c * g.dlo * kx, py = r * g.dla * ky, ds = Math.hypot(px - sx, py - sy); if (ds >= reach) continue;
      const i = r * g.cols + c, v = g.z[i]; if (v == null || v >= 0) continue; // 육지는 그대로
      const w = ds <= p.r ? 1 : 0.5 * (1 + Math.cos(Math.PI * (ds - p.r) / p.r));
      const nr = near(px, py, Math.max(p.run, p.dir != null ? p.run2 : 0) + 650); if (!nr) continue; const dc = nr.d;
      let run = p.run; // [ADD] 방향별 경사: 완만한 방향(±범위/2, 가장자리 25°는 부드럽게)은 수평 거리 run, 나머지는 run2
      if (p.dir != null) { const a = Math.abs(((nr.bear - p.dir + 540) % 360) - 180), half = p.span / 2, F = 25, s = a <= half ? 1 : a >= half + F ? 0 : 0.5 * (1 + Math.cos(Math.PI * (a - half) / F)); run = p.run2 + (p.run - p.run2) * s; }
      if (!(dc <= run + 600)) continue;
      const orig = -v;
      const target = dc <= run ? p.top + (p.max - p.top) * dc / run : Math.max(orig, p.max * Math.max(0, Math.min(1, 1 - (dc - run - 150) / 450))); // 바닥 뒤 150m까지 바닥 수심 유지 → 600m에서 원래 자료
      g.z[i] = -(w * target + (1 - w) * orig); n++;
    }
  }
  return n;
}
async function warpByShiftField(g, x, y) {
  const A = await areaControls(x, y), ctl = A.ctl; // 실패하면 오류가 위로 전달됨(조용히 넘어가지 않음)
  g._segs = A.segs; g._segsAll = A.segsAll; // 해안선 0m 맞추기·가짜 육지 지우기에 사용
  if (!ctl.length) return null;
  const kx = Math.cos((g.la0 + g.rows * g.dla / 2) * Math.PI / 180) * 111320, ky = 111320;
  const field = (la, lo) => { let sw = 0, sx = 0, sy = 0;
    for (const c of ctl) { const d = Math.hypot((lo - c.lo) * kx, (la - c.la) * ky); if (d >= CTL_R) continue;
      const w = (1 - d / CTL_R) ** 2 * Math.min(1, c.n / 15); sw += w; sx += w * c.dx; sy += w * c.dy; }
    const den = sw + 0.15; return [sx / den, sy / den]; };
  const z0 = g.z.slice();
  const at = (la, lo) => { const fi = (la - g.la0) / g.dla, fj = (lo - g.lo0) / g.dlo; if (fi < 0 || fj < 0 || fi > g.rows - 1 || fj > g.cols - 1) return null;
    const i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j, q = [z0[i * g.cols + j], z0[i * g.cols + j + 1], z0[(i + 1) * g.cols + j], z0[(i + 1) * g.cols + j + 1]];
    if (q.some(v => v == null)) return q[Math.round(a) * 2 + Math.round(b)] ?? q.find(v => v != null) ?? null;
    return q[0] * (1 - a) * (1 - b) + q[1] * (1 - a) * b + q[2] * a * (1 - b) + q[3] * a * b; };
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const la = g.la0 + r * g.dla, lo = g.lo0 + c * g.dlo, [dx, dy] = field(la, lo);
    g.z[r * g.cols + c] = at(la - dy / ky, lo - dx / kx);
  }
  const ctr = field(g.la0 + g.rows * g.dla / 2, g.lo0 + g.cols * g.dlo / 2);
  return [Math.round(ctr[0]), Math.round(ctr[1])];
}

// [ADD] 지도 타일(웹 메르카토르 줌 13, 한 장 약 4~5km) 단위 수심 격자 - 지도에 이어 붙여 깔기용
//  타일 경계 밖으로 약 330m 더 받아서(겹침) 앱이 경계에서 잘라 그리면 이음새가 안 보여요. 180일 저장.
const DTILE_Z = 13, DTILE_PAD = 0.003;
function tileBox(x, y) {
  const n = 2 ** DTILE_Z, lon = (v) => v / n * 360 - 180, lat = (v) => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
  return { s: lat(y + 1), n: lat(y), w: lon(x), e: lon(x + 1) };
}
// [ADD] 원본 수심 격자 저장: 0.1m 정수 → 앞 칸과의 차이 → deflate 압축 → base64. 180일 보관
//  (거친 해외 자료는 매끈해서 수 KB, 정밀 자료도 수십 KB 안팎)
const zlib = require('zlib');
const RAW_KEY = (x, y) => `draw:v1:${x}_${y}`, NUL = -2147483648;
function encGrid(g) {
  const n = g.rows * g.cols, a = new Int32Array(n); let prev = 0;
  for (let i = 0; i < n; i++) { const v = g.z[i] == null ? NUL : Math.round(g.z[i] * 10); a[i] = v === NUL ? NUL : v - prev; if (v !== NUL) prev = v; }
  return zlib.deflateRawSync(Buffer.from(a.buffer), { level: 9 }).toString('base64');
}
function decGrid(m, b64) {
  const buf = zlib.inflateRawSync(Buffer.from(b64, 'base64')), a = new Int32Array(buf.buffer, buf.byteOffset, buf.length / 4), z = new Array(a.length); let prev = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] === NUL) { z[i] = null; continue; } prev += a[i]; z[i] = prev / 10; }
  return { la0: m.la0, lo0: m.lo0, dla: m.dla, dlo: m.dlo, rows: m.rows, cols: m.cols, z };
}
async function rawSet(x, y, r) {
  try { const g = r.grid, o = { v: 1, src: r.src, res: r.res, hiFrac: r.hiFrac, nullLand: !!r.nullLand, la0: g.la0, lo0: g.lo0, dla: g.dla, dlo: g.dlo, rows: g.rows, cols: g.cols, z: encGrid(g), at: Date.now() };
    await redisPipeline([['SET', RAW_KEY(x, y), JSON.stringify(o), 'EX', String(30 * 86400)]]); } catch (_) {}
}
async function rawGet(x, y) {
  try { const [{ result }] = await redisPipeline([['GET', RAW_KEY(x, y)]]); if (!result) return null; const o = JSON.parse(result); if (o.src === 'khoa' && !o.kp) return null; // 쪽이 빠졌을 수 있는 옛 국립해양조사원 원본은 다시 받기
    return { src: o.src, res: o.res, hiFrac: o.hiFrac, nullLand: o.nullLand, kp: o.kp, grid: decGrid(o, o.z), fromRaw: true }; } catch (_) { return null; }
}
async function depthTile(x, y, opt = {}) {
  x = parseInt(x, 10); y = parseInt(y, 10); const n = 2 ** DTILE_Z;
  if (!(x >= 0 && x < n && y >= 0 && y < n)) return null;
  const ck = 'dtile:v1:' + x + '_' + y;
  if (!opt.fresh) { try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {} }
  const t = tileBox(x, y), lat = (t.s + t.n) / 2, lon = (t.w + t.e) / 2;
  const b = { s: t.s - DTILE_PAD, n: t.n + DTILE_PAD, w: t.w - DTILE_PAD, e: t.e + DTILE_PAD };
  const bigB = { s: t.s - 0.018, n: t.n + 0.018, w: t.w - 0.018, e: t.e + 0.018 };
  const order = inKorea(lat, lon) ? [fromKhoa, fromGmrt] : inEmodnet(lat, lon) ? [fromEmodnet, fromGmrt] : [fromNoaa, fromGmrt];
  let out = null; const errors = [];
  // [ADD] 원본 격자 저장본(raw)이 있으면 외부 서버에 다시 묻지 않고 그걸로 그려요(그리는 방식만 바꿀 때 몇 분이면 전체 다시 그리기)
  const SF = await sigFor(t), profs = SF.profs; let pf = SF.sig; // [ADD] 포인트 현지 지형 + 최소 수심 구역
  const finish = async (r) => {
    const g = r.grid; if (!g.z.some(v => v != null && v < 0)) return { ok: true, x, y, tile: t, src: r.src, empty: true, pf }; // 바다 없음
    const coarse = r.src === 'gmrt' && !(r.hiFrac >= 0.5);
    let coastFixed, shift = null, fixErr;
    if (coarse && RAW_COARSE) { coastFixed = true; } // 원래 위치 그대로(위 RAW_COARSE 설명)
    else if (coarse) { // 거친 자료만: 칸별 해안선 기준 이동량을 부드럽게 이어서 위치만 옮기기
      try { const sh = await warpByShiftField(g, x, y); coastFixed = true; shift = sh ? { dx: Math.round(sh[0]), dy: Math.round(sh[1]), moved: !!(sh[0] || sh[1]) } : null;
        landFix(g, g._segsAll || []); shoreTaper(g, g._segs || []); delete g._segs; delete g._segsAll;
        try { reefFix(g, await reefSegs(x, y)); } catch (_) {} } // 리프 자료 실패는 그냥 넘어감(다음에 다시)
      catch (e) { coastFixed = false; fixErr = String(e && e.message || e).slice(0, 100); } }
    if (profs.length) { try { const A = await areaControls(x, y); applyProfiles(g, profs, A.segsAll); } catch (_) { pf = ''; } } // 해안선 실패 → 표시 비워서 다음에 다시
    if (SF.fixes.length) applyFixes(g, SF.fixes); // [ADD] 최소 수심 구역(관리자)
    return { ok: true, x, y, tile: t, pf, src: r.src, srcShort: SRC[r.src].short, res: r.res, nullLand: !!r.nullLand, kp: !!r.kp, coarse, raw: coarse && RAW_COARSE, coastFixed, fixErr, shift: shift && shift.moved ? [shift.dx, shift.dy] : null, fromRaw: !!r.fromRaw,
      grid: { la0: g.la0, lo0: g.lo0, dla: g.dla, dlo: g.dlo, rows: g.rows, cols: g.cols, z: g.z.map(v => v == null ? null : Math.round(v)) } };
  };
  const raw = opt.noRaw ? null : await rawGet(x, y);
  if (raw) out = await finish(raw);
  else for (const fn of order) {
    try {
      const r = await fn(fn === fromGmrt ? bigB : b); if (!r) continue; // GMRT는 옮길 여유(약 2km)까지 넉넉히 받기
      await rawSet(x, y, r); // 보정(위치 옮기기) 전에 원본 그대로 저장
      out = await finish(r);
      break;
    } catch (e) {
      errors.push(fn.name + ': ' + String(e && e.message || e).replace(/serviceKey=[^&\s]+/g, 'serviceKey=***').slice(0, 120));
      // 국립해양조사원이 실패(하루 한도 초과·일시 오류)하면 거친 GMRT로 저장해 버리지 않고 다음에 다시 시도
      if (fn === fromKhoa) return { ok: false, x, y, retry: true, errors };
    }
  }
  if (!out) return { ok: false, x, y, errors };
  if (!opt.noStore) { try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String(180 * 86400)]]); } catch (_) {} }
  return out;
}

// [ADD] 수심 타일을 서버에서 미리 "그림(벡터)"으로 만들어 두기 - 앱은 받은 다각형·선을 그대로 그리기만 해요(계산·로딩 거의 없음)
//  fills: 수심 0·10·20·30·40·50·60·80·100m 이상 구역 다각형(아래에서부터 겹쳐 칠하면 깊을수록 진해짐, 일러스트처럼 단색 띠)
//  lines: 10m 간격 등심선, lbl: 30·40·60m 선 위 숫자 후보. 좌표는 [위도, 경도] 소수 5자리. 180일 저장 + CDN 30일
const FILL_T = [1, 5, 10, 20, 30, 40, 50, 60, 80, 100, 120, 150]; // [ADD] 5m: 얕은 만(예: 샌프란시스코만 동쪽 1~4m)을 10m 안에서도 구분
function clipRing(ring, t) { // Sutherland–Hodgman: 타일 네모 안쪽만
  const edges = [[p => p[0] >= t.s, (a, b) => ix(a, b, 0, t.s)], [p => p[0] <= t.n, (a, b) => ix(a, b, 0, t.n)], [p => p[1] >= t.w, (a, b) => ix(a, b, 1, t.w)], [p => p[1] <= t.e, (a, b) => ix(a, b, 1, t.e)]];
  function ix(a, b, k, v) { const r = (v - a[k]) / (b[k] - a[k]); return k === 0 ? [v, a[1] + (b[1] - a[1]) * r] : [a[0] + (b[0] - a[0]) * r, v]; }
  let out = ring;
  for (const [inside, cut] of edges) {
    const inp = out; out = []; if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) { const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); } else if (inside(prev)) out.push(cut(prev, cur)); }
  }
  return out;
}
const q5 = (v) => Math.round(v * 1e5) / 1e5;
function thin(pts, tol) { // 가까운 점 빼기(약 2m)
  const out = []; for (const p of pts) { const r = [q5(p[0]), q5(p[1])], l = out[out.length - 1]; if (!l || Math.abs(l[0] - r[0]) > tol || Math.abs(l[1] - r[1]) > tol) out.push(r); }
  return out;
}
// [ADD] 섬·바위 육지 다각형(OSM 해안선의 닫힌 고리 = 섬, 선의 왼쪽이 육지). 반지름 약 15m(면적 700㎡) 이상만.
//  수심 자료가 거칠어 섬이 물속에 잠긴 것처럼 나오던 곳(페스카도르, 울릉도 대풍감 등)에서, 수심 위에 육지를 확실히 덮어 그리려고 타일별로 저장(180일).
//  본토처럼 타일 밖으로 이어지는 열린 선은 건드리지 않아요(그쪽은 수심 자료의 육지 값을 그대로 씀). 실패하면 던져서 짧게만 저장.
const LAND_MIN_AREA = 700;
async function landFor(x, y, t) {
  const ck = `land:v1:${x}_${y}`;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {}
  const P = 0.004, lines = await coastLines({ s: t.s - P, n: t.n + P, w: t.w - P, e: t.e + P });
  const kx = Math.cos((t.s + t.n) / 2 * Math.PI / 180) * 111320, ky = 111320, rings = [];
  for (const l of lines) {
    if (l.length < 4 || l[0][0] !== l[l.length - 1][0] || l[0][1] !== l[l.length - 1][1]) continue; // 닫힌 고리만
    let a2 = 0; for (let i = 1; i < l.length; i++) a2 += (l[i - 1][1] * kx) * (l[i][0] * ky) - (l[i][1] * kx) * (l[i - 1][0] * ky);
    if (!(a2 > 0)) continue; // 시계방향 = 안쪽이 바다(호수·만) → 육지 아님
    if (a2 / 2 < LAND_MIN_AREA) continue;
    const c = clipRing(l.slice(0, -1), t); if (c.length < 3) continue;
    const th = thin(c, 1.5e-5); if (th.length >= 3) rings.push(th);
  }
  const out = { r: rings };
  try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String(180 * 86400)]]); } catch (_) {}
  return out;
}
async function depthVec(x, y, opt = {}) {
  x = parseInt(x, 10); y = parseInt(y, 10);
  const ck = 'dvec:v2:' + x + '_' + y;
  // [ADD] fill=1: 그림은 있는데 원본 격자 저장본이 없으면 한 번 다시 받아 원본을 저장(이후엔 외부 서버 없이 다시 그리기)
  const needRaw = opt.fill ? !(await redisPipeline([['EXISTS', RAW_KEY(x, y)]]).then(r => r[0].result).catch(() => 1)) : false;
  let old = null; // 다시 계산이 실패하면(국립해양조사원 하루 한도 등) 예전 그림이라도 보여주기
  const curPf = (await sigFor(tileBox(x, y))).sig;
  if (!needRaw) try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) { const o = JSON.parse(result); const stale = (o.pf || '') !== curPf || (o.src === 'gmrt' && (o.coarse === undefined || (o.coarse && !o.sf8) || (RAW_COARSE && o.coarse && !o.raw))) || (o.src === 'khoa' && !o.kp) || (!o.d150 && o.Ln && o.Ln['100']) || ((!o.empty && !o.ld || (o.Ld && !o.ld2)) && !(o.landErr && Date.now() - (o.at || 0) < 600e3)); let stale2 = stale;
    // [ADD] 2·5m 얕은 등심선 추가 전 저장본: 10m보다 얕은 곳이 있고 원본 격자가 저장돼 있을 때만 다시 그림(외부 서버 다시 안 부르게)
    if (!stale2 && !o.sh5 && o.F && o.F.some(f => f[0] === 1)) { try { const [{ result: ex }] = await redisPipeline([['EXISTS', RAW_KEY(x, y)]]); if (ex) stale2 = true; } catch (_) {} }
    if (!stale2) return o; old = o; /* 옛 방식 저장본·100m보다 깊은 곳(120·150m 선 추가)은 다시 계산 */ } } catch (_) {} // GMRT 옛 저장본은 고/저해상도 표시가 없어 다시 계산
  const d = await depthTile(x, y, { noStore: true, fresh: true }); // 격자는 따로 저장 안 함(벡터만 저장해서 저장 공간 절약)
  if (!d || !d.ok) return old ? Object.assign({}, old, { tmp: true }) : d; // tmp → 짧게만 캐시하고 다음에 다시 시도
  const t = d.tile;
  let out = { ok: true, x, y, tile: t, src: d.src, empty: true, pf: d.pf || '' };
  if (d.grid) {
    const g = d.grid, U = 2, R = (g.rows - 1) * U + 1, C = (g.cols - 1) * U + 1;
    const gz = (i, j) => { const v = g.z[i * g.cols + j]; return v == null ? (d.nullLand ? 3 : 1) : v; };
    const laN = g.la0 + (g.rows - 1) * g.dla, dla = g.dla / U, dlo = g.dlo / U;
    // 수심(양수) 격자, 위쪽 줄 = 북쪽(d3-contour 방향)
    const V = new Float64Array(R * C);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const fi = (R - 1 - r) / U, fj = c / U, i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j;
      V[r * C + c] = -(gz(i, j) * (1 - a) * (1 - b) + gz(i, j + 1) * (1 - a) * b + gz(i + 1, j) * a * (1 - b) + gz(i + 1, j + 1) * a * b);
    }
    const toLL = (p) => [laN - (p[1] - 0.5) * dla, g.lo0 + (p[0] - 0.5) * dlo];
    const { contours } = require('./_contours');
    const maxD = Math.max(...V);
    const fills = contours().size([C, R]).thresholds(FILL_T.filter(v => v <= maxD))(Array.from(V)).map(mp => ({
      d: mp.value,
      p: mp.coordinates.map(poly => poly.map(ring => thin(clipRing(ring.map(toLL), t), 1.5e-5)).filter(r => r.length >= 3)).filter(poly => poly.length && poly[0].length >= 3)
    })).filter(f => f.p.length);
    // 등심선: 마칭 스퀘어 조각 → 이어 붙이기 → 조각 가운데가 타일 안인 것만
    const lines = {}, lbl = [];
    const P = (r, c) => [laN - r * dla, g.lo0 + c * dlo];
    const keep = (s) => { const la = (s[0][0] + s[1][0]) / 2, lo = (s[0][1] + s[1][1]) / 2; return la >= t.s && la < t.n && lo >= t.w && lo < t.e; };
    // [CHANGE] 등심선: 10~100m는 10m 간격, 그 아래는 120·150m까지
    for (const L of [2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150].filter(v => v <= maxD)) { // [ADD] 2·5m 얕은 등심선(앱에서 가는 점선)
      const lv = L + 0.013, segs = [];
      for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
        const v = [V[r * C + c], V[r * C + c + 1], V[(r + 1) * C + c + 1], V[(r + 1) * C + c]], cn = [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c]], pts = [];
        for (let e = 0; e < 4; e++) { const a = v[e], b = v[(e + 1) % 4]; if ((a - lv) * (b - lv) < 0) { const k = (lv - a) / (b - a), p = cn[e], q = cn[(e + 1) % 4]; pts.push(P(p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k)); } }
        if (pts.length === 2) { if (keep(pts)) segs.push(pts); } else if (pts.length === 4) [[pts[0], pts[1]], [pts[2], pts[3]]].forEach(s => { if (keep(s)) segs.push(s); });
      }
      if (!segs.length) continue;
      const ln = joinSegs(segs).map(l => thin(l, 1.5e-5)).filter(l => l.length >= 2);
      lines[L] = ln;
      if (L === 30 || L === 40 || L === 60) { let n = 0; ln.forEach(l => l.forEach((p, i) => { if (i % 8 === 4 && n < 40) { lbl.push([p[0], p[1], L]); n++; } })); }
    }
    // 좌표를 타일 안 0~4096 정수로 바꾸고 앞 점과의 차이만 적어서 크기를 4~5배 줄임(앱에서 되돌림)
    const QX = (lo) => Math.round((lo - t.w) / (t.e - t.w) * 4096), QY = (la) => Math.round((t.n - la) / (t.n - t.s) * 4096);
    const enc = (pts) => { const o = []; let px = 0, py = 0; pts.forEach((p, i) => { const x1 = QX(p[1]), y1 = QY(p[0]); if (i && x1 === px && y1 === py) return; o.push(x1 - px, y1 - py); px = x1; py = y1; }); return o; };
    out = { ok: true, v: 2, x, y, tile: t, pf: d.pf || '', src: d.src, srcShort: d.srcShort, res: d.res, coarse: !!d.coarse, raw: !!d.raw || undefined, coastFixed: d.coastFixed, kp: d.kp, fixErr: d.fixErr, shift: d.shift || null, full: true, sf2: true, sf3: true, sf4: true, sf5: true, sf6: true, sf7: true, sf8: true, sh5: true, d150: true, tmp: !!(d.coarse && !d.coastFixed) || undefined,
      F: fills.map(f => [f.d, f.p.map(poly => poly.map(enc))]), Ln: Object.fromEntries(Object.entries(lines).map(([k, ls]) => [k, ls.map(enc).filter(a => a.length >= 4)])),
      lb: lbl.map(p => [QX(p[1]), QY(p[0]), p[2]]) };
    // [ADD] 섬·바위 육지(수심 위에 덮어 그림). 해안선 서버 실패 시 표시 없이 짧게만 저장해 곧 다시 시도
    // [FIX] 정밀 수심 자료(해양조사원·NOAA·EMODnet)가 그 자리를 깊은 바다(3m 넘게)로 보면 OSM 섬 모양이 어긋난 것 → 덮지 않음
    //  (OSM 해안선이 위성사진·수심과 100m가량 밀려 있는 곳에서, 실제 섬은 바다로 보이고 바다에 육지가 덮이던 문제). 거친 자료(GMRT)는 OSM이 기준이라 그대로.
    const ringOk = (ring) => {
      if (d.src === 'gmrt') return true;
      let s0 = Infinity, n0 = -Infinity, w0 = Infinity, e0 = -Infinity; ring.forEach(p => { s0 = Math.min(s0, p[0]); n0 = Math.max(n0, p[0]); w0 = Math.min(w0, p[1]); e0 = Math.max(e0, p[1]); });
      const inR = (la, lo) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[0] > la) !== (b[0] > la) && lo < (b[1] - a[1]) * (la - a[0]) / (b[0] - a[0]) + a[1]) c = !c; } return c; };
      let tot = 0, deep = 0;
      const r0 = Math.max(0, Math.floor((s0 - g.la0) / g.dla)), r1 = Math.min(g.rows - 1, Math.ceil((n0 - g.la0) / g.dla)), c0 = Math.max(0, Math.floor((w0 - g.lo0) / g.dlo)), c1 = Math.min(g.cols - 1, Math.ceil((e0 - g.lo0) / g.dlo));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { if (!inR(g.la0 + r * g.dla, g.lo0 + c * g.dlo)) continue; tot++; const v = g.z[r * g.cols + c]; if (v != null && v < -3) deep++; }
      if (!tot) { const la = (s0 + n0) / 2, lo = (w0 + e0) / 2, r = Math.round((la - g.la0) / g.dla), c = Math.round((lo - g.lo0) / g.dlo); if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) return true; const v = g.z[r * g.cols + c]; return !(v != null && v < -3); }
      return deep / tot <= 0.6;
    };
    try { const ld = await landFor(x, y, t); out.ld = true; out.ld2 = true; const rs = ld.r.filter(ringOk); if (rs.length) out.Ld = rs.map(enc).filter(a => a.length >= 6); }
    catch (_) { out.landErr = true; out.tmp = true; }
    out.at = Date.now();
  }
  try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String((out.coarse && !out.coastFixed) || out.landErr ? 3600 : 180 * 86400)]]); } catch (_) {}
  return out;
}
function joinSegs(segs) {
  const K = (p) => p[0].toFixed(8) + ',' + p[1].toFixed(8), ends = new Map(), used = new Uint8Array(segs.length), lines = [];
  segs.forEach((s, i) => [0, 1].forEach(e => { const k = K(s[e]); (ends.get(k) || ends.set(k, []).get(k)).push([i, e]); }));
  const nextFrom = (pt) => { const l = ends.get(K(pt)) || []; for (const [i, e] of l) if (!used[i]) { used[i] = 1; return segs[i][1 - e]; } return null; };
  segs.forEach((s, i) => { if (used[i]) return; used[i] = 1; const line = [s[0], s[1]];
    for (let p = nextFrom(line[line.length - 1]); p; p = nextFrom(line[line.length - 1])) line.push(p);
    for (let p = nextFrom(line[0]); p; p = nextFrom(line[0])) line.unshift(p);
    lines.push(line); });
  return lines;
}

// 저장된 값만(없으면 null) - 페이지가 느려지지 않게
async function depthCached(lat, lon) {
  try { const [{ result }] = await redisPipeline([['GET', KEY_VER + (+(+lat).toFixed(4)) + '_' + (+(+lon).toFixed(4))]]); if (!result) return null; const o = JSON.parse(result); return (o.src === 'gmrt' && !o.sf8) || (RAW_COARSE && o.coarse && !o.raw) ? null : o; } catch (_) { return null; } // 보정 전·옛 방식 저장본은 없는 셈
}

// [ADD] 정점 주변 섬 모양(흐름 지형 반영용): 반경 약 3km 안 해안선 중 닫힌 것(섬)만, 점 수를 줄여서. 180일 저장
async function islandsNear(lat, lon) {
  lat = +(+lat).toFixed(2); lon = +(+lon).toFixed(2); // 약 1km 칸으로 묶어 저장(가까운 정점끼리 같이 씀)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ck = `isl:v2:${lat}_${lon}`; // [CHANGE] v2 = 섬 + 본섬·육지 해안선(방파제 포함) 조각(walls)
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {}
  const P = 0.035, lines = await coastLines({ s: lat - P, n: lat + P, w: lon - P, e: lon + P });
  const kx = Math.cos(lat * Math.PI / 180) * 111320, ky = 111320, K = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  const isl = [], walls = [];
  // 선 단순화(약 8m 오차까지 점 줄이기) - 방향(왼쪽=육지)은 그대로 유지
  const simp = (l, tol) => { if (l.length < 3) return l; const keep = new Uint8Array(l.length); keep[0] = keep[l.length - 1] = 1; const st = [[0, l.length - 1]];
    while (st.length) { const [a, b] = st.pop(); const ax = l[a][1] * kx, ay = l[a][0] * ky, bx = l[b][1] * kx, by = l[b][0] * ky, dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      let m = -1, mi = -1; for (let i = a + 1; i < b; i++) { const d = Math.abs((l[i][1] * kx - ax) * dy - (l[i][0] * ky - ay) * dx) / L; if (d > m) { m = d; mi = i; } }
      if (m > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
    return l.filter((_, i) => keep[i]); };
  const inBox = (p) => Math.abs(p[0] - lat) <= P && Math.abs(p[1] - lon) <= P;
  lines.filter(l => l.length >= 2).forEach(l => {
    const closed = l.length >= 4 && K(l[0]) === K(l[l.length - 1]);
    if (closed) {
      let A = 0; for (let i = 0; i < l.length - 1; i++) A += l[i][1] * kx * l[i + 1][0] * ky - l[i + 1][1] * kx * l[i][0] * ky;
      const r = Math.sqrt(Math.abs(A / 2) / Math.PI);
      if (r < 15) return; // 아주 작은 바위는 무시
      if (r <= 2500) { // 바위~작은 섬: 원기둥 흐름 모델
        const step = Math.max(1, Math.floor(l.length / 120));
        isl.push(l.filter((_, i) => i % step === 0 || i === l.length - 1).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]));
        return;
      }
    }
    // [ADD] 본섬·육지 해안(방파제·항구 포함): 상자 안 부분만 잘라 "벽"으로. 흐름이 벽을 뚫지 못하고, 둘러싸인 항구 안은 잔잔
    let run = [];
    const flush = () => { if (run.length >= 2) walls.push(simp(run, 8).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)])); run = []; };
    for (let i = 0; i < l.length; i++) { const p = l[i];
      if (inBox(p)) { if (!run.length && i > 0) run.push(l[i - 1]); run.push(p); }
      else if (run.length) { run.push(p); flush(); } }
    flush();
  });
  const out = { ok: true, lat, lon, islands: isl, walls };
  try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String(180 * 86400)]]); } catch (_) {}
  return out;
}
module.exports = { islandsNear, depthAt, depthCached, depthTile, depthVec, DTILE_Z, summarize, SRC, _t: { fromKhoa, fromEmodnet, fromNoaa, fromGmrt, gridFromPoints, inKorea, inEmodnet } };
