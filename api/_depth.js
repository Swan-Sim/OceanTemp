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
async function fromKhoa(lat, lon) {
  const key = process.env.KHOA_API_KEY; if (!key) return null;
  const b = box(lat, lon), r4 = v => v.toFixed(4);
  const page = async (no) => {
    const t = await getText(`https://apis.data.go.kr/1192136/waterDepth/GetWaterDepthApiService?serviceKey=${encodeURIComponent(key)}&type=json&ymin=${r4(b.s)}&ymax=${r4(b.n)}&xmin=${r4(b.w)}&xmax=${r4(b.e)}&pageNo=${no}&numOfRows=300`, {}, 12000);
    const j = JSON.parse(t), body = (j.response && j.response.body) || j.body || {}, head = (j.response && j.response.header) || j.header || {};
    if (head.resultCode && head.resultCode !== '00') { if (head.resultCode === '03') return { total: 0, rows: [] }; throw new Error(`${head.resultCode} ${head.resultMsg || ''}`); }
    let it = body.items && body.items.item; if (it && !Array.isArray(it)) it = [it];
    return { total: +body.totalCount || 0, rows: (it || []).map(x => [+x.lat, +x.lot, -(+x.dpwt)]).filter(r => r.every(Number.isFinite)) };
  };
  const first = await page(1); if (!first.total) return null;
  const rows = first.rows.slice(), pages = Math.min(12, Math.ceil(first.total / 300));
  const more = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2).catch(() => ({ rows: [] }))));
  more.forEach(m => rows.push(...m.rows));
  if (rows.length < 4) return null;
  const dla = 0.00135, dlo = 150 / (111320 * Math.cos(lat * Math.PI / 180));
  return { src: 'khoa', res: 150, grid: gridFromPoints(rows, b, dla, dlo, 110) };
}

// ── EMODnet(ERDDAP griddap CSV) ──
async function fromEmodnet(lat, lon) {
  const b = box(lat, lon), f = v => v.toFixed(5);
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
async function fromNoaa(lat, lon) {
  const b = box(lat, lon), N = 31, pts = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) pts.push([b.w + j * (b.e - b.w) / (N - 1), b.s + i * (b.n - b.s) / (N - 1)]);
  const body = new URLSearchParams({ f: 'json', geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', geometry: JSON.stringify({ points: pts, spatialReference: { wkid: 4326 } }) });
  const j = JSON.parse(await getText('https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/getSamples', { method: 'POST', body }, 20000));
  const S = j.samples || []; if (S.length < pts.length * 0.8) return null;
  const resDeg = Math.max(...S.map(s => +s.resolution || 1)); // 가장 거친 칸 기준
  const resM = resDeg * 111320; if (!(resM <= 100)) return null; // GEBCO 수준(460m)이면 GMRT가 나아요
  const z = new Array(N * N).fill(null);
  S.forEach(s => { const v = +s.value; if (Number.isFinite(v) && Math.abs(v) < 12000) z[s.locationId] = Math.round(v * 10) / 10; });
  return { src: 'noaa', res: Math.max(3, Math.round(resM)), grid: { la0: b.s, lo0: b.w, dla: (b.n - b.s) / (N - 1), dlo: (b.e - b.w) / (N - 1), rows: N, cols: N, z } };
}

// ── GMRT(ESRI ASCII 격자, 위쪽 줄이 북쪽) ──
async function fromGmrt(lat, lon) {
  const b = box(lat, lon);
  const t = await getText(`https://www.gmrt.org/services/GridServer?minlongitude=${b.w.toFixed(5)}&maxlongitude=${b.e.toFixed(5)}&minlatitude=${b.s.toFixed(5)}&maxlatitude=${b.n.toFixed(5)}&format=esriascii&resolution=high`, {}, 20000);
  const L = t.trim().split('\n'), hd = {}; let k = 0;
  for (; k < L.length && /^[a-z_]+\s/i.test(L[k]); k++) { const [a, v] = L[k].trim().split(/\s+/); hd[a.toLowerCase()] = +v; }
  const cols = hd.ncols, rows = hd.nrows, cs = hd.cellsize, nod = hd.nodata_value; if (!cols || !rows || !cs) return null;
  const vals = L.slice(k).join(' ').trim().split(/\s+/).map(Number);
  const z = new Array(rows * cols).fill(null);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const v = vals[r * cols + c]; if (Number.isFinite(v) && v !== nod) z[(rows - 1 - r) * cols + c] = Math.round(v * 10) / 10; }
  return { src: 'gmrt', res: Math.round(cs * 111320), grid: { la0: hd.yllcorner + cs / 2, lo0: hd.xllcorner + cs / 2, dla: cs, dlo: cs, rows, cols, z } };
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
      const r = await fn(lat, lon);
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

// 저장된 값만(없으면 null) - 페이지가 느려지지 않게
async function depthCached(lat, lon) {
  try { const [{ result }] = await redisPipeline([['GET', KEY_VER + (+(+lat).toFixed(4)) + '_' + (+(+lon).toFixed(4))]]); return result ? JSON.parse(result) : null; } catch (_) { return null; }
}

module.exports = { depthAt, depthCached, summarize, SRC, _t: { fromKhoa, fromEmodnet, fromNoaa, fromGmrt, gridFromPoints, inKorea, inEmodnet } };
