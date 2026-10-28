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
  // [FIX] 응답이 EUC-KR 이라 한글이 깨지던 것 → euc-kr 로 읽어요. 열 이름 줄은 쉼표가 아니라 빈칸으로 나뉘고 "(UTC)"·"LOC----ED25" 같은 군더더기가 붙어요
  const getKr = async (url) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 10000);
    try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) return null; const buf = await r.arrayBuffer(); try { return new TextDecoder('euc-kr').decode(buf); } catch (_) { return new TextDecoder().decode(buf); } } catch (_) { return null; } finally { clearTimeout(t); } };
  const parse = (txt) => { const lines = String(txt || '').split(/\r?\n/); let cols = null; const rows = [];
    for (const ln of lines) { const t = ln.trim(); if (!t) continue;
      if (t.startsWith('#')) { const c = t.replace(/^#\s*/, '').replace(/\(UTC\)/g, '').split(/-{3,}|\s+|,/).map(x => x.trim()).filter(Boolean); if ((c.includes('LAT') && c.includes('LON')) || (c.includes('YY') && c.includes('SEQ') && c.length >= 4)) cols = c; continue; } // 열 이름 줄: typ_now(LAT·LON) 또는 typ_lst(YY·SEQ·TYP_EN…)
      if (!cols) continue; const v = t.replace(/,?=\s*$/, '').split(','); if (v.length < Math.min(cols.length, 8)) continue; const o = {}; cols.forEach((k, i) => { o[k] = (v[i] || '').trim(); }); rows.push(o); }
    return rows; };
  const tm = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // UTC YYYYMMDDHHMM
  const rows = parse(await getKr(`https://apihub.kma.go.kr/api/typ01/url/typ_now.php?tm=${tm}&mode=1&disp=1&help=1&authKey=${encodeURIComponent(key)}`));
  if (!rows.length) return [];
  const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) && n > -900 ? n : null; };
  const ftTm = (s) => { const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})?/); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5] || '00'}:00Z` : null; };
  // 이름은 이 API에 없어요 → 올해 태풍 목록(typ_lst.php: YY, SEQ(=태풍번호), NOW(진행여부), EFF(한반도영향), TM_ST, TM_ED, TYP_NAME(한글), TYP_EN(영문), REM)에서 번호로 찾기
  const names = {}; try { const yy = new Date().getUTCFullYear(); const lst = parse(await getKr(`https://apihub.kma.go.kr/api/typ01/url/typ_lst.php?YY=${yy}&disp=1&help=1&authKey=${encodeURIComponent(key)}`));
    lst.forEach(r => { const tp = r.SEQ || r.TYP; if (tp && parseInt(tp, 10)) names[String(parseInt(tp, 10))] = { en: r.TYP_EN || '', ko: r.TYP_NAME || '', eff: /^(1|Y|y|true)$/.test(String(r.EFF || '').trim()), now: String(r.NOW || '').trim() }; }); } catch (_) {}
  const by = {}; rows.forEach(o => { const id = `${o.YY || ''}-${o.TYP || ''}`; (by[id] = by[id] || []).push(o); });
  const out = [];
  Object.entries(by).forEach(([id, rs]) => {
    // FT=0 은 분석(지나온 길, 시각순), FT=1 은 예보. 가장 최근 분석 시각 기준으로 현재 위치·예보를 골라요
    const ana = rs.filter(r => r.FT === '0' && num(r.LAT) != null).sort((a, b) => num(a.TYP_TM) - num(b.TYP_TM)); const an = ana[ana.length - 1] || rs[0];
    const lat = num(an.LAT), lon = num(an.LON); if (lat == null || lon == null) return;
    const fcs = rs.filter(r => r.FT === '1' && num(r.LAT) != null && (!an.TYP_TM || r.TYP_TM === an.TYP_TM)).sort((a, b) => num(a.TMD) - num(b.TMD));
    const nm = names[String(parseInt(an.TYP, 10))] || {}; const ws = num(an.WS);
    out.push({ id: 'kma:' + id, src: 'kma', name: String(nm.en || '').toUpperCase().trim(), nameKo: nm.ko || '', num: num(an.TYP), cat: ws != null && ws >= 17 ? 'TY' : 'TD', catKo: ws != null && ws >= 17 ? '태풍' : '열대저압부', intensity: '',
      pressure: num(an.PS), wind: ws, gust: null, lat, lon, at: ftTm(an.TYP_TM || an.FT_TM), issue: ftTm(an.TYP_TM),
      effKr: !!nm.eff, // [ADD] 한국 기상청이 '한반도 영향' 으로 표시한 태풍
      move: { dir: an.DIR || '', kmh: num(an.SP) }, radii: { storm: num(an.RAD25), gale: num(an.RAD15) }, track: ana.map(r => [num(r.LAT), num(r.LON)]),
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
    while ((m = re.exec(txt))) { const d0 = new Date(base); let t = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), +m[2], +m[3], +m[4])); if (t.getTime() < base - 36e5 * 6) t = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, +m[2], +m[3], +m[4])); // [FIX] 월말→월초 넘어가는 예보: +31일이 아니라 다음 달 같은 날
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
// ── JTWC(미국 합동태풍경보센터): 서태평양·북인도양·남반구 예보 경로 (RSS → 경보문 텍스트). 풍속은 1분 평균(기상청 10분 평균보다 10~15% 높아요) ──
async function jtwc() {
  const rss = await getText('https://www.metoc.navy.mil/jtwc/rss/jtwc.rss', 10000); if (!rss) return [];
  const urls = [...new Set((rss.match(/https?:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/[a-z]{2}\d{4}web\.txt/g) || []))].slice(0, 8);
  const txts = await Promise.all(urls.map(u => getText(u, 8000)));
  const out = [];
  txts.forEach((txt, i) => {
    if (!txt) return;
    const head = txt.match(/(SUPER TYPHOON|TYPHOON|TROPICAL STORM|TROPICAL DEPRESSION|TROPICAL CYCLONE|HURRICANE)\s+(\d{2}[A-Z])\s+\(([A-Z0-9\-]+)\)/);
    const pos = txt.match(/WARNING POSITION:\s*(\d{2})(\d{2})(\d{2})Z\s*---\s*NEAR\s*([\d.]+)([NS])\s*([\d.]+)([EW])/);
    if (!head || !pos) return;
    // 날짜(DD)만 있어서 달은 지금 기준: 15일 넘게 과거면 다음 달, 15일 넘게 미래면 지난달(월말·월초 넘어가는 예보)
    const now = Date.now(), Y = new Date(now).getUTCFullYear(), MO = new Date(now).getUTCMonth(), mk = (dd, hh, mm) => { let t = Date.UTC(Y, MO, +dd, +hh, +mm); if (t < now - 15 * 86400e3) t = Date.UTC(Y, MO + 1, +dd, +hh, +mm); else if (t > now + 15 * 86400e3) t = Date.UTC(Y, MO - 1, +dd, +hh, +mm); return new Date(t); };
    const at = mk(pos[1], pos[2], pos[3]);
    const wind = txt.match(/PRESENT WIND DISTRIBUTION:[\s\S]*?MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT(?:,\s*GUSTS\s*(\d+)\s*KT)?/) || txt.match(/MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT(?:,\s*GUSTS\s*(\d+)\s*KT)?/);
    const mv = txt.match(/MOVEMENT PAST SIX HOURS\s*-\s*(\d{3})\s*DEGREES AT\s*(\d+)\s*KTS?/);
    const forecast = []; const re = /(\d{2,3})\s*HRS?,\s*VALID AT:\s*(\d{2})(\d{2})(\d{2})Z\s*---\s*([\d.]+)([NS])\s*([\d.]+)([EW])\s*(?:MAX SUSTAINED WINDS\s*-\s*(\d+)\s*KT)?/g; let m;
    while ((m = re.exec(txt))) { const t = mk(m[2], m[3], m[4]); forecast.push({ h: +m[1], t: t.toISOString(), lat: +m[5] * (m[6] === 'S' ? -1 : 1), lon: +m[7] * (m[8] === 'W' ? -1 : 1), r: null, pressure: null, wind: m[9] ? +(+m[9] * KT).toFixed(1) : null, cat: '', storm: null }); }
    const kind = head[1], cat = /TYPHOON|HURRICANE/.test(kind) ? 'TY' : /STORM|CYCLONE/.test(kind) ? 'TS' : 'TD';
    out.push({ id: 'jtwc:' + head[2], src: 'jtwc', name: head[3].toUpperCase(), num: null, cat, catKo: CAT_KO[cat] || '열대저기압', intensity: '', pressure: null,
      wind: wind ? +(+wind[1] * KT).toFixed(1) : null, gust: wind && wind[2] ? +(+wind[2] * KT).toFixed(1) : null, lat: +pos[4] * (pos[5] === 'S' ? -1 : 1), lon: +pos[6] * (pos[7] === 'W' ? -1 : 1),
      at: at.toISOString(), issue: at.toISOString(), move: { dir: mv ? +mv[1] : '', kmh: mv ? +(+mv[2] * 1.852).toFixed(0) : null }, radii: { storm: null, gale: null }, track: [], forecast,
      basin: head[2].slice(-1), url: 'https://www.metoc.navy.mil/jtwc/jtwc.html' });
  });
  return out;
}
// ── CWA(대만 중앙기상서) 氣象資料開放平臺 W-C0034-005 (颱風消息與警報 - 熱帶氣旋路徑). 조석과 같은 키 CWA_API_KEY ──
async function cwa() {
  const key = process.env.CWA_API_KEY; if (!key) return [];
  const j = await getJSON(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0034-005?Authorization=${encodeURIComponent(key)}&format=JSON`, 10000);
  const list = j && j.records && j.records.tropicalCyclones && j.records.tropicalCyclones.tropicalCyclone; if (!Array.isArray(list)) return [];
  const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
  const ll = (c) => { const m = String(c || '').split(','); const lon = num(m[0]), lat = num(m[1]); return lat != null && lon != null ? [lat, lon] : null; };
  const rad = (o) => o && (num(o.radius) != null ? num(o.radius) : null);
  const tm = (s) => { const d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d) ? null : d.toISOString(); }; // "2026-10-28T18:00:00+00:00" 또는 "2026-10-28 18:00:00"
  const out = [];
  for (const tc of list) {
    const fixes = (tc.analysisData && tc.analysisData.fix) || [], fcs = (tc.forecastData && tc.forecastData.fix) || [];
    const an = fixes[fixes.length - 1]; if (!an) continue; const pos = ll(an.coordinate); if (!pos) continue;
    const name = String(tc.typhoonName || '').toUpperCase().trim(), nameZh = String(tc.cwaTyphoonName || '').trim();
    const w = num(an.maxWindSpeed), g = num(an.maxGustSpeed);
    out.push({ id: 'cwa:' + (tc.cwaTyNo || tc.cwaTdNo || name), src: 'cwa', name, nameZh, num: tc.cwaTyNo ? parseInt(String(tc.cwaTyNo).slice(-2), 10) || null : null,
      cat: w != null && w >= 17.2 ? 'TY' : 'TD', catKo: w != null && w >= 17.2 ? '태풍' : '열대저압부', intensity: '', pressure: num(an.pressure), wind: w, gust: g,
      lat: pos[0], lon: pos[1], at: tm(an.fixTime), issue: tm(an.fixTime), move: { dir: num(an.movingDirection) != null ? num(an.movingDirection) : (an.movingDirection || ''), kmh: num(an.movingSpeed) },
      radii: { storm: rad(an.circleOf25Ms), gale: rad(an.circleOf15Ms) }, track: fixes.map(f => ll(f.coordinate)).filter(Boolean),
      forecast: fcs.map(f => { const p = ll(f.coordinate); const t = tm(f.initTime); const h = num(f.tau); return p ? { h, t: t && h != null ? new Date(Date.parse(t) + h * 3600e3).toISOString() : null, lat: p[0], lon: p[1], r: num(f.radiusOf70PercentProbability), pressure: num(f.pressure), wind: num(f.maxWindSpeed), cat: '', storm: rad(f.circleOf25Ms) } : null; }).filter(Boolean),
      url: 'https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_NEWS.html' });
  }
  return out;
}
const near = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180)) < 3; // 3° 안이면 같은 태풍
// [ADD] 태풍 고정 주소용 이름: 2026-in-fa (연도-이름). 이름이 없으면 기관 번호
const slugOf = (s) => { const y = new Date(Date.parse(s.at) || Date.now()).getUTCFullYear(); const n = String(s.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); return `${y}-${n || String(s.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`; };
// [ADD] 태풍 기록 보관(사라진 뒤에도 /ko/t/2026-in-fa 페이지가 남아요): st:arc:<slug> 400일, 목록 st:idx(해시). 새 태풍이면 IndexNow 로 검색엔진에 알려요
async function archive(storms) {
  if (!storms.length) return;
  const now = Date.now(); const [{ result: idxRaw }] = await redisPipeline([['HGETALL', 'st:idx']]).catch(() => [{ result: null }]);
  const idx = {}; if (Array.isArray(idxRaw)) for (let i = 0; i < idxRaw.length; i += 2) { try { idx[idxRaw[i]] = JSON.parse(idxRaw[i + 1]); } catch (_) {} }
  const cmds = [], fresh = [];
  for (const s of storms) {
    const prev = idx[s.slug]; const peak = Math.max(prev && prev.maxWind || 0, s.wind || 0);
    const sum = { slug: s.slug, name: s.name, nameKo: s.nameKo || '', num: s.num, cat: s.cat, catKo: s.catKo, first: prev && prev.first || now, last: now, maxWind: peak, minP: Math.min(prev && prev.minP || 9999, s.pressure || 9999), lat: s.lat, lon: s.lon, agencies: s.agencies };
    cmds.push(['HSET', 'st:idx', s.slug, JSON.stringify(sum)], ['SET', 'st:arc:' + s.slug, JSON.stringify({ ...s, savedAt: now }), 'EX', String(400 * 86400)]);
    if (!prev) fresh.push(s.slug);
  }
  await redisPipeline(cmds).catch(() => {});
  if (fresh.length && process.env.INDEXNOW_KEY) { // 검색엔진(네이버·빙 등 IndexNow)에 새 페이지 바로 알리기
    const host = process.env.SITE_HOST || 'otemp.app', key = process.env.INDEXNOW_KEY;
    const urlList = fresh.flatMap(sl => ['ko', 'en', 'ja', 'es', 'zh'].map(l => `https://${host}/${l}/t/${sl}`));
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 6000);
    try { await fetch('https://api.indexnow.org/indexnow', { method: 'POST', signal: c.signal, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList }) }); } catch (_) {} finally { clearTimeout(t); }
  }
}

// [CHANGE] 기관별 예보 경로를 따로 담아요: tracks = { jma: [...], kma: [...], nhc: [...] }. 겹치면 확실, 갈라지면 불확실
async function build() {
  const [j, k, n, jt, tw, gd] = await Promise.all([jma().catch(() => []), kma().catch(() => []), nhc().catch(() => []), jtwc().catch(() => []), cwa().catch(() => []), gdacs().catch(() => [])]);
  const storms = [];
  const add = (s) => { const x = storms.find(x => near(x, s)); if (!x) { s.tracks = {}; if (s.forecast && s.forecast.length) s.tracks[s.src] = s.forecast; s.agencies = [s.src]; storms.push(s); return; }
    if (s.forecast && s.forecast.length) x.tracks[s.src] = s.forecast; x.agencies.push(s.src);
    if (s.nameKo && !x.nameKo) x.nameKo = s.nameKo; if (s.nameZh && !x.nameZh) x.nameZh = s.nameZh; if (!x.num && s.num) x.num = s.num; if (!x.name && s.name) x.name = s.name; if (s.effKr) x.effKr = true;
    if (x.pressure == null && s.pressure != null) x.pressure = s.pressure; if (x.wind == null && s.wind != null) x.wind = s.wind;
    if (!x.radii.storm && s.radii.storm) x.radii.storm = s.radii.storm; if (!x.radii.gale && s.radii.gale) x.radii.gale = s.radii.gale;
    if (!x.track.length && s.track && s.track.length) x.track = s.track; if (s.alert && !x.alert) x.alert = s.alert; };
  [...j, ...k, ...n, ...jt, ...tw, ...gd].forEach(add);
  storms.forEach(s => { s.forecast = s.tracks.jma || s.tracks.kma || s.tracks.nhc || s.forecast || [];
    // [ADD] 어느 기관도 예보 경로를 내지 않으면 '예보 종료'(약해졌거나 온대저기압으로 바뀜). JMA 등급 LOW 도 같아요
    //  [FIX] GDACS 에만 있는 태풍(인도양·남반구 등 예보 기관을 아직 안 붙인 해역)은 '종료'가 아니라 '예보 경로 자료 없음'(noTrack)
    const has = Object.values(s.tracks).some(v => v && v.length), gOnly = s.agencies.every(a => a === 'gdacs');
    s.ended = s.cat === 'LOW' || (!has && !gOnly); s.noTrack = !has && gOnly; });
  // [ADD] GDACS 목록에만 남아 있고 마지막 갱신이 36시간 넘은 건 빼요(소멸된 태풍이 한동안 '현재'로 남아 있던 문제)
  const now = Date.now(), kept = storms.filter(s => !(s.noTrack && now - (Date.parse(s.at) || now) > 36 * 3600e3));
  kept.forEach(s => { s.slug = slugOf(s); });
  try { await archive(kept); } catch (_) {}
  return { ok: true, at: now, storms: kept };
}
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const force = (req.query || {}).force === '1';
  // [ADD] ?debug=kma : 기상청 API허브 원문 앞부분만 보여줘요(열 이름·형식 확인용. 키는 안 나와요)
  // [ADD] ?debug=kmaparse : 기상청 응답을 코드가 어떻게 읽었는지(파싱 결과) 보여줘요
  // [ADD] ?debug=cwa : 대만 기상서 응답 원문 앞부분(필드 이름 확인용, 키는 안 나와요)
  if ((req.query || {}).debug === 'cwa') { const key = process.env.CWA_API_KEY; res.setHeader('Cache-Control', 'no-store'); if (!key) return res.status(200).json({ hasKey: false });
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 10000);
    try { const r = await fetch(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0034-005?Authorization=${encodeURIComponent(key)}&format=JSON`, { signal: c.signal }); const txt = await r.text(); return res.status(200).json({ hasKey: true, status: r.status, head: txt.slice(0, 4000) }); }
    catch (e) { return res.status(200).json({ hasKey: true, error: String(e && e.message || e) }); } finally { clearTimeout(t); } }
  if ((req.query || {}).debug === 'cwaparse') { res.setHeader('Cache-Control', 'no-store'); try { const k = await cwa(); return res.status(200).json({ n: k.length, storms: k.map(s => ({ name: s.name, nameZh: s.nameZh, lat: s.lat, lon: s.lon, at: s.at, wind: s.wind, track: s.track.length, forecast: s.forecast.length })) }); } catch (e) { return res.status(200).json({ error: String(e && e.message || e) }); } }
  if ((req.query || {}).debug === 'kmaparse') { res.setHeader('Cache-Control', 'no-store'); try { const k = await kma(); return res.status(200).json({ n: k.length, storms: k.map(s => ({ name: s.name, nameKo: s.nameKo, num: s.num, lat: s.lat, lon: s.lon, at: s.at, wind: s.wind, track: s.track.length, forecast: s.forecast.length })) }); } catch (e) { return res.status(200).json({ error: String(e && e.message || e) }); } }
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
module.exports.slugOf = slugOf;
