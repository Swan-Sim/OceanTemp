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
  return list.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && !/^n/i.test(s.show));
}

const km = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const near = (list, lat, lon, maxKm, f) => (list || []).filter(k => !f || f(k)).map(k => ({ ...k, dist: km(lat, lon, k.lat, k.lon) })).filter(k => k.dist <= maxKm).sort((a, b) => a.dist - b.dist);
const inKorea = (lat, lon) => lat > 32 && lat < 39.5 && lon > 124 && lon < 132.5;
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
