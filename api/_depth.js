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
  const rows = first.rows.slice(), pages = Math.min(20, Math.ceil(first.total / 300));
  const more = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2).catch(() => ({ rows: [] }))));
  more.forEach(m => rows.push(...m.rows));
  if (rows.length < 4) return null;
  // 지도 타일끼리 이어 붙도록 격자 시작점을 전 세계 공통 눈금(위도 0.00135°, 경도 0.0016°)에 맞춤
  const dla = 0.00135, dlo = 0.0016, gb = { s: Math.ceil(b.s / dla) * dla, n: b.n, w: Math.ceil(b.w / dlo) * dlo, e: b.e };
  return { src: 'khoa', res: 150, nullLand: true, grid: gridFromPoints(rows, gb, dla, dlo, 110) };
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
async function fromGmrt(b) {
  const q = `minlongitude=${b.w.toFixed(5)}&maxlongitude=${b.e.toFixed(5)}&minlatitude=${b.s.toFixed(5)}&maxlatitude=${b.n.toFixed(5)}&format=esriascii&resolution=high`;
  // [ADD] topo-mask = 실제 다중빔 조사(고해상도)가 있는 칸만 값이 있음 → 나머지는 GEBCO(약 450m)를 늘린 거친 값
  const [t, tm] = await Promise.all([getText(`https://www.gmrt.org/services/GridServer?${q}`, {}, 20000), getText(`https://www.gmrt.org/services/GridServer?${q}&layer=topo-mask`, {}, 20000).catch(() => null)]);
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

// 지역별 순서대로 시도 → 첫 성공
async function depthAt(lat, lon, opt = {}) {
  lat = +(+lat).toFixed(4); lon = +(+lon).toFixed(4);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ck = KEY_VER + lat + '_' + lon;
  if (!opt.fresh) { try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {} }
  const order = inKorea(lat, lon) ? [fromKhoa, fromGmrt] : inEmodnet(lat, lon) ? [fromEmodnet, fromGmrt] : inUsArea(lat, lon) ? [fromNoaa, fromGmrt] : [fromNoaa, fromGmrt];
  const errors = [];
  for (const fn of order) {
    try {
      const r = await fn(box(lat, lon));
      if (!r) continue;
      const sum = summarize(r.grid, lat, lon);
      if (!sum) continue;
      const out = { ok: true, lat, lon, src: r.src, srcName: SRC[r.src].name, srcShort: SRC[r.src].short, license: SRC[r.src].license, res: r.res, ...sum, grid: r.grid, saved: Date.now() };
      try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String(180 * 86400)]]); } catch (_) {}
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
  const t = await getText('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'otemp.app depth layer' } }, 25000);
  const ways = (JSON.parse(t).elements || []).map(w => (w.geometry || []).filter(Boolean).map(p => [p.lat, p.lon])).filter(l => l.length >= 2);
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
async function tileControls(x, y) {
  const ck = `tctl:v1:${x}_${y}`;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {}
  const t = tileBox(x, y), P = 0.03, b = { s: t.s - P, n: t.n + P, w: t.w - P, e: t.e + P };
  const lines = await coastLines(b); // 실패하면 저장 안 함
  const kx = Math.cos((t.s + t.n) / 2 * Math.PI / 180) * 111320, ky = 111320;
  // 덩어리 나누기: 둘레 6km 이하는 통째로, 긴 것은 3km씩
  const chunks = [];
  lines.forEach(l => {
    let len = 0; for (let i = 1; i < l.length; i++) len += Math.hypot((l[i][1] - l[i - 1][1]) * kx, (l[i][0] - l[i - 1][0]) * ky);
    if (len <= 6000) { chunks.push(l); return; }
    let cur = [l[0]], acc = 0;
    for (let i = 1; i < l.length; i++) { const d = Math.hypot((l[i][1] - l[i - 1][1]) * kx, (l[i][0] - l[i - 1][0]) * ky); cur.push(l[i]); acc += d;
      if (acc >= 3000) { chunks.push(cur); cur = [l[i]]; acc = 0; } }
    if (cur.length >= 2) chunks.push(cur);
  });
  // 이 칸 안에 가운데가 있는 덩어리만 이 칸이 맡음(이웃 칸과 겹치지 않게)
  const mine = chunks.map(c => ({ c, la: c.reduce((a, p) => a + p[0], 0) / c.length, lo: c.reduce((a, p) => a + p[1], 0) / c.length }))
    .filter(o => o.la >= t.s && o.la < t.n && o.lo >= t.w && o.lo < t.e);
  let ctl = [];
  if (mine.length) {
    const r = await fromGmrt(b);
    if (!r) throw new Error('gmrt');
    for (const o of mine) {
      const segs = []; for (let i = 1; i < o.c.length; i++) segs.push([o.c[i - 1][0], o.c[i - 1][1], o.c[i][0], o.c[i][1]]);
      const g = Object.assign({}, r.grid); // coastShift가 시작점을 바꿔서 복사본에
      const m = coastShift(g, segs);
      if (m) ctl.push({ la: +o.la.toFixed(5), lo: +o.lo.toFixed(5), dx: m.dx, dy: m.dy, n: segs.length });
    }
  }
  try { await redisPipeline([['SET', ck, JSON.stringify(ctl), 'EX', String(180 * 86400)]]); } catch (_) {}
  return ctl;
}
async function warpByShiftField(g, x, y) {
  const ctl = [];
  for (const j of [-1, 0, 1]) for (const i of [-1, 0, 1]) { const c = await tileControls(x + i, y + j).catch(() => null); if (c) ctl.push(...c); } // 하나씩(해안선 서버 보호)
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
  for (const fn of order) {
    try {
      const r = await fn(fn === fromGmrt ? bigB : b); if (!r) continue; // GMRT는 옮길 여유(약 2km)까지 넉넉히 받기
      const g = r.grid; if (!g.z.some(v => v != null && v < 0)) { out = { ok: true, x, y, tile: t, src: r.src, empty: true }; break; } // 바다 없음
      const coarse = r.src === 'gmrt' && !(r.hiFrac >= 0.5);
      let coastFixed;
      let shift = null;
      if (coarse) { // 거친 자료만: 칸별 해안선 기준 이동량을 부드럽게 이어서 위치만 옮기기
        try { const sh = await warpByShiftField(g, x, y); coastFixed = true; shift = sh ? { dx: Math.round(sh[0]), dy: Math.round(sh[1]), moved: !!(sh[0] || sh[1]) } : null; }
        catch (_) { coastFixed = false; } }
      out = { ok: true, x, y, tile: t, src: r.src, srcShort: SRC[r.src].short, res: r.res, nullLand: !!r.nullLand, coarse, coastFixed, shift: shift && shift.moved ? [shift.dx, shift.dy] : null, // 거친 자료(GEBCO 수준)면 앱에서 흐리게
        grid: { la0: g.la0, lo0: g.lo0, dla: g.dla, dlo: g.dlo, rows: g.rows, cols: g.cols, z: g.z.map(v => v == null ? null : Math.round(v)) } };
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
const FILL_T = [1, 10, 20, 30, 40, 50, 60, 80, 100, 120, 150];
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
async function depthVec(x, y) {
  x = parseInt(x, 10); y = parseInt(y, 10);
  const ck = 'dvec:v2:' + x + '_' + y;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) { const o = JSON.parse(result); const stale = (o.src === 'gmrt' && (o.coarse === undefined || (o.coarse && !o.sf2))) || (!o.d150 && o.Ln && o.Ln['100']); if (!stale) return o; /* 옛 방식 저장본·100m보다 깊은 곳(120·150m 선 추가)은 다시 계산 */ } } catch (_) {} // GMRT 옛 저장본은 고/저해상도 표시가 없어 다시 계산
  const d = await depthTile(x, y, { noStore: true, fresh: true }); // 격자는 따로 저장 안 함(벡터만 저장해서 저장 공간 절약)
  if (!d || !d.ok) return d;
  const t = d.tile;
  let out = { ok: true, x, y, tile: t, src: d.src, empty: true };
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
    for (const L of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150].filter(v => v <= maxD)) {
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
    out = { ok: true, v: 2, x, y, tile: t, src: d.src, srcShort: d.srcShort, res: d.res, coarse: !!d.coarse, coastFixed: d.coastFixed, shift: d.shift || null, full: true, sf2: true, d150: true,
      F: fills.map(f => [f.d, f.p.map(poly => poly.map(enc))]), Ln: Object.fromEntries(Object.entries(lines).map(([k, ls]) => [k, ls.map(enc).filter(a => a.length >= 4)])),
      lb: lbl.map(p => [QX(p[1]), QY(p[0]), p[2]]) };
  }
  try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String(out.coarse && !out.coastFixed ? 86400 : 180 * 86400)]]); } catch (_) {}
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
  try { const [{ result }] = await redisPipeline([['GET', KEY_VER + (+(+lat).toFixed(4)) + '_' + (+(+lon).toFixed(4))]]); return result ? JSON.parse(result) : null; } catch (_) { return null; }
}

module.exports = { depthAt, depthCached, depthTile, depthVec, DTILE_Z, summarize, SRC, _t: { fromKhoa, fromEmodnet, fromNoaa, fromGmrt, gridFromPoints, inKorea, inEmodnet } };
