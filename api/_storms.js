// [ADD] 태풍·허리케인: /api/storms  - 활동 중인 열대저기압의 현재 위치·지나온 경로·예보 경로·예보원·강풍/폭풍 반경을 한 JSON 으로
//  자료: 일본 기상청 JMA(서태평양, 상세 예보) + 미국 NHC(대서양·동태평양 현재 위치) + GDACS(전 세계 목록, CC BY 4.0). 키 없이 공개.
//  서버가 30분마다 한 번 받아 Redis 에 두고(키 storms:v1), 방문자는 CDN 캐시(10분)로 읽어요. 태풍이 없으면 빈 목록.
const { redisPipeline } = require('./_redis');
const TTL = 30 * 60; // 초
async function getJSON(url, ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 8000);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'OceanTemp (otemp.app)' } }); if (!r.ok) return null; return await r.json(); } catch (_) { return null; } finally { clearTimeout(t); } }
async function getText(url, ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 8000);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'OceanTemp (otemp.app)' } }); if (!r.ok) return null; return await r.text(); } catch (_) { return null; } finally { clearTimeout(t); } }
const KT = 0.514444;
// 한국어 등급: JMA 분류 → 한국 기상청식 표현
const CAT_KO = { TY: '태풍', STS: '태풍', TS: '태풍', TD: '열대저압부', LOW: '온대저기압', HU: '허리케인', MH: '허리케인', PTC: '열대저기압' };

// ── JMA: 서태평양 ──
async function jma() {
  const list = await getJSON('https://www.jma.go.jp/bosai/typhoon/data/targetTc.json'); if (!Array.isArray(list)) return [];
  const out = [];
  for (const tc of list.slice(0, 6)) {
    const id = tc.tropicalCyclone; if (!id) continue;
    const [spec, fc] = await Promise.all([getJSON(`https://www.jma.go.jp/bosai/typhoon/data/${id}/specifications.json`), getJSON(`https://www.jma.go.jp/bosai/typhoon/data/${id}/forecast.json`)]);
    if (!Array.isArray(spec) || spec.length < 2) continue;
    const title = spec[0] || {}, ana = spec.find(x => x.advancedHours === 0) || spec[1];
    const name = (title.name && (title.name.en || title.name.jp)) || (fc && fc[0] && fc[0].name && fc[0].name.en) || `T${tc.typhoonNumber || ''}`;
    const num = tc.typhoonNumber ? parseInt(String(tc.typhoonNumber).slice(2), 10) : null; // 2630 → 30호
    const pos = ana.position && ana.position.deg; if (!pos) continue;
    const wind = ana.maximumWind && ana.maximumWind.sustained ? (ana.maximumWind.sustained['m/s'] != null ? +ana.maximumWind.sustained['m/s'] : (+ana.maximumWind.sustained.kt || 0) * KT) : null;
    const gust = ana.maximumWind && ana.maximumWind.gust ? (ana.maximumWind.gust['m/s'] != null ? +ana.maximumWind.gust['m/s'] : null) : null;
    const rad = (arr) => Array.isArray(arr) && arr.length ? Math.max(...arr.map(a => +(a.range && (a.range.km != null ? a.range.km : a.range)) || 0)) : null;
    const cat = (ana.category && ana.category.en) || tc.category || '';
    const forecast = spec.filter(x => x.advancedHours > 0 && x.position && x.position.deg).map(x => ({
      h: x.advancedHours, t: x.validtime && x.validtime.UTC || null, lat: +x.position.deg[0], lon: +x.position.deg[1],
      r: x.probabilityCircleRadius ? +(x.probabilityCircleRadius.km != null ? x.probabilityCircleRadius.km : x.probabilityCircleRadius) : null,
      pressure: x.pressure != null ? +x.pressure : null, wind: x.maximumWind && x.maximumWind.sustained ? (x.maximumWind.sustained['m/s'] != null ? +x.maximumWind.sustained['m/s'] : null) : null,
      cat: (x.category && x.category.en) || '', storm: rad(x.stormWarning) }));
    let track = [];
    try { const a = Array.isArray(fc) ? fc.find(x => x.advancedHours === 0 && x.track) : null; if (a) track = [...(a.track.preTyphoon || []), ...(a.track.typhoon || [])].map(p => [+p[0], +p[1]]); } catch (_) {}
    out.push({ id: 'jma:' + id, src: 'jma', name: String(name).toUpperCase(), num, cat, catKo: CAT_KO[cat] || '열대저기압', intensity: ana.intensity && ana.intensity !== '-' ? ana.intensity : '',
      pressure: ana.pressure != null ? +ana.pressure : null, wind: wind != null ? +wind.toFixed(1) : null, gust: gust != null ? +gust.toFixed(1) : null,
      lat: +pos[0], lon: +pos[1], at: ana.validtime && ana.validtime.UTC || null, issue: title.issue && title.issue.UTC || null,
      move: { dir: ana.course || '', kmh: ana.speed && ana.speed['km/h'] != null ? +ana.speed['km/h'] : null },
      radii: { storm: rad(ana.stormWarning), gale: rad(ana.galeWarning) }, track, forecast, url: 'https://www.jma.go.jp/bosai/map.html#contents=typhoon' });
  }
  return out;
}
// ── NHC: 대서양·동태평양 (현재 위치만; 예보 경로는 KMZ 라 생략) ──
async function nhc() {
  const j = await getJSON('https://www.nhc.noaa.gov/CurrentStorms.json'); const arr = j && j.activeStorms; if (!Array.isArray(arr)) return [];
  return arr.map(s => ({ id: 'nhc:' + s.id, src: 'nhc', name: String(s.name || '').toUpperCase(), num: null, cat: s.classification || '', catKo: CAT_KO[s.classification] || (/^HU|MH/.test(s.classification || '') ? '허리케인' : '열대폭풍'),
    intensity: '', pressure: s.pressure != null ? +s.pressure : null, wind: s.intensity != null ? +(+s.intensity * KT).toFixed(1) : null, gust: null,
    lat: +s.latitudeNumeric, lon: +s.longitudeNumeric, at: s.lastUpdate || null, issue: s.lastUpdate || null,
    move: { dir: s.movementDir != null ? +s.movementDir : '', kmh: s.movementSpeed != null ? +(+s.movementSpeed * 1.852).toFixed(0) : null },
    radii: { storm: null, gale: null }, track: [], forecast: [], url: 'https://www.nhc.noaa.gov/' })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}
// ── GDACS: 전 세계 목록(위 두 곳에 없는 것만 보탬) ──
async function gdacs() {
  const xml = await getText('https://www.gdacs.org/xml/rss.xml', 10000); if (!xml) return [];
  const items = xml.split('<item>').slice(1); const out = [];
  const g = (s, tag) => { const m = s.match(new RegExp(`<${tag}[^>]*>([^<]*)<`)); return m ? m[1].trim() : ''; };
  for (const it of items) {
    if (g(it, 'gdacs:eventtype') !== 'TC' || g(it, 'gdacs:iscurrent') === 'false') continue;
    const pt = g(it, 'georss:point').split(/\s+/).map(Number); if (pt.length < 2 || !pt.every(Number.isFinite)) continue;
    const sev = g(it, 'gdacs:severity'), m = sev.match(/([\d.]+)\s*km\/h/);
    out.push({ id: 'gdacs:' + g(it, 'gdacs:eventid'), src: 'gdacs', name: String(g(it, 'gdacs:eventname') || '').replace(/-\d+$/, '').toUpperCase(), num: null, cat: '', catKo: '열대저기압', intensity: '',
      pressure: null, wind: m ? +(+m[1] / 3.6).toFixed(1) : null, gust: null, lat: pt[0], lon: pt[1], at: g(it, 'gdacs:datemodified') || null, issue: g(it, 'gdacs:datemodified') || null,
      move: { dir: '', kmh: null }, radii: { storm: null, gale: null }, track: [], forecast: [], alert: g(it, 'gdacs:alertlevel'), url: g(it, 'link') });
  }
  return out;
}
const near = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180)) < 3; // 3° 안이면 같은 태풍

async function build() {
  const [j, n, gd] = await Promise.all([jma().catch(() => []), nhc().catch(() => []), gdacs().catch(() => [])]);
  const storms = [...j, ...n];
  gd.forEach(s => { if (!storms.some(x => near(x, s))) storms.push(s); else { const x = storms.find(x => near(x, s)); if (x && !x.alert) x.alert = s.alert; } });
  return { ok: true, at: Date.now(), storms };
}
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const force = (req.query || {}).force === '1';
  try {
    if (!force) { try { const [{ result }] = await redisPipeline([['GET', 'storms:v1']]); if (result) { res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800'); return res.status(200).send(result); } } catch (_) {} }
    const o = await build(); const body = JSON.stringify(o);
    try { await redisPipeline([['SET', 'storms:v1', body, 'EX', String(TTL)]]); } catch (_) {}
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800'); return res.status(200).send(body);
  } catch (e) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ ok: false, storms: [], error: String(e && e.message || e).slice(0, 200) }); }
};
module.exports.build = build;
