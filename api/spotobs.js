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
  let text = await getText(SHEET, 8000);
  if (!text || !/lat/i.test(text.split('\n')[0])) text = await getText(`${base}/data/stations.csv`, 8000);
  if (!text) return [];
  const [head, ...rows] = parseCsv(text);
  const idx = Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), i]));
  const list = rows.map(r => ({ lat: parseFloat(r[idx.lat]), lon: parseFloat(r[idx.lon]), show: (r[idx.show] || '').trim() }));
  // [ADD] 승인된 사용자 등록 포인트도 함께
  try { const [{ result }] = await redisPipeline([['HVALS', 'spots:extra']]); (result || []).forEach(v => { try { const s = JSON.parse(v); if (s.show !== false) list.push({ lat: +s.lat, lon: +s.lon, show: 'Y' }); } catch (_) {} }); } catch (_) {}
  // [ADD] 기본 포인트(한강 측정소)
  require('./_store').BUILTIN_SPOTS.forEach(b => { if (!list.some(s => Math.abs(s.lat - b.lat) < 1e-4 && Math.abs(s.lon - b.lon) < 1e-4)) list.push({ lat: b.lat, lon: b.lon, show: 'Y' }); });
  return list.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && !/^n/i.test(s.show));
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
  if (svc === 'page' || svc === 'index' || svc === 'sitemap') return require('./_spotpage')(req, res);
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
