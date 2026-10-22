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
// ── KMA(한국 기상청 API허브): 서태평양, 시점 기준 현재 태풍 + 예보 (KMA_API_KEY 필요) ──
async function kma() {
  const key = process.env.KMA_API_KEY; if (!key) return [];
  const tm = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // UTC YYYYMMDDHHMM
  const txt = await getText(`https://apihub.kma.go.kr/api/typ01/url/typ_now.php?tm=${tm}&mode=1&disp=1&help=1&authKey=${encodeURIComponent(key)}`, 10000);
  if (!txt) return [];
  const lines = txt.split(/\r?\n/); let cols = null; const rows = [];
  for (const ln of lines) { const t = ln.trim(); if (!t) continue;
    if (t.startsWith('#')) { const c = t.replace(/^#\s*/, '').split(/\s*,\s*/); if (c.includes('LAT') && c.includes('LON')) cols = c; continue; }
    if (!cols) continue; const v = t.split(/\s*,\s*/); if (v.length < cols.length - 1) continue; const o = {}; cols.forEach((k, i) => { o[k] = (v[i] || '').trim(); }); rows.push(o); }
  const by = {}; rows.forEach(o => { const id = `${o.YY || ''}-${o.TYP || ''}`; (by[id] = by[id] || []).push(o); });
  const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
  const ftTm = (s) => { const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})?/); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5] || '00'}:00Z` : null; };
  const out = [];
  Object.entries(by).forEach(([id, rs]) => {
    const an = rs.find(r => r.FT === '0' || r.FT === '0.0') || rs[0]; const lat = num(an.LAT), lon = num(an.LON); if (lat == null || lon == null) return;
    const fcs = rs.filter(r => r.FT === '1' && num(r.LAT) != null).sort((a, b) => num(a.TMD) - num(b.TMD));
    out.push({ id: 'kma:' + id, src: 'kma', name: String(an.TYP_EN || an.TYP_NAME || '').toUpperCase().trim(), nameKo: an.TYP_NAME || '', num: num(an.TYP), cat: num(an.WS) >= 17 ? 'TY' : 'TD', catKo: num(an.WS) >= 17 ? '태풍' : '열대저압부', intensity: '',
      pressure: num(an.PS), wind: num(an.WS), gust: null, lat, lon, at: ftTm(an.TYP_TM || an.FT_TM), issue: ftTm(an.TYP_TM),
      move: { dir: an.DIR || '', kmh: num(an.SP) }, radii: { storm: num(an.RAD25), gale: num(an.RAD15) }, track: [],
      forecast: fcs.map(r => ({ h: num(r.TMD), t: ftTm(r.FT_TM), lat: num(r.LAT), lon: num(r.LON), r: num(r.RAD), pressure: num(r.PS), wind: num(r.WS), cat: '', storm: num(r.RAD25) })), url: 'https://www.weather.go.kr/w/typhoon/typ-info.do' });
  });
  return out;
}
// ── NHC: 대서양·동태평양 - 현재 위치 + 예보 통보문(forecast advisory 글)에서 예보 위치 뽑기 ──
async function nhc() {
  const j = await getJSON('https://www.nhc.noaa.gov/CurrentStorms.json'); const arr = j && j.activeStorms; if (!Array.isArray(arr)) return [];
  const advs = await Promise.all(arr.map(s => s.forecastAdvisory && s.forecastAdvisory.url ? getText(s.forecastAdvisory.url, 8000) : null));
  // "FORECAST VALID 23/0600Z 39.8N  65.6W" + 다음 줄 "MAX WIND  55 KT...GUSTS  65 KT." 를 예보 점으로. 기준 시각 줄 "... AT 0300Z ..."
  const parseAdv = (txt, lastUpdate) => { if (!txt) return []; const out = []; const base = lastUpdate ? Date.parse(lastUpdate) : Date.now();
    const re = /(FORECAST|OUTLOOK) VALID\s+(\d{2})\/(\d{2})(\d{2})Z\s+([\d.]+)([NS])\s+([\d.]+)([EW])[^\n]*\n(?:[^\n]*MAX WIND\s+(\d+)\s*KT)?/g; let m;
    while ((m = re.exec(txt))) { const d0 = new Date(base); let t = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), +m[2], +m[3], +m[4])); if (t.getTime() < base - 36e5 * 6) t = new Date(t.getTime() + 31 * 86400e3);
      const h = Math.round((t.getTime() - base) / 36e5); if (h <= 0) continue;
      out.push({ h, t: t.toISOString(), lat: +m[5] * (m[6] === 'S' ? -1 : 1), lon: +m[7] * (m[8] === 'W' ? -1 : 1), r: null, pressure: null, wind: m[9] ? +(+m[9] * KT).toFixed(1) : null, cat: '', storm: null }); }
    return out; };
  return arr.map((s, i) => ({ forecast: parseAdv(advs[i], s.lastUpdate), id: 'nhc:' + s.id, src: 'nhc', name: String(s.name || '').toUpperCase(), num: null, cat: s.classification || '', catKo: CAT_KO[s.classification] || (/^HU|MH/.test(s.classification || '') ? '허리케인' : '열대폭풍'),
    intensity: '', pressure: s.pressure != null ? +s.pressure : null, wind: s.intensity != null ? +(+s.intensity * KT).toFixed(1) : null, gust: null,
    lat: +s.latitudeNumeric, lon: +s.longitudeNumeric, at: s.lastUpdate || null, issue: s.lastUpdate || null,
    move: { dir: s.movementDir != null ? +s.movementDir : '', kmh: s.movementSpeed != null ? +(+s.movementSpeed * 1.852).toFixed(0) : null },
    radii: { storm: null, gale: null }, track: [], url: 'https://www.nhc.noaa.gov/' })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
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

// [CHANGE] 기관별 예보 경로를 따로 담아요: tracks = { jma: [...], kma: [...], nhc: [...] }. 겹치면 확실, 갈라지면 불확실
async function build() {
  const [j, k, n, gd] = await Promise.all([jma().catch(() => []), kma().catch(() => []), nhc().catch(() => []), gdacs().catch(() => [])]);
  const storms = [];
  const add = (s) => { const x = storms.find(x => near(x, s)); if (!x) { s.tracks = {}; if (s.forecast && s.forecast.length) s.tracks[s.src] = s.forecast; s.agencies = [s.src]; storms.push(s); return; }
    if (s.forecast && s.forecast.length) x.tracks[s.src] = s.forecast; x.agencies.push(s.src);
    if (s.nameKo && !x.nameKo) x.nameKo = s.nameKo; if (!x.num && s.num) x.num = s.num; if (!x.name && s.name) x.name = s.name;
    if (x.pressure == null && s.pressure != null) x.pressure = s.pressure; if (x.wind == null && s.wind != null) x.wind = s.wind;
    if (!x.radii.storm && s.radii.storm) x.radii.storm = s.radii.storm; if (!x.radii.gale && s.radii.gale) x.radii.gale = s.radii.gale;
    if (!x.track.length && s.track && s.track.length) x.track = s.track; if (s.alert && !x.alert) x.alert = s.alert; };
  [...j, ...k, ...n, ...gd].forEach(add);
  storms.forEach(s => { s.forecast = s.tracks.jma || s.tracks.kma || s.tracks.nhc || s.forecast || []; });
  return { ok: true, at: Date.now(), storms };
}
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const force = (req.query || {}).force === '1';
  // [ADD] ?debug=kma : 기상청 API허브 원문 앞부분만 보여줘요(열 이름·형식 확인용. 키는 안 나와요)
  if ((req.query || {}).debug === 'kma') { const key = process.env.KMA_API_KEY; const tm = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); res.setHeader('Cache-Control', 'no-store');
    if (!key) return res.status(200).json({ hasKey: false });
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 10000);
    try { const r = await fetch(`https://apihub.kma.go.kr/api/typ01/url/typ_now.php?tm=${tm}&mode=1&disp=1&help=1&authKey=${encodeURIComponent(key)}`, { signal: c.signal }); const txt = await r.text(); return res.status(200).json({ hasKey: true, tm, status: r.status, head: txt.slice(0, 3000) }); }
    catch (e) { return res.status(200).json({ hasKey: true, tm, error: String(e && e.message || e) }); } finally { clearTimeout(t); } }
  try {
    if (!force) { try { const [{ result }] = await redisPipeline([['GET', 'storms:v1']]); if (result) { res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800'); return res.status(200).send(result); } } catch (_) {} }
    const o = await build(); const body = JSON.stringify(o);
    try { await redisPipeline([['SET', 'storms:v1', body, 'EX', String(TTL)]]); } catch (_) {}
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800'); return res.status(200).send(body);
  } catch (e) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ ok: false, storms: [], error: String(e && e.message || e).slice(0, 200) }); }
};
module.exports.build = build;
