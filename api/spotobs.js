// [ADD] 정점(해변) 실측 수온 모음 - 처음 화면부터 정점 점을 근처 관측소 실측 값으로 칠하려고 만든 함수.
//   /api/spotobs → { updated, spots: [{ lat, lon, t(°C), at(관측 시각 UTC ms), src: { kind, name, dist } }] }
// 정점마다 표(실시간 현황)와 같은 규칙으로 가장 가까운 관측소의 최신 수온을 고릅니다.
//   한국: 국립해양조사원 조위관측소(25km)·해양관측부이(40km)·기상청 부이(40km) 중 가장 가까운 곳
//   미국: NOAA CO-OPS(25km), 없으면 NDBC 부이(60km)
//   그 밖(유럽 등): Copernicus 고정 부이·관측소(40km)
// 36시간보다 오래된 값, 위성 수온과 6°C 넘게 다른 값(고장 센서)은 버려요.
// 결과는 Redis에 1시간 저장, CDN은 15분 + 오래된 값 먼저 주고 뒤에서 갱신(사용자는 기다리지 않음).
const { redisPipeline } = require('./_redis');

const SHEET = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSN3HofGgc9HEUOIag-2EQpPnpJ9gZi2DTXLvu1t9LP3WAeAe-IYIFmJ6H_buloREnhfLsbWWRN9S9j/pub?output=csv';
const KEY = 'spotobs:v1';
const MAX_AGE = 36 * 3600e3;

async function getJSON(url, ms) {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms || 20000);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'OceanTemp (otemp.app)' } }); if (!r.ok) return null; return await r.json(); }
  catch (_) { return null; } finally { clearTimeout(tm); }
}
async function getText(url, ms) {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms || 20000);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'OceanTemp (otemp.app)' } }); if (!r.ok) return null; return await r.text(); }
  catch (_) { return null; } finally { clearTimeout(tm); }
}

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
async function loadSpots(base) {
  // [CHANGE] 전체 포인트 목록은 관리 페이지(Redis)에서 - 옮기기 전엔 _store가 구글 시트를 대신 읽어요
  const list = await require('./_store').allSpots(base);
  return list.map(s => ({ lat: s.lat, lon: s.lon, show: 'Y' }));
}

const km = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const near = (list, lat, lon, maxKm, f) => (list || []).filter(k => !f || f(k)).map(k => ({ ...k, dist: km(lat, lon, k.lat, k.lon) })).filter(k => k.dist <= maxKm).sort((a, b) => a.dist - b.dist);
const inKorea = (lat, lon) => lat > 32 && lat < 39.5 && lon > 124 && lon < 132.5;
// [ADD] 서울 한강(강 포인트): 서울시 한강 수질 자동측정망 실시간 수온 (서울 열린데이터광장 WPOSInformationTime, 공공누리 1유형)
//   인증키는 Vercel 환경변수 SEOUL_API_KEY. 본류 측정소는 선유 하나라 서울 한강 포인트는 선유 값을 쓰고, 지천 값은 참고로 붙여요.
const inSeoulHan = (lat, lon) => lat > 37.44 && lat < 37.63 && lon > 126.79 && lon < 127.2;
// 측정소 위치(대략): 선유=한강 본류, 나머지=지천 하류
const SEOUL_STN = { '선유': [37.5438, 126.8975, true], '안양천': [37.5360, 126.8830, false], '중랑천': [37.5440, 127.0230, false], '탄천': [37.5150, 127.0710, false] };
// 최근 days일 시간별 수온 { 측정소: [{ t:'YYYY-MM-DD HH:00'(KST), wt }] } - Redis 30분 저장
async function seoulRows(days) {
  const key = process.env.SEOUL_API_KEY;
  if (!key) return null;
  days = Math.max(1, Math.min(30, days || 2));
  const ck = `seoul:han:${days}`;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) { const o = JSON.parse(result); if (Date.now() - o.at < 30 * 60e3) return o.rows; } } catch (_) {}
  const need = Math.ceil(days * 24 * 4 * 1.1), pages = [];
  for (let a = 1; a <= need; a += 1000) pages.push([a, Math.min(need, a + 999)]);
  const parts = await Promise.all(pages.map(([a, b]) => getJSON(`http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/WPOSInformationTime/${a}/${b}/`, 15000)));
  const rows = {};
  parts.forEach(j => ((j && j.WPOSInformationTime && j.WPOSInformationTime.row) || []).forEach(r => {
    const name = r.MSRSTN_NM, wt = parseFloat(r.WATT), ymd = String(r.YMD || ''), hh = String(r.HR || '').slice(0, 2);
    if (!SEOUL_STN[name] || !Number.isFinite(wt) || !/^\d{8}$/.test(ymd) || !/^\d{2}$/.test(hh)) return;
    // "24:00"은 다음 날 00:00
    const ms = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +hh);
    const t = new Date(ms).toISOString().slice(0, 13).replace('T', ' ') + ':00';
    (rows[name] = rows[name] || []).push({ t, wt });
  }));
  Object.values(rows).forEach(a => a.sort((x, y) => x.t < y.t ? -1 : 1));
  if (Object.keys(rows).length) { try { await redisPipeline([['SET', ck, JSON.stringify({ at: Date.now(), rows }), 'EX', '7200']]); } catch (_) {} }
  return rows;
}
// 정점에 쓸 측정소: 지천 측정소 0.7km 안(지천 위 정점)이면 그 지천, 아니면 한강 본류(선유)
function seoulPick(lat, lon) {
  let best = null;
  Object.entries(SEOUL_STN).forEach(([n, [la, lo, main]]) => { const d = km(lat, lon, la, lo); if (!main && d <= 0.7 && (!best || d < best.d)) best = { n, d }; });
  if (best) return best;
  return { n: '선유', d: km(lat, lon, SEOUL_STN['선유'][0], SEOUL_STN['선유'][1]) };
}
async function seoulHan() {
  const rows = await seoulRows(2);
  if (!rows) return null;
  const out = {};
  Object.entries(rows).forEach(([n, a]) => { const r = a[a.length - 1]; if (r) out[n] = { t: r.wt, at: Date.parse(r.t.replace(' ', 'T') + ':00+09:00') }; });
  return out;
}
// ───────── [ADD] 호주 AIMS 리프 기상관측소·부이 수온(거의 실시간, 10~30분 간격) ─────────
//  관측소 목록(/series)은 키 없이 공개, 값(/data)은 Vercel 환경변수 AIMS_API_KEY 필요. 출처: AIMS Weather Stations (doi:10.25845/5c09bf93f315d, CC-BY)
const AIMS = 'https://api.aims.gov.au/data-v2.0/10.25845/5c09bf93f315d';
const AIMS_KM = 70;
const inAus = (lat, lon) => lat < -8 && lat > -45 && lon > 110 && lon < 160;
async function aimsSeries() {
  try { const [{ result }] = await redisPipeline([['GET', 'aims:series']]); if (result) { const o = JSON.parse(result); if (Date.now() - o.at < 86400e3) return o.list; } } catch (_) {}
  const j = await getJSON(`${AIMS}/series?include_details=true`, 20000);
  if (!Array.isArray(j)) return [];
  const cut = new Date(Date.now() - 5 * 86400e3).toISOString().slice(0, 10);
  // 수온 시리즈 중 최근까지 값이 있는 것, 관측소마다 가장 얕은 수심 하나("From teledyne" 같은 중복 센서는 뺌)
  const by = {};
  j.filter(x => /^water temp/i.test(x.parameter || '') && (x.time_coverage_end || '') >= cut && !/teledyne/i.test(x.series_short || x.series || ''))
    .forEach(x => { const k = x.subsite || x.site; const d = x.depth == null ? 1 : +x.depth; if (!by[k] || d < by[k].depth) by[k] = { id: x.series_id, site: x.site, subsite: x.subsite, lat: +x.lat, lon: +x.long, depth: d }; });
  const list = Object.values(by).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  if (list.length) { try { await redisPipeline([['SET', 'aims:series', JSON.stringify({ at: Date.now(), list }), 'EX', '172800']]); } catch (_) {} }
  return list;
}
let aimsLastErr = null; // 진단용(키는 절대 안 담음)
async function aimsData(id, days) {
  const key = process.env.AIMS_API_KEY;
  if (!key) return null;
  days = Math.max(1, Math.min(14, days || 2));
  const ck = `aims:d:${id}:${days}`;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) { const o = JSON.parse(result); if (Date.now() - o.at < 30 * 60e3) return o.rows; } } catch (_) {}
  const from = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19), thru = new Date(Date.now() + 3600e3).toISOString().slice(0, 19);
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), 20000);
  let rows = [];
  try {
    let url = `${AIMS}/data?series_id=${id}&from_date=${from}&thru_date=${thru}&size=5000`;
    for (let page = 0; page < 3 && url; page++) {
      const r = await fetch(url, { signal: c.signal, headers: { 'X-API-Key': key, 'User-Agent': 'OceanTemp (otemp.app)' } });
      if (!r.ok) { aimsLastErr = { status: r.status, body: (await r.text()).slice(0, 200), from }; break; }
      const j = await r.json();
      if (page === 0) aimsLastErr = { status: r.status, n: (j.results || []).length, keys: Object.keys(j), sample: (j.results || [])[0] || null };
      (j.results || []).forEach(o => { const v = +o.qc_val; if (Number.isFinite(v) && v > -2 && v < 40 && o.time) rows.push({ t: o.time, wt: +v.toFixed(2) }); });
      url = j.links && j.links.next ? j.links.next : (j.cursor ? `${AIMS}/data?series_id=${id}&from_date=${from}&thru_date=${thru}&size=5000&cursor=${encodeURIComponent(j.cursor)}` : null);
      if (!(j.results || []).length) break;
    }
  } catch (e) { aimsLastErr = { error: String(e && e.message || e) }; } finally { clearTimeout(tm); }
  rows.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  if (rows.length) { try { await redisPipeline([['SET', ck, JSON.stringify({ at: Date.now(), rows }), 'EX', '7200']]); } catch (_) {} }
  return rows;
}
// ───────── [ADD] 대만 중앙기상서(CWA) 부이·조위소 실측 + 조석 예보 ─────────
//  키: Vercel 환경변수 CWA_API_KEY. 자료: 氣象資料開放平臺 O-B0076-001(측정소 목록), O-B0075-001(48시간 실측), F-A0021-001(1개월 조석 예보)
const CWA = 'https://opendata.cwa.gov.tw';
const inTw = (lat, lon) => lat > 21.3 && lat < 26.6 && lon > 118 && lon < 122.6;
const nz = (v) => v == null || v === '' || v === 'None' || v === '-' ? null : (Number.isFinite(+v) ? +v : null);
async function cwaGet(path, ms) {
  const key = process.env.CWA_API_KEY;
  if (!key) return null;
  return getJSON(`${CWA}${path}${path.includes('?') ? '&' : '?'}Authorization=${encodeURIComponent(key)}&format=JSON`, ms || 20000);
}
async function cwaStations() {
  try { const [{ result }] = await redisPipeline([['GET', 'cwa:st']]); if (result) { const o = JSON.parse(result); if (Date.now() - o.at < 7 * 86400e3) return o.list; } } catch (_) {}
  let j = await cwaGet('/fileapi/v1/opendataapi/O-B0076-001?downloadType=WEB', 25000);
  if (!j || !j.cwaopendata) j = await getJSON(`${CWA}/webapi/datasetExample/O-B0076-001/JSON`, 20000); // 키 파일 API가 안 되면 공개 예시(같은 형식)
  const L = (((((j || {}).cwaopendata || {}).Resources || {}).Resource || {}).Data || {}).SeaSurfaceObs;
  const list = ((L && L.Location) || []).map(l => l.Station || {}).map(s => ({ id: String(s.StationID), name: s.StationName, nameEn: s.StationNameEN, kind: s.StationAttribute, lat: +s.StationLatitude, lon: +s.StationLongitude }))
    .filter(s => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (list.length) { try { await redisPipeline([['SET', 'cwa:st', JSON.stringify({ at: Date.now(), list }), 'EX', String(14 * 86400)]]); } catch (_) {} }
  return list;
}
// 48시간 실측 { 측정소ID: [{ t(ISO+08:00), wt, tide(m), wv, per, ws, wd, gust }] } - 30분 저장
async function cwaObsAll() {
  try { const [{ result }] = await redisPipeline([['GET', 'cwa:obs']]); if (result) { const o = JSON.parse(result); if (Date.now() - o.at < 30 * 60e3) return o.by; } } catch (_) {}
  const j = await cwaGet('/api/v1/rest/datastore/O-B0075-001', 30000);
  const locs = (((j || {}).Records || {}).SeaSurfaceObs || {}).Location || [];
  const by = {};
  locs.forEach(l => {
    const id = String((l.Station || {}).StationID || ''); if (!id) return;
    const rows = (((l.StationObsTimes || {}).StationObsTime) || []).map(o => {
      const w = o.WeatherElements || {}, a = w.PrimaryAnemometer || {};
      const r = { t: o.DateTime, wt: nz(w.SeaTemperature), tide: nz(w.TideHeight), wv: nz(w.WaveHeight), per: nz(w.WavePeriod), ws: nz(a.WindSpeed), wd: nz(a.WindDirection), gust: nz(a.MaximumWindSpeed) };
      return Object.values(r).filter(v => v != null).length > 1 ? r : null;
    }).filter(Boolean).sort((x, y) => Date.parse(x.t) - Date.parse(y.t));
    if (rows.length) by[id] = rows;
  });
  if (Object.keys(by).length) { try { await redisPipeline([['SET', 'cwa:obs', JSON.stringify({ at: Date.now(), by }), 'EX', '7200']]); } catch (_) {} }
  return by;
}
// 조석 예보(향후 8일) [{ id, name, lat, lon, ev:[{ t, type, h(m, 그 지역 평균해면 기준) }] }] - 하루 저장
async function cwaTideFc() {
  try { const [{ result }] = await redisPipeline([['GET', 'cwa:tide2']]); if (result) { const o = JSON.parse(result); if (Date.now() - o.at < 12 * 3600e3) return o.list; } } catch (_) {}
  const j = await cwaGet('/api/v1/rest/datastore/F-A0021-001', 40000);
  const end = Date.now() + 8 * 86400e3, start = Date.now() - 86400e3;
  const list = ((((j || {}).records || {}).TideForecasts) || []).map(x => x.Location || {}).map(l => ({
    id: l.LocationId, name: l.LocationName, lat: +l.Latitude, lon: +l.Longitude,
    ev: (((l.TimePeriods || {}).Daily) || []).flatMap(d => d.Time || []).map(e => ({ t: e.DateTime, type: /滿/.test(e.Tide) ? 'high' : /乾/.test(e.Tide) ? 'low' : '', h: nz((e.TideHeights || {}).AboveLocalMSL) }))
      .filter(e => e.type && e.h != null && Date.parse(e.t) >= start && Date.parse(e.t) <= end).map(e => ({ ...e, h: +(e.h / 100).toFixed(2) }))
      .sort((x, y) => Date.parse(x.t) - Date.parse(y.t))
  })).filter(l => Number.isFinite(l.lat) && Number.isFinite(l.lon) && l.ev.length);
  if (list.length) { try { await redisPipeline([['SET', 'cwa:tide2', JSON.stringify({ at: Date.now(), list }), 'EX', String(2 * 86400)]]); } catch (_) {} }
  return list;
}
// 정점 근처: 수온·파도는 값이 있는 가장 가까운 부이/측정소(25km), 조위는 가장 가까운 조위소(25km), 예보는 가장 가까운 예보 지점(40km)
async function cwaNear(lat, lon) {
  const [sts, by, fc] = await Promise.all([cwaStations().catch(() => []), cwaObsAll().catch(() => ({})), cwaTideFc().catch(() => [])]);
  const cand = near(sts, lat, lon, 25).filter(s => by[s.id]);
  const has = (s, k) => by[s.id].some(r => r[k] != null);
  const tSt = cand.find(s => has(s, 'wt')), tdSt = cand.find(s => has(s, 'tide') && /潮位/.test(s.kind || s.name)) || cand.find(s => has(s, 'tide'));
  const wSt = cand.find(s => has(s, 'ws')), vSt = cand.find(s => has(s, 'wv'));
  const f = near(fc, lat, lon, 40)[0] || null;
  const pack = (s) => s ? { id: s.id, name: s.name, nameEn: s.nameEn, dist: +s.dist.toFixed(1) } : null;
  return { temp: pack(tSt), tide: pack(tdSt), wind: pack(wSt), wave: pack(vSt), rows: Object.fromEntries([tSt, tdSt, wSt, vSt].filter(Boolean).map(s => [s.id, by[s.id]])),
    forecast: f ? { id: f.id, name: f.name, dist: +f.dist.toFixed(1), ev: f.ev } : null };
}
const inUs = (lat, lon) => (lon > -180 && lon < -60 && lat > 10 && lat < 72) || (lon > 140 && lon < 150 && lat > 10 && lat < 22);

// 위성 수온 격자(지구 바다 색과 같은 것)에서 그 자리 값 - 고장 센서 거르기용
function satAt(grid, lat, lon) {
  if (!grid) return null;
  const row = Math.round(grid.lat0 - lat), col = Math.round(lon - grid.lon0);
  for (let r = 0; r <= 2; r++) for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
    const rr = row + dr, cc = ((col + dc) % grid.w + grid.w) % grid.w;
    if (rr < 0 || rr >= grid.h) continue;
    const v = grid.v[rr * grid.w + cc];
    if (v != null) return v * grid.scale;
  }
  return null;
}

// 관측소별 최신 수온 { t, at } (같은 관측소는 한 번만 부르게 기억)
function makeLatest(base) {
  const memo = new Map();
  const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn().catch(() => null)); return memo.get(k); };
  const lastOf = (rows, timeOf) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].wt != null && Number.isFinite(+rows[i].wt)) return { t: +rows[i].wt, at: timeOf(rows[i]) }; return null; };
  const kst = (s) => Date.parse(String(s).replace(' ', 'T') + ':00+09:00');
  return {
    khoa: (code) => once('k' + code, async () => { const j = await getJSON(`${base}/api/khoa?svc=obs&obs=${code}&days=2`, 30000); return j && j.ok ? lastOf(j.rows || [], r => kst(r.t)) : null; }),
    kma: (stn) => once('m' + stn, async () => { const j = await getJSON(`${base}/api/kma?svc=obs&stn=${stn}&days=1`, 30000); return j && j.ok ? lastOf(j.rows || [], r => kst(r.t)) : null; }),
    coops: (id) => once('c' + id, async () => {
      const j = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${id}&product=water_temperature&date=latest&units=metric&time_zone=gmt&format=json&application=OceanTemp`, 15000);
      const d = j && j.data && j.data[0]; if (!d || d.v === '' || !Number.isFinite(+d.v)) return null;
      return { t: +d.v, at: Date.parse(d.t.replace(' ', 'T') + ':00Z') };
    }),
    ndbc: (id) => once('n' + id, async () => { const j = await getJSON(`${base}/api/noaa?svc=ndbc&id=${id}`, 20000); return j && j.ok ? lastOf((j.rows || []).map(r => ({ ...r, wt: r.wtmp })), r => r.t) : null; }),
    aims: (id) => once('a' + id, async () => { const rows = await aimsData(id, 2); const r = rows && rows[rows.length - 1]; return r ? { t: r.wt, at: Date.parse(r.t) } : null; }),
    cmems: (id) => once('e' + id, async () => { const j = await getJSON(`${base}/api/cmems?svc=obs&id=${encodeURIComponent(id)}&days=2`, 40000); return j && j.ok ? lastOf(j.rows || [], r => r.t) : null; })
  };
}

async function build(base) {
  const [spots, kh, km_, nw, cm, gridRaw] = await Promise.all([
    loadSpots(base),
    getJSON(`${base}/api/khoa?svc=stations`, 40000),
    getJSON(`${base}/api/kma?svc=stations`, 30000),
    getJSON(`${base}/api/noaa?svc=stations`, 40000),
    getJSON(`${base}/api/cmems?svc=stations`, 40000),
    redisPipeline([['GET', 'sst:grid']]).then(r => r[0].result ? JSON.parse(JSON.parse(r[0].result).body) : null).catch(() => null)
  ]);
  const seoulP = spots.some(s => inSeoulHan(s.lat, s.lon)) ? seoulHan().catch(() => null) : Promise.resolve(null);
  const aimsP = spots.some(s => inAus(s.lat, s.lon)) && process.env.AIMS_API_KEY ? aimsSeries().catch(() => []) : Promise.resolve([]);
  const L = makeLatest(base);
  const khList = kh && kh.ok ? kh.stations : [], kmList = km_ && km_.ok ? km_.stations : [];
  const now = Date.now();
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < spots.length) {
      const s = spots[next++];
      // 후보: [거리순 관측소, 최신값 함수, 표시용 출처]
      let cands = [];
      if (inSeoulHan(s.lat, s.lon)) {
        const sh = await seoulP;
        const pk = seoulPick(s.lat, s.lon);
        const v = sh && sh[pk.n];
        if (v && now - v.at <= MAX_AGE && v.t > -2 && v.t < 36) {
          const extra = Object.entries(sh).filter(([n]) => n !== pk.n).map(([n, x]) => ({ name: n, t: x.t }));
          out.push({ lat: s.lat, lon: s.lon, t: +v.t.toFixed(1), at: v.at, src: { kind: 'seoul', name: `${pk.n === '선유' ? '한강 선유' : pk.n} (서울시 수질측정소)`, dist: +pk.d.toFixed(1), river: true, extra } });
          continue;
        }
      }
      if (inKorea(s.lat, s.lon)) {
        cands = [
          ...near(khList, s.lat, s.lon, 25, k => k.kind !== 'buoy').slice(0, 1).map(k => ({ dist: k.dist, get: () => L.khoa(k.code), src: { kind: 'khoa', name: k.name } })),
          ...near(khList, s.lat, s.lon, 40, k => k.kind === 'buoy').slice(0, 1).map(k => ({ dist: k.dist, get: () => L.khoa(k.code), src: { kind: 'khoa', name: k.name, buoy: true } })),
          ...near(kmList, s.lat, s.lon, 40).slice(0, 1).map(k => ({ dist: k.dist, get: () => L.kma(k.id), src: { kind: 'kma', name: k.name, buoy: true } }))
        ].sort((a, b) => a.dist - b.dist);
      } else if (inTw(s.lat, s.lon) && process.env.CWA_API_KEY) {
        const n = await cwaNear(s.lat, s.lon).catch(() => null);
        const st = n && n.temp;
        if (st) cands = [{ dist: st.dist, get: async () => { const r = n.rows[st.id].filter(x => x.wt != null).pop(); return r ? { t: r.wt, at: Date.parse(r.t) } : null; }, src: { kind: 'cwa', name: st.name } }];
      } else if (inAus(s.lat, s.lon) && (await aimsP).length) {
        const a = near(await aimsP, s.lat, s.lon, AIMS_KM).slice(0, 1).map(k => ({ dist: k.dist, get: () => L.aims(k.id), src: { kind: 'aims', name: `${k.site} ${k.depth}m` } }));
        const e = near(cm && cm.ok ? cm.stations : [], s.lat, s.lon, 40, k => k.p.includes('T')).slice(0, 1).map(k => ({ dist: k.dist, get: () => L.cmems(k.id), src: { kind: 'cmems', name: k.name } }));
        cands = [...a, ...e];
      } else if (inUs(s.lat, s.lon)) {
        const c = near(nw && nw.coops, s.lat, s.lon, 25, k => k.wt).slice(0, 1).map(k => ({ dist: k.dist, get: () => L.coops(k.id), src: { kind: 'coops', name: k.name } }));
        const b = near(nw && nw.ndbc, s.lat, s.lon, 60).slice(0, 1).map(k => ({ dist: k.dist, get: () => L.ndbc(k.id), src: { kind: 'ndbc', name: k.id } }));
        cands = [...c, ...b]; // 표와 같은 순서: CO-OPS 수온이 있으면 그것, 없으면 NDBC
      } else {
        cands = near(cm && cm.ok ? cm.stations : [], s.lat, s.lon, 40, k => k.p.includes('T')).slice(0, 2)
          .map(k => ({ dist: k.dist, get: () => L.cmems(k.id), src: { kind: 'cmems', name: k.name } }));
      }
      const sat = satAt(gridRaw, s.lat, s.lon);
      for (const c of cands) {
        const v = await c.get();
        if (!v || !Number.isFinite(v.t) || v.t < -2 || v.t > 36) continue;
        if (!(now - v.at <= MAX_AGE)) continue;
        if (sat != null && Math.abs(v.t - sat) > 6) continue;
        out.push({ lat: s.lat, lon: s.lon, t: +v.t.toFixed(1), at: v.at, src: { ...c.src, dist: +c.dist.toFixed(1) } });
        break;
      }
    }
  }));
  return { updated: now, count: out.length, of: spots.length, spots: out };
}

module.exports = async function handler(req, res) {
  // [ADD] 포인트별 검색용 페이지·사이트맵(/ko/s/39/문섬, /sitemap.xml) - 함수 개수를 늘리지 않으려고 여기서 처리
  const svc = (req.query || {}).svc;
  if (svc === 'page' || svc === 'index' || svc === 'sitemap' || svc === 'go') return require('./_spotpage')(req, res);
  // [ADD] 국립해양조사원 자연과학용 수심(150m 격자): /api/spotobs?svc=depth&ymin=..&ymax=..&xmin=..&xmax=..
  //  공공데이터포털 "해양수산부 국립해양조사원_자연과학용 수심정보 조회" 활용신청 필요(KHOA_API_KEY와 같은 키). 범위는 한 변 0.2° 이하.
  //  응답: { ok, n, rows: [[위도, 경도, 수심m(양수=물 깊이)], ...] }. 같은 범위는 30일 저장.
  // [ADD] 지도용 수심 타일(줌 13 고정): /api/spotobs?svc=dtile&x=..&y=.. (격자) · svc=dvec (미리 계산한 다각형·등심선)
  if (svc === 'dtile' || svc === 'dvec') {
    try {
      const D = require('./_depth'), r = svc === 'dvec' ? await D.depthVec(req.query.x, req.query.y, { fill: req.query.fill === '1' }) : await D.depthTile(req.query.x, req.query.y);
      if (!r) return res.status(400).json({ ok: false });
      res.setHeader('Cache-Control', r.ok && !r.tmp ? 'public, s-maxage=2592000, max-age=86400' : r.ok ? 'public, s-maxage=600, max-age=300' : r.retry ? 'no-store' : 's-maxage=3600'); // tmp = 해외 위치 보정 실패본(잠깐만 보관 후 다시 시도)
      return res.status(200).json(r);
    } catch (e) { return res.status(200).json({ ok: false, error: String(e && e.message || e).replace(/serviceKey=[^&\s]+/g, 'serviceKey=***') }); }
  }
  // [ADD] 포인트 주변 수심(지역별 최적 자료 자동 선택): /api/spotobs?svc=depth&lat=..&lon=..(&lite=1 → 격자 빼고 요약만)
  if (svc === 'depth' && req.query.lat !== undefined) {
    try {
      const D = require('./_depth');
      const r = await D.depthAt(req.query.lat, req.query.lon, { fresh: req.query.fresh === '1' && !!req.query.k && req.query.k === process.env.CRON_SECRET });
      if (!r) return res.status(400).json({ ok: false });
      res.setHeader('Cache-Control', r.ok ? 's-maxage=604800, stale-while-revalidate=2592000' : 'no-store');
      if (req.query.lite === '1' && r.ok) { const { grid, ...rest } = r; return res.status(200).json(rest); }
      return res.status(200).json(r);
    } catch (e) { return res.status(200).json({ ok: false, error: String(e && e.message || e).replace(/serviceKey=[^&\s]+/g, 'serviceKey=***') }); }
  }
  if (svc === 'depth') {
    try {
      const q = req.query, r4 = (v) => Math.round(+v * 1e4) / 1e4;
      const b = { ymin: r4(q.ymin), ymax: r4(q.ymax), xmin: r4(q.xmin), xmax: r4(q.xmax) };
      if (Object.values(b).some(v => !Number.isFinite(v)) || b.ymax <= b.ymin || b.xmax <= b.xmin || b.ymax - b.ymin > 0.2 || b.xmax - b.xmin > 0.2) return res.status(400).json({ ok: false, reason: 'bbox' });
      const key = process.env.KHOA_API_KEY;
      if (!key) return res.status(200).json({ ok: false, reason: 'no_key' });
      const ck = `depth:khoa:${b.ymin}_${b.ymax}_${b.xmin}_${b.xmax}`;
      try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) { res.setHeader('Cache-Control', 's-maxage=86400'); res.setHeader('Content-Type', 'application/json'); return res.status(200).send(result); } } catch (_) {}
      const page = async (no) => {
        const url = `https://apis.data.go.kr/1192136/waterDepth/GetWaterDepthApiService?serviceKey=${encodeURIComponent(key)}&type=json&ymin=${b.ymin}&ymax=${b.ymax}&xmin=${b.xmin}&xmax=${b.xmax}&pageNo=${no}&numOfRows=300`;
        const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
        try {
          const t = await (await fetch(url, { signal: ctl.signal })).text();
          let j; try { j = JSON.parse(t); } catch (_) { throw new Error('응답 ' + t.slice(0, 120)); }
          const body = (j.response && j.response.body) || j.body || {}, head = (j.response && j.response.header) || j.header || {};
          if (head.resultCode && head.resultCode !== '00') throw new Error(`${head.resultCode} ${head.resultMsg || ''}`);
          let it = body.items && body.items.item; if (it && !Array.isArray(it)) it = [it];
          return { total: +body.totalCount || 0, rows: (it || []).map(x => [+x.lat, +x.lot, +x.dpwt]).filter(r => r.every(Number.isFinite)) };
        } finally { clearTimeout(tm); }
      };
      const first = await page(1);
      const pages = Math.min(40, Math.ceil(first.total / 300));
      const rows = first.rows.slice();
      for (let p = 2; p <= pages; p += 5) {
        const got = await Promise.all(Array.from({ length: Math.min(5, pages - p + 1) }, (_, i) => page(p + i).catch(() => ({ rows: [] }))));
        got.forEach(g => rows.push(...g.rows));
      }
      const out = JSON.stringify({ ok: rows.length > 0, n: rows.length, total: first.total, bbox: b, rows, source: '국립해양조사원 자연과학용 수심정보(150m), 공공누리 제1유형' });
      if (rows.length) { try { await redisPipeline([['SET', ck, out, 'EX', String(30 * 86400)]]); } catch (_) {} }
      res.setHeader('Cache-Control', rows.length ? 's-maxage=86400' : 'no-store');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(out);
    } catch (e) { return res.status(200).json({ ok: false, error: String(e && e.message || e).replace(/serviceKey=[^&\s]+/g, 'serviceKey=***') }); }
  }
  // [ADD] 대만 CWA: /api/spotobs?svc=cwa&lat=..&lon=.. → 근처 부이·조위소 48시간 실측 + 조석 예보
  if (svc === 'cwa') {
    try {
      const lat = +req.query.lat, lon = +req.query.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ ok: false });
      if (!process.env.CWA_API_KEY) return res.status(200).json({ ok: false, reason: 'no_key' });
      const n = await cwaNear(lat, lon);
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
      return res.status(200).json({ ok: !!(n.temp || n.tide || n.wind || n.wave || n.forecast), ...n, source: '中央氣象署 氣象資料開放平臺 (CWA Open Data)' });
    } catch (e) { return res.status(200).json({ ok: false, error: String(e && e.message || e) }); }
  }
  // [ADD] 호주 AIMS: /api/spotobs?svc=aims&lat=..&lon=..&days=7 → 가장 가까운 관측소(70km)의 수온
  if (svc === 'aims') {
    try {
      const lat = +req.query.lat, lon = +req.query.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ ok: false });
      const st = near(await aimsSeries(), lat, lon, AIMS_KM)[0];
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
      if (!st) return res.status(200).json({ ok: false, reason: 'no_station' });
      const rows = await aimsData(st.id, parseInt(req.query.days, 10) || 7);
      return res.status(200).json({ ok: !!(rows && rows.length), station: { site: st.site, subsite: st.subsite, depth: st.depth, dist: +st.dist.toFixed(1), lat: st.lat, lon: st.lon },
        rows: rows || [], debug: req.query.debug === '1' ? aimsLastErr : undefined, source: 'AIMS Weather Stations (CC-BY)' + (process.env.AIMS_API_KEY ? '' : ' - AIMS_API_KEY 없음') });
    } catch (e) { return res.status(200).json({ ok: false, error: String(e && e.message || e) }); }
  }
  // [ADD] 서울 한강 측정소 시간별 수온(앱 실시간 표·추이용): /api/spotobs?svc=seoul&days=7
  if (svc === 'seoul') {
    try {
      const rows = await seoulRows(parseInt(req.query.days, 10) || 7);
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
      return res.status(200).json({ ok: !!rows && Object.keys(rows).length > 0, stations: Object.entries(SEOUL_STN).map(([name, [lat, lon, main]]) => ({ name, lat, lon, main })), rows: rows || {},
        source: '서울특별시 한강 수질 자동측정망 (서울 열린데이터광장, 공공누리 1유형)' });
    } catch (e) { return res.status(200).json({ ok: false, error: String(e && e.message || e) }); }
  }
  const t0 = Date.now();
  const send = (body, tag) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=86400');
    res.setHeader('X-Spotobs-Cache', tag);
    res.status(200).send(body);
  };
  let saved = null;
  try { const [{ result }] = await redisPipeline([['GET', KEY]]); if (result) saved = JSON.parse(result); } catch (_) {}
  if (saved && Date.now() - saved.updated < 3600e3 && req.query.refresh !== '1') return send(saved.body, 'redis');
  try {
    const base = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const r = await build(base);
    const body = JSON.stringify({ ok: true, ms: Date.now() - t0, ...r });
    if (r.count > 0) { try { await redisPipeline([['SET', KEY, JSON.stringify({ updated: r.updated, body }), 'EX', String(3 * 86400)]]); } catch (_) {} }
    return send(body, 'fresh');
  } catch (e) {
    if (saved) return send(saved.body, 'redis-stale');
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ ok: false, error: String(e && e.message || e) });
  }
};
