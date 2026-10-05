// [ADD] 포인트(정점)별 검색용 페이지 - 서버에서 HTML을 만들어 줘요(검색엔진이 바로 읽을 수 있게).
//   /ko/s/39/문섬 · /en/s/39/... · /ja/s/39/...   → /api/spotobs?svc=page&lang=ko&no=39  (vercel.json rewrites)
//   /ko/s/                                         → 나라별 전체 포인트 목록(svc=index)
//   /sitemap.xml                                   → svc=sitemap
// 새 Vercel 함수를 늘리지 않으려고 spotobs.js가 이 파일을 불러서 처리해요(_로 시작하는 파일은 함수 개수에 안 들어감).
//
// 자료
//   수온(지금)   근처 관측소 실측(/api/spotobs 저장본) → 없으면 Open-Meteo(위성·모델)
//   3일 예보     Open-Meteo 해양(수온·파고·주기·해수면) + 날씨(바람)
//   시야         /api/visibility(NOAA 위성 탁도) → 앱과 같은 계산으로 오늘·내일·모레 추정 + 오차 범위
//   물때         일본: 기상청 조위표 · 미국: NOAA CO-OPS 예보 · 그 밖: Open-Meteo 해수면 모델(참고)
//   월별 평균    NOAA Coral Reef Watch 위성 수온(5km), 지난 5년 매달 중순 값 평균
//                (한 번에 1~2년치씩 받아서 Redis에 쌓아요 → 페이지가 몇 번 열리면 5년이 다 채워짐)
// 통계
//   사람 조회 pg:{날짜} {번호}, 검색 유입 sr:{날짜} {google…}, 봇 수집 b:pn:{날짜} {"s|번호"} + b:n(봇 이름)
//   CDN 캐시를 쓰지 않아서(브라우저 2분만) 조회가 빠짐없이 세어져요. 무거운 자료는 Redis에 2시간 저장.
const S = require('./_store');
const { botInfo, searchEngine } = require('./_bots');

const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const WX = 'https://api.open-meteo.com/v1/forecast';
const CRW = 'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km.csv';
const COOPS = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const LANGS = ['ko', 'en', 'ja'];
const DATA_TTL = 2 * 3600; // 예보·시야 묶음 저장(초)

// ───────── 공통 ─────────
const esc = S.esc;
const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
async function getJSON(url, ms) {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms || 8000);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'OceanTemp (otemp.app)' } }); if (!r.ok) return null; return await r.json(); }
  catch (_) { return null; } finally { clearTimeout(tm); }
}
async function getText(url, ms) {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms || 8000);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'OceanTemp (otemp.app)' } }); if (!r.ok) return null; return await r.text(); }
  catch (_) { return null; } finally { clearTimeout(tm); }
}
// 다른 API 파일(visibility, jmatide, noaa)을 함수 호출로 재사용 - 가짜 res로 결과 JSON만 받아요
function callApi(mod, query, ms) {
  return Promise.race([
    new Promise((resolve) => {
      const res = {
        statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; },
        json(o) { resolve(this.statusCode < 400 ? o : null); },
        send(b) { try { resolve(this.statusCode < 400 ? (typeof b === 'string' ? JSON.parse(b) : b) : null); } catch (_) { resolve(null); } },
        end() { resolve(null); }
      };
      try { Promise.resolve(require(mod)({ method: 'GET', query, headers: {} }, res)).catch(() => resolve(null)); } catch (_) { resolve(null); }
    }),
    new Promise(r => setTimeout(() => r(null), ms || 8000))
  ]);
}

// 이름 정리(앱 js/stations.js와 같은 규칙)
function cleanSpotName(n) {
  const out = String(n || '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/\s*\((다이빙|다이빙\s*포인트|diving|dive)\)/gi, '')
    .replace(/\s*(다이빙\s*포인트|다이빙\s*스팟|diving\s*(area|site|spot|point)|dive\s*(site|spot|point))(?=\s*(\(|$))/gi, '')
    .replace(/\s{2,}/g, ' ').trim();
  return out || String(n || '').trim();
}
const slugOf = (name) => String(name || '').toLowerCase().replace(/[()'".,·]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'spot';
const nameIn = (st, lang) => (st.names && st.names[lang]) || st.name;
const pathOf = (lang, st) => `/${lang}/s/${st.no}/${encodeURIComponent(st.slug)}`;

// 나라 이름(시트는 영어 이름) → 코드 → 각 언어 이름
const REGION = (() => {
  const m = {};
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const c = String.fromCharCode(a, b);
      try { const n = dn.of(c); if (n && n !== c) m[n.toLowerCase()] = c; } catch (_) {}
    }
  } catch (_) {}
  Object.assign(m, { 'south korea': 'KR', korea: 'KR', 'united states': 'US', usa: 'US', turkey: 'TR', 'türkiye': 'TR', uk: 'GB', 'united kingdom': 'GB',
    russia: 'RU', vietnam: 'VN', taiwan: 'TW', micronesia: 'FM', 'northern mariana islands': 'MP', 'czech republic': 'CZ', 'hong kong': 'HK' });
  return m;
})();
const regionCode = (name) => REGION[String(name || '').trim().toLowerCase()] || '';
const regionName = (code, lang, fallback) => { try { return (code && new Intl.DisplayNames([lang], { type: 'region' }).of(code)) || fallback || ''; } catch (_) { return fallback || ''; } };

// ───────── 정점 목록(구글 시트 + 사용자 등록), 30분 저장 ─────────
let memo = null;
async function loadStations(base) {
  if (memo && Date.now() - memo.at < 10 * 60e3) return memo.list;
  let list = null;
  try { const [v] = await S.R(['GET', 'sp:list']); if (v) { const o = JSON.parse(v); if (Date.now() - o.at < 5 * 60e3) list = o.list; } } catch (_) {}
  if (!list) {
    // [CHANGE] 관리 페이지(Redis) 전체 포인트 목록 - 옮기기 전엔 _store가 구글 시트를 대신 읽어요
    list = (await S.allSpots(base)).map(s => ({ no: s.no, name: cleanSpotName(s.name), label: cleanSpotName(s.label || s.name), country: s.country || '', lat: s.lat, lon: s.lon }));
    list.forEach(s => { s.cc = regionCode(s.country); s.slug = slugOf(s.name); });
    // [ADD] 나라 칸이 빈 포인트(사용자 등록 등)는 300km 안 가장 가까운 포인트의 나라로 채움
    list.forEach(s => {
      if (s.cc) return;
      const n = list.filter(o => o.cc && o !== s).map(o => ({ o, d: km(s.lat, s.lon, o.lat, o.lon) })).sort((a, b) => a.d - b.d)[0];
      if (n && n.d <= 300) { s.cc = n.o.cc; s.country = n.o.country; }
    });
    list.sort((a, b) => a.no - b.no);
    if (list.length) { try { await S.R(['SET', 'sp:list', JSON.stringify({ at: Date.now(), list }), 'EX', String(86400)]); } catch (_) {} }
  }
  memo = { at: Date.now(), list };
  return list;
}

// ───────── 시야(앱 js/live-data.js computeVisibility와 같은 계산) ─────────
const VIS_MAX = 30, VIS_MIN = 0.5, DAY_MS = 864e5;
function visProjection(json) {
  const days = (json.days || []).filter(r => r.kd != null).map(r => ({ t: Date.parse(r.d + 'T12:00:00Z'), vis: Math.max(VIS_MIN, Math.min(VIS_MAX, 1.7 / r.kd)) }));
  if (days.length < 5) return null;
  days.forEach(x => { const w = days.filter(y => Math.abs(y.t - x.t) <= 3.5 * DAY_MS); x.vis7 = Math.exp(w.reduce((a, y) => a + Math.log(y.vis), 0) / w.length); });
  const sorted = days.map(x => x.vis).sort((a, b) => a - b);
  const median = sorted[Math.round(0.5 * (sorted.length - 1))];
  const logs = days.map(x => Math.log(x.vis));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const sd = Math.max(0.12, Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length));
  const last = days[days.length - 1];
  const startLog = Math.log(last.vis7), medLog = Math.log(median);
  const out = {};
  for (let tt = last.t, end = Date.now() + 5 * DAY_MS; tt <= end; tt += DAY_MS) {
    const k = (tt - last.t) / DAY_MS;
    const L = medLog + (startLog - medLog) * Math.exp(-k / 12);
    // 오차: 위성 마지막 날에서 멀어질수록 커짐(앱과 같음). 최소 ±15%는 항상 둠
    const e = Math.max(0.15, sd * Math.min(1.3, Math.sqrt(Math.max(k, 0.5) / 10)));
    out[new Date(tt).toISOString().slice(0, 10)] = { v: +Math.exp(L).toFixed(1), lo: +Math.max(VIS_MIN, Math.exp(L - e)).toFixed(1), hi: +Math.min(VIS_MAX, Math.exp(L + e)).toFixed(1) };
  }
  return { byDate: out, lastSat: new Date(last.t).toISOString().slice(0, 10) };
}

// ───────── 물때 ─────────
function extremesFromHourly(times, vals, date) {
  const out = [];
  for (let i = 1; i < vals.length - 1; i++) {
    const a = vals[i - 1], b = vals[i], c = vals[i + 1];
    if (a == null || b == null || c == null) continue;
    const type = b > a && b >= c ? 'high' : b < a && b <= c ? 'low' : null;
    if (!type) continue;
    const den = a - 2 * b + c; const dt = den ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * den))) : 0;
    const t0 = Date.parse(times[i] + ':00Z') + dt * 3600e3;
    const iso = new Date(t0).toISOString();
    if (iso.slice(0, 10) !== date) continue;
    out.push({ t: iso.slice(11, 16), h: +(b - (a - c) * dt / 4).toFixed(2), type });
  }
  return out;
}
async function tideFor(st, today) {
  if (st.cc === 'JP') {
    const j = await callApi('./jmatide', { lat: String(st.lat), lon: String(st.lon) }, 8000);
    if (j && j.ok) {
      const ex = j.hilo.filter(e => new Date(e.x).toISOString().slice(0, 10) === today)
        .map(e => ({ t: new Date(e.x).toISOString().slice(11, 16), h: e.y, type: e.type }));
      if (ex.length) return { ex, src: 'jma', station: j.station.name, dist: j.station.dist };
    }
  }
  if (st.cc === 'TW') { // [ADD] 대만 중앙기상서 조석 예보
    const j = await callApi('./spotobs', { svc: 'cwa', lat: String(st.lat), lon: String(st.lon) }, 9000);
    const f = j && j.ok && j.forecast;
    if (f) {
      const ex = f.ev.filter(e => String(e.t).slice(0, 10) === today).map(e => ({ t: String(e.t).slice(11, 16), h: e.h, type: e.type }));
      if (ex.length) return { ex, src: 'cwa', station: f.name, dist: f.dist };
    }
  }
  if (st.cc === 'US' || st.cc === 'MP' || st.cc === 'GU' || st.cc === 'PR') {
    const list = await callApi('./noaa', { svc: 'stations' }, 8000);
    const near = list && list.ok && (list.coops || []).filter(s => s.wl).map(s => ({ ...s, d: km(st.lat, st.lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d <= 25) {
      const j = await getJSON(`${COOPS}?product=predictions&application=otemp.app&datum=MSL&interval=hilo&units=metric&time_zone=lst_ldt&format=json&station=${near.id}&begin_date=${today.replace(/-/g, '')}&range=24`, 8000);
      const ex = (j && j.predictions || []).filter(p => p.t.slice(0, 10) === today).map(p => ({ t: p.t.slice(11, 16), h: +(+p.v).toFixed(2), type: p.type === 'H' ? 'high' : 'low' }));
      if (ex.length) return { ex, src: 'coops', station: near.name, dist: +near.d.toFixed(1) };
    }
  }
  return null; // 그 밖은 Open-Meteo 해수면(아래 build에서)
}

// ───────── 월별 평균 수온(위성, 5년) ─────────
async function fetchClimYear(lat, lon, y) {
  const r = (v) => v.toFixed(3);
  const q = `CRW_SST[(${y}-01-15T12:00:00Z):30:(${y}-12-31T12:00:00Z)][(${r(lat + 0.051)}):1:(${r(lat - 0.051)})][(${r(lon - 0.051)}):1:(${r(lon + 0.051)})]`;
  const text = await getText(`${CRW}?${encodeURIComponent(q).replace(/%3A/g, ':').replace(/%2C/g, ',')}`, 9000);
  if (!text) return null; // 실패(다음에 다시)
  const sum = Array(12).fill(0), n = Array(12).fill(0);
  text.split('\n').slice(2).forEach(line => {
    const c = line.split(','); if (c.length < 4) return;
    const v = parseFloat(c[3]); const m = parseInt(c[0].slice(5, 7), 10) - 1;
    if (Number.isFinite(v) && m >= 0 && m < 12) { sum[m] += v; n[m]++; }
  });
  return sum.map((s, i) => n[i] ? +(s / n[i]).toFixed(2) : null);
}
// ───────── [ADD] 월별 평균 시야(NOAA 위성 탁도 Kd490, 빈칸 채운 2km 일별 자료, 지난 5년 10일 간격) ─────────
//  시야 ≈ 1.7 ÷ Kd490 (앱과 같은 식). 날짜별 반경 약 3km 픽셀 중앙값 → 달별 중앙값. 수온처럼 한 번에 1~2년씩 쌓아요.
const KD_DS = 'https://coastwatch.noaa.gov/erddap/griddap/noaacwNPPN20S3AkdSCIDINEOF2kmDaily.csv';
const median = (a) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : null; };
async function fetchVisYear(lat, lon, y) {
  const r = 0.03, q = `kd_490[(${y}-01-05T12:00:00Z):10:(${y}-12-31T12:00:00Z)][0][(${(lat + r).toFixed(3)}):(${(lat - r).toFixed(3)})][(${(lon - r).toFixed(3)}):(${(lon + r).toFixed(3)})]`;
  const text = await getText(`${KD_DS}?${encodeURIComponent(q).replace(/%3A/g, ':').replace(/%2C/g, ',')}`, 9000);
  if (!text) return null;
  const byDate = {};
  text.split('\n').slice(2).forEach(line => { const c = line.split(','); if (c.length < 5) return; const v = parseFloat(c[4]); if (Number.isFinite(v) && v > 0) (byDate[c[0].slice(0, 10)] = byDate[c[0].slice(0, 10)] || []).push(v); });
  const byMonth = Array.from({ length: 12 }, () => []);
  Object.entries(byDate).forEach(([d, a]) => { const m = +d.slice(5, 7) - 1; const k = median(a); if (k) byMonth[m].push(Math.max(0.5, Math.min(30, 1.7 / k))); });
  const out = byMonth.map(a => a.length ? +median(a).toFixed(1) : null);
  return out.some(v => v != null) ? out : 'nodata';
}
async function climVisFor(lat, lon) {
  const key = `clim:vis:${lat.toFixed(2)}_${lon.toFixed(2)}`;
  let c = { years: {}, fail: {} };
  try { const [v] = await S.R(['GET', key]); if (v) c = JSON.parse(v); } catch (_) {}
  c.years = c.years || {}; c.fail = c.fail || {};
  const Y = new Date().getUTCFullYear(), want = [1, 2, 3, 4, 5].map(k => Y - k);
  const missing = want.filter(y => !c.years[y] && !(c.fail[y] && Date.now() - c.fail[y] < 3 * 3600e3)).slice(0, 2);
  if (missing.length) {
    const got = await Promise.all(missing.map(y => fetchVisYear(lat, lon, y).catch(() => null)));
    missing.forEach((y, i) => { if (got[i]) c.years[y] = got[i]; else c.fail[y] = Date.now(); });
    try { await S.R(['SET', key, JSON.stringify(c), 'EX', String(400 * 86400)]); } catch (_) {}
  }
  const ys = want.filter(y => Array.isArray(c.years[y]) && c.years[y].filter(v => v != null).length >= 8);
  if (ys.length < 2) return null;
  const months = Array.from({ length: 12 }, (_, m) => { const v = ys.map(y => c.years[y][m]).filter(x => x != null); return v.length ? +median(v).toFixed(1) : null; });
  if (months.filter(v => v != null).length < 9) return null;
  return { months, years: ys.length, from: Math.min(...ys), to: Math.max(...ys) };
}

async function climFor(lat, lon) {
  const key = `clim:crw:${lat.toFixed(2)}_${lon.toFixed(2)}`;
  let c = { years: {}, fail: {} };
  try { const [v] = await S.R(['GET', key]); if (v) c = JSON.parse(v); } catch (_) {}
  c.years = c.years || {}; c.fail = c.fail || {};
  const Y = new Date().getUTCFullYear();
  const want = [1, 2, 3, 4, 5].map(k => Y - k);
  const missing = want.filter(y => !c.years[y] && !(c.fail[y] && Date.now() - c.fail[y] < 3 * 3600e3)).slice(0, 2);
  if (missing.length) {
    const got = await Promise.all(missing.map(y => fetchClimYear(lat, lon, y)));
    missing.forEach((y, i) => { if (got[i]) c.years[y] = got[i]; else c.fail[y] = Date.now(); });
    try { await S.R(['SET', key, JSON.stringify(c), 'EX', String(400 * 86400)]); } catch (_) {}
  }
  const ys = want.filter(y => Array.isArray(c.years[y]) && c.years[y].filter(v => v != null).length >= 10);
  if (ys.length < 2) return null;
  const months = Array.from({ length: 12 }, (_, m) => {
    const v = ys.map(y => c.years[y][m]).filter(x => x != null);
    return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null;
  });
  months.forEach((v, i) => { if (v == null) { const a = months[(i + 11) % 12], b = months[(i + 1) % 12]; months[i] = a != null && b != null ? +((a + b) / 2).toFixed(1) : (a ?? b); } });
  if (months.some(v => v == null)) return null;
  return { months, years: ys.length, from: Math.min(...ys), to: Math.max(...ys) };
}

// ───────── 정점 하나의 자료 묶음 ─────────
async function obsNow(st) {
  try {
    const [v] = await S.R(['GET', 'spotobs:v1']);
    if (!v) return null;
    const body = JSON.parse(JSON.parse(v).body);
    const o = (body.spots || []).find(s => Math.abs(s.lat - st.lat) < 1e-3 && Math.abs(s.lon - st.lon) < 1e-3);
    if (o && Date.now() - o.at < 36 * 3600e3) return o;
  } catch (_) {}
  return null;
}

async function build(st, all) {
  const near = all.filter(s => s.no !== st.no).map(s => ({ s, d: km(st.lat, st.lon, s.lat, s.lon) })).filter(x => x.d <= 80).sort((a, b) => a.d - b.d).slice(0, 6);
  const ll = `latitude=${st.lat}&longitude=${st.lon}`;
  const [mar, wx, nearCur, visJ, obs] = await Promise.all([
    getJSON(`${MARINE}?${ll}&current=sea_surface_temperature,wave_height,wave_period&hourly=sea_surface_temperature,wave_height,wave_period,sea_level_height_msl&forecast_days=3&timezone=auto&cell_selection=sea`),
    getJSON(`${WX}?${ll}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m&hourly=wind_speed_10m,wind_gusts_10m,temperature_2m&wind_speed_unit=ms&forecast_days=3&timezone=auto`),
    near.length ? getJSON(`${MARINE}?latitude=${near.map(x => x.s.lat).join(',')}&longitude=${near.map(x => x.s.lon).join(',')}&current=sea_surface_temperature&cell_selection=sea`) : null,
    callApi('./visibility', { lat: st.lat.toFixed(3), lon: st.lon.toFixed(3), v: '3' }, 15000), // [CHANGE] 8초 → 15초(처음 계산하는 곳은 오래 걸려서 시야가 비던 문제)
    obsNow(st)
  ]);
  const d = { at: Date.now(), tz: (mar && mar.timezone) || (wx && wx.timezone) || 'UTC', off: (mar && mar.utc_offset_seconds) || (wx && wx.utc_offset_seconds) || 0 };
  const localNow = new Date(Date.now() + d.off * 1000).toISOString();
  d.today = localNow.slice(0, 10);
  // 지금
  const mc = mar && mar.current || {}, wc = wx && wx.current || {};
  d.now = { sst: mc.sea_surface_temperature ?? null, wave: mc.wave_height ?? null, period: mc.wave_period ?? null,
    wind: wc.wind_speed_10m ?? null, gust: wc.wind_gusts_10m ?? null, dir: wc.wind_direction_10m ?? null, air: wc.temperature_2m ?? null };
  if (obs) d.obs = { t: obs.t, at: obs.at, name: obs.src && obs.src.name || '', dist: obs.src && obs.src.dist, extra: obs.src && obs.src.extra || null, kind: obs.src && obs.src.kind || '' };
  // 3일 요약(현지 날짜)
  const days = {};
  const add = (times, arr, key) => (times || []).forEach((t, i) => { const v = arr && arr[i]; if (v == null) return; const k = t.slice(0, 10); (days[k] = days[k] || {}); (days[k][key] = days[k][key] || []).push(v); });
  if (mar && mar.hourly) { add(mar.hourly.time, mar.hourly.sea_surface_temperature, 'sst'); add(mar.hourly.time, mar.hourly.wave_height, 'wave'); }
  if (wx && wx.hourly) { add(wx.hourly.time, wx.hourly.wind_speed_10m, 'wind'); add(wx.hourly.time, wx.hourly.wind_gusts_10m, 'gust'); add(wx.hourly.time, wx.hourly.temperature_2m, 'air'); }
  const avg = (a) => a && a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;
  const max = (a) => a && a.length ? +Math.max(...a).toFixed(1) : null;
  d.days = Object.keys(days).sort().filter(k => k >= d.today).slice(0, 3).map(k => ({ date: k, sst: avg(days[k].sst), wave: max(days[k].wave), wind: max(days[k].wind), gust: max(days[k].gust),
    airMin: days[k].air && days[k].air.length ? +Math.min(...days[k].air).toFixed(0) : null, airMax: max(days[k].air) }));
  // [ADD] 바다 모델에 값이 하나도 없으면 강·호수 같은 내륙 물(파도·물때·위성 시야 없음)
  d.water = d.now.sst == null && d.now.wave == null && !d.days.some(x => x.sst != null || x.wave != null) ? 'inland' : 'sea';
  // 시야
  if (visJ && visJ.ok && !(visJ.nearestSeaKm != null && visJ.nearestSeaKm > 3)) {
    const p = visProjection(visJ);
    if (p) { d.vis = {}; d.days.forEach(x => { if (p.byDate[x.date]) d.vis[x.date] = p.byDate[x.date]; }); d.visSat = p.lastSat; }
  }
  if (d.water === 'sea' && !d.vis) d.visMissing = true;
  // 물때
  const tide = await tideFor(st, d.today);
  if (tide) d.tide = tide;
  else if (mar && mar.hourly && mar.hourly.sea_level_height_msl) {
    const ex = extremesFromHourly(mar.hourly.time, mar.hourly.sea_level_height_msl, d.today);
    if (ex.length) d.tide = { ex, src: 'model' };
  }
  // 근처 포인트 지금 수온
  const nc = Array.isArray(nearCur) ? nearCur : nearCur ? [nearCur] : [];
  d.near = near.map((x, i) => ({ no: x.s.no, d: +x.d.toFixed(1), t: nc[i] && nc[i].current ? nc[i].current.sea_surface_temperature ?? null : null }));
  return d;
}

async function dataFor(st, all) {
  const key = `sp:d:${st.no}`;
  try { const [v] = await S.R(['GET', key]); if (v) { const o = JSON.parse(v); if (Date.now() - o.at < (o.visMissing ? 600 : DATA_TTL) * 1000) return o; } } catch (_) {} // [FIX] 시야를 못 받은 저장본은 10분만 쓰고 다시 받기
  const d = await build(st, all);
  if (d.now.sst != null || d.obs) { try { await S.R(['SET', key, JSON.stringify(d), 'EX', String(DATA_TTL)]); } catch (_) {} }
  return d;
}

// ───────── 글자(3개 언어) ─────────
const T = {
  ko: {
    title: (n, t) => `${n} 수온·시야·파도${t != null ? ` – 오늘 ${t}°C` : ''} | otemp`,
    h1: (n) => `${n} 수온·시야·파도`,
    titleIn: (n, t) => `${n} 수온·날씨${t != null ? ` – 오늘 ${t}°C` : ''} | otemp`, h1In: (n) => `${n} 수온·날씨`,
    descIn: (n, c, t) => `${c ? c + ' ' : ''}${n}의 오늘 물 수온${t != null ? ` ${t}°C` : ''}, 기온과 바람, 3일 예보까지 한눈에.`,
    aboutIn: (n, c) => `${n}${c ? `(${c})` : ''}의 물 상태를 매일 정리한 페이지예요. 수온은 가장 가까운 공공 수질 측정소의 실측값이고, 기온·바람은 예보 모델 값이에요. 강·호수는 바다용 파도·물때·위성 시야 자료가 없어서 보여주지 않아요. 입수 전에는 현지 안내를 따르세요.`,
    trib: '근처 지천 측정소', seoulSrc: '자료: 서울특별시 한강 수질 자동측정망(서울 열린데이터광장, 공공누리 1유형)', air: '기온', colsIn: ['기온(최저~최고)', '바람(최대)', '돌풍(최대)'],
    desc: (n, c, t, v, w) => `${c ? c + ' ' : ''}${n}의 오늘 바다 수온${t != null ? ` ${t}°C` : ''}${v ? `, 시야 약 ${v}m` : ''}${w != null ? `, 파고 ${w}m` : ''}. 3일 예보, 물때(만조·간조), 월별 평균 수온과 근처 샵까지 한눈에.`,
    sub: (lat, lon) => `위도 ${lat}°, 경도 ${lon}°`, upd: (s) => `${s} 업데이트`,
    nowT: '지금 수온', vis: '시야(위성 추정)', wave: '파고', wind: '바람',
    obs: (n, d) => `실측 · ${n}${d != null ? ` ${d}km` : ''}`, model: '위성·예보 모델', range: (a, b) => `범위 ${a}–${b}m`,
    period: (p) => `주기 ${p}초`, gust: (g) => `돌풍 ${g}`, dir: ['북', '북동', '동', '남동', '남', '남서', '서', '북서'], dirW: (x) => `${x}풍`,
    cta: '실시간 지도·그래프로 보기 ›', share: '공유', copied: '링크를 복사했어요',
    tideH: '오늘 물때 (만조·간조)', high: '만조', low: '간조', msl: '평균해수면 기준',
    tideSrc: { cwa: (s, d) => `출처: 대만 중앙기상서 조석 예보 · ${s} (${d}km)`, jma: (s, d) => `출처: 일본 기상청 조위표 · ${s} (${d}km)`, coops: (s, d) => `출처: NOAA CO-OPS 조석 예보 · ${s} (${d}km)`, model: () => '출처: Open-Meteo 해수면 모델(참고용, 항구 조위표와 다를 수 있어요)' },
    daysH: '앞으로 3일', dayN: ['오늘', '내일', '모레'], cols: ['수온', '파고(최대)', '바람(최대)', '시야(추정)'],
    visNote: (d) => `시야는 위성 탁도(마지막 위성 자료 ${d})로 추정한 값이고, 작은 글씨는 오차 범위예요. 날이 갈수록 범위가 넓어져요.`,
    rowTemp: '수온 °C', rowVis: '시야 m', visTxt: (bm, bv, wm, wv) => `시야는 <b>${bm}(약 ${bv}m)</b>에 가장 맑고 <b>${wm}(약 ${wv}m)</b>에 가장 탁해요.`, visClimNote: (y, a, b) => `시야: NOAA 위성 탁도 ${a}–${b}년(${y}년) 달별 중앙값`,
    climHTemp: '월별 평균 수온', climH: '월별 평균 수온·시야', climNote: (y, a, b) => `NOAA 위성 수온 ${a}–${b}년(${y}년) 매달 평균`,
    climTxt: (n, hm, hv, cm, cv) => `${n} 바다는 <b>${hm}(약 ${hv}°C)</b>에 가장 따뜻하고 <b>${cm}(약 ${cv}°C)</b>에 가장 차가워요.`,
    month: (m) => `${m + 1}월`, suit: '슈트',
    shopH: (n) => `${n} 근처 샵`, shopNone: '아직 등록된 샵이 없어요.', shopAsk: '샵을 운영하시나요?', shopReg: '샵 등록하기 ›', partner: '제휴',
    shopBtn: { tel: '전화', kakao: '카톡', whatsapp: 'WhatsApp', instagram: '인스타', web: '웹' },
    nearH: '가까운 포인트', aboutH: (n) => `${n} 수온 정보`,
    about: (n, c) => `${n}${c ? `(${c})` : ''}의 바다 상태를 매일 정리한 페이지예요. 지금 수온은 근처 관측소 실측이 있으면 그 값을, 없으면 위성·예보 모델 값을 써요. 파도·바람은 예보 모델, 시야는 위성으로 잰 물의 탁도에서 추정한 값이에요. 실제 바다와 다를 수 있으니 입수 전에는 현지 샵의 안내를 따르세요.`,
    foot: '자료: 국립해양조사원 · 기상청 · 일본 기상청 · NOAA · Open-Meteo · Copernicus Marine. 참고용 정보이며 항해·안전 판단에 쓰지 마세요.',
    links: ['전 세계 포인트 지도', '모든 포인트', '샵 등록', '포인트 등록'],
    indexTitle: '전 세계 다이빙 포인트 수온 | otemp', indexH1: '다이빙 포인트별 수온·시야·파도', indexDesc: '전 세계 다이빙·스노클링 포인트의 오늘 수온, 시야, 파도, 물때와 월별 평균 수온.',
    notFound: '포인트를 찾을 수 없어요', home: '홈',
    dateFmt: { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
  },
  en: {
    title: (n, t) => `${n} Water Temperature, Visibility & Waves${t != null ? ` – ${t}°C today` : ''} | otemp`,
    h1: (n) => `${n} water temperature, visibility & waves`,
    titleIn: (n, t) => `${n} Water Temperature & Weather${t != null ? ` – ${t}°C today` : ''} | otemp`, h1In: (n) => `${n} water temperature & weather`,
    descIn: (n, c, t) => `Water temperature at ${n}${c ? `, ${c}` : ''} today${t != null ? `: ${t}°C (${f(t)}°F)` : ''}, plus air temperature, wind and a 3-day forecast.`,
    aboutIn: (n, c) => `This page summarises water conditions at ${n}${c ? `, ${c}` : ''} every day. The water temperature is measured at the nearest public water-quality station; air temperature and wind come from forecast models. Rivers and lakes have no sea models for waves, tides or satellite visibility, so those are not shown. Follow local advice before you get in.`,
    trib: 'Nearby tributary stations', seoulSrc: 'Data: Seoul Metropolitan Government Han River water-quality stations (Seoul Open Data Plaza, KOGL Type 1)', air: 'Air', colsIn: ['Air (min–max)', 'Wind (max)', 'Gusts (max)'],
    desc: (n, c, t, v, w) => `Sea water temperature at ${n}${c ? `, ${c}` : ''} today${t != null ? `: ${t}°C (${f(t)}°F)` : ''}${v ? `, visibility about ${v} m` : ''}${w != null ? `, waves ${w} m` : ''}. 3-day forecast, tide times, monthly averages and nearby shops.`,
    sub: (lat, lon) => `Lat ${lat}°, Lon ${lon}°`, upd: (s) => `updated ${s}`,
    nowT: 'Water temp now', vis: 'Visibility (satellite est.)', wave: 'Waves', wind: 'Wind',
    obs: (n, d) => `Measured · ${n}${d != null ? ` ${d} km` : ''}`, model: 'Satellite / forecast model', range: (a, b) => `range ${a}–${b} m`,
    period: (p) => `period ${p} s`, gust: (g) => `gusts ${g}`, dir: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], dirW: (x) => `from ${x}`,
    cta: 'Open live map & charts ›', share: 'Share', copied: 'Link copied',
    tideH: 'Tides today (high & low)', high: 'High', low: 'Low', msl: 'relative to mean sea level',
    tideSrc: { cwa: (s, d) => `Source: Taiwan Central Weather Administration tide forecast · ${s} (${d} km)`, jma: (s, d) => `Source: Japan Meteorological Agency tide tables · ${s} (${d} km)`, coops: (s, d) => `Source: NOAA CO-OPS tide predictions · ${s} (${d} km)`, model: () => 'Source: Open-Meteo sea level model (approximate; may differ from harbour tide tables)' },
    daysH: 'Next 3 days', dayN: ['Today', 'Tomorrow', 'Day after'], cols: ['Water', 'Waves (max)', 'Wind (max)', 'Visibility (est.)'],
    visNote: (d) => `Visibility is estimated from satellite water clarity (latest satellite day ${d}); the small numbers are the likely range, which widens further ahead.`,
    rowTemp: 'Water °C', rowVis: 'Visibility m', visTxt: (bm, bv, wm, wv) => `Visibility is usually best in <b>${bm} (about ${bv} m)</b> and lowest in <b>${wm} (about ${wv} m)</b>.`, visClimNote: (y, a, b) => `visibility: NOAA satellite turbidity ${a}–${b} (${y} years), monthly median`,
    climHTemp: 'Average water temperature by month', climH: 'Average water temperature & visibility by month', climNote: (y, a, b) => `NOAA satellite SST, ${a}–${b} (${y} years) monthly mean`,
    climTxt: (n, hm, hv, cm, cv) => `The sea at ${n} is warmest in <b>${hm} (about ${hv}°C)</b> and coolest in <b>${cm} (about ${cv}°C)</b>.`,
    month: (m) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m], suit: 'Wetsuit',
    shopH: (n) => `Shops near ${n}`, shopNone: 'No shops listed yet.', shopAsk: 'Run a shop?', shopReg: 'List your shop ›', partner: 'Partner',
    shopBtn: { tel: 'Call', kakao: 'Kakao', whatsapp: 'WhatsApp', instagram: 'Instagram', web: 'Web' },
    nearH: 'Nearby spots', aboutH: (n) => `About the water at ${n}`,
    about: (n, c) => `This page summarises sea conditions at ${n}${c ? `, ${c}` : ''} every day. The current water temperature comes from a nearby measuring station when one exists, otherwise from satellite and forecast models. Waves and wind come from forecast models, and visibility is estimated from satellite-measured water clarity. Real conditions can differ, so follow local dive shop advice before you get in.`,
    foot: 'Data: KHOA · KMA · Japan Meteorological Agency · NOAA · Open-Meteo · Copernicus Marine. For reference only; not for navigation or safety decisions.',
    links: ['World spot map', 'All spots', 'List a shop', 'Suggest a spot'],
    indexTitle: 'Water temperature at dive spots worldwide | otemp', indexH1: 'Water temperature, visibility & waves by dive spot', indexDesc: 'Today’s water temperature, visibility, waves, tides and monthly averages for dive and snorkel spots around the world.',
    notFound: 'Spot not found', home: 'Home',
    dateFmt: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
  },
  ja: {
    title: (n, t) => `${n}の水温・透明度・波${t != null ? ` – 今日 ${t}°C` : ''} | otemp`,
    h1: (n) => `${n}の水温・透明度・波`,
    titleIn: (n, t) => `${n}の水温・天気${t != null ? ` – 今日 ${t}°C` : ''} | otemp`, h1In: (n) => `${n}の水温・天気`,
    descIn: (n, c, t) => `${c ? c + '・' : ''}${n}の今日の水温${t != null ? ` ${t}°C` : ''}、気温と風、3日間予報。`,
    aboutIn: (n, c) => `${n}${c ? `（${c}）` : ''}の水の状態を毎日まとめたページです。水温は最寄りの公共水質測定所の実測値、気温と風は予報モデルの値です。川や湖には海用の波・潮汐・衛星透明度のデータがないため表示していません。入水前は現地の案内に従ってください。`,
    trib: '近くの支流の測定所', seoulSrc: 'データ：ソウル特別市 漢江水質自動測定網（ソウル オープンデータ広場、公共ヌリ1類型）', air: '気温', colsIn: ['気温(最低~最高)', '風(最大)', '最大瞬間'],
    desc: (n, c, t, v, w) => `${c ? c + '・' : ''}${n}の今日の海水温${t != null ? ` ${t}°C` : ''}${v ? `、透明度 約${v}m` : ''}${w != null ? `、波高 ${w}m` : ''}。3日間予報、潮汐（満潮・干潮）、月別平均水温、近くのショップ。`,
    sub: (lat, lon) => `緯度 ${lat}°・経度 ${lon}°`, upd: (s) => `${s} 更新`,
    nowT: '現在の水温', vis: '透明度（衛星推定）', wave: '波高', wind: '風',
    obs: (n, d) => `実測・${n}${d != null ? ` ${d}km` : ''}`, model: '衛星・予報モデル', range: (a, b) => `範囲 ${a}–${b}m`,
    period: (p) => `周期 ${p}秒`, gust: (g) => `最大瞬間 ${g}`, dir: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'], dirW: (x) => `${x}の風`,
    cta: 'リアルタイム地図・グラフを見る ›', share: '共有', copied: 'リンクをコピーしました',
    tideH: '今日の潮汐（満潮・干潮）', high: '満潮', low: '干潮', msl: '平均海面基準',
    tideSrc: { cwa: (s, d) => `出典：台湾中央気象署 潮汐予報・${s}（${d}km）`, jma: (s, d) => `出典：気象庁ホームページ（潮位表）・${s}（${d}km）`, coops: (s, d) => `出典：NOAA CO-OPS 潮汐予報・${s}（${d}km）`, model: () => '出典：Open-Meteo 海面モデル（参考値・港の潮位表と異なる場合があります）' },
    daysH: 'この先3日間', dayN: ['今日', '明日', '明後日'], cols: ['水温', '波高(最大)', '風(最大)', '透明度(推定)'],
    visNote: (d) => `透明度は衛星で測った海の濁り（最新の衛星データ ${d}）からの推定値で、小さな数字は誤差の範囲です。先の日ほど範囲が広くなります。`,
    rowTemp: '水温 °C', rowVis: '透明度 m', visTxt: (bm, bv, wm, wv) => `透明度は<b>${bm}（約${bv}m）</b>が最も良く、<b>${wm}（約${wv}m）</b>が最も低くなります。`, visClimNote: (y, a, b) => `透明度：NOAA 衛星濁度 ${a}–${b}年（${y}年分）の月中央値`,
    climHTemp: '月別平均水温', climH: '月別平均水温・透明度', climNote: (y, a, b) => `NOAA 衛星水温 ${a}–${b}年（${y}年分）の月平均`,
    climTxt: (n, hm, hv, cm, cv) => `${n}の海は<b>${hm}（約${hv}°C）</b>が最も暖かく、<b>${cm}（約${cv}°C）</b>が最も冷たくなります。`,
    month: (m) => `${m + 1}月`, suit: 'スーツ',
    shopH: (n) => `${n}周辺のショップ`, shopNone: '登録されたショップはまだありません。', shopAsk: 'ショップを運営していますか？', shopReg: 'ショップを登録 ›', partner: '提携',
    shopBtn: { tel: '電話', kakao: 'Kakao', whatsapp: 'WhatsApp', instagram: 'Instagram', web: 'Web' },
    nearH: '近くのポイント', aboutH: (n) => `${n}の水温について`,
    about: (n, c) => `${n}${c ? `（${c}）` : ''}の海況を毎日まとめたページです。現在の水温は近くに観測所があればその実測値、なければ衛星・予報モデルの値です。波と風は予報モデル、透明度は衛星で測った海の濁りからの推定値です。実際の海況とは異なる場合があるため、入水前は現地ショップの案内に従ってください。`,
    foot: 'データ：韓国国立海洋調査院・韓国気象庁・気象庁・NOAA・Open-Meteo・Copernicus Marine。参考情報です。航海・安全の判断には使わないでください。',
    links: ['世界のポイント地図', 'すべてのポイント', 'ショップ登録', 'ポイント登録'],
    indexTitle: '世界のダイビングポイントの水温 | otemp', indexH1: 'ダイビングポイント別 水温・透明度・波', indexDesc: '世界のダイビング・シュノーケリングポイントの今日の水温、透明度、波、潮汐、月別平均水温。',
    notFound: 'ポイントが見つかりません', home: 'ホーム',
    dateFmt: { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
  }
};
function f(c) { return (c * 9 / 5 + 32).toFixed(1); }
const r1 = (v) => v == null ? null : +(+v).toFixed(1);
const fmtVis = (v) => v == null ? '–' : v >= VIS_MAX - 0.05 ? VIS_MAX + '+' : (v < 10 ? (+v).toFixed(1) : Math.round(v));
const suitFor = (t) => t < 18 ? '7mm+' : t < 23 ? '5mm' : t < 27 ? '3mm' : '2mm';
const tempColor = (t) => t < 10 ? '#6366f1' : t < 16 ? '#3b82f6' : t < 20 ? '#0e9488' : t < 24 ? '#84cc16' : t < 27 ? '#facc15' : '#f97316';

// ───────── HTML ─────────
const CSS = `:root{--bg:#070B14;--bg2:#0B1120;--line:rgba(255,255,255,.09);--text:rgba(255,255,255,.92);--muted:#8A94A6;--dim:#64708A;--accent:#FFB000;--sky:#7dd3fc}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Hiragino Sans","Segoe UI",Roboto,sans-serif;line-height:1.55}
a{color:inherit}.wrap{max-width:760px;margin:0 auto;padding:16px 16px 48px}
.top{display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--muted)}
.top .logo{color:var(--text);font-size:15px;font-weight:700;letter-spacing:.02em;text-decoration:none}.top .logo span{color:var(--accent)}
.langs a{margin-left:10px;text-decoration:none}.langs a[aria-current]{color:var(--text);font-weight:700}
.crumb{font-size:12px;color:var(--dim);margin:14px 0 4px}.crumb a{text-decoration:none}
h1{font-size:24px;margin:0 0 4px;letter-spacing:-.01em;line-height:1.3}
.sub{color:var(--muted);font-size:13px;margin:0 0 12px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0 10px}
.c{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:10px 12px;min-width:0}
.c .l{font-size:11.5px;color:var(--muted)}.c .v{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}.c .v small{font-size:12px;font-weight:600;color:var(--muted)}
.c .s{font-size:11px;color:var(--dim)}.c.t .v{color:var(--sky)}
.cta{display:flex;gap:8px;margin:6px 0 18px}
.btn{flex:1;text-align:center;text-decoration:none;font-weight:700;font-size:14.5px;padding:12px;border-radius:11px;border:1px solid rgba(255,176,0,.6);background:rgba(255,176,0,.15);color:#ffd27a;cursor:pointer;font-family:inherit}
.btn.g{flex:0 0 auto;background:transparent;border-color:var(--line);color:var(--muted);font-weight:600}
h2{font-size:16px;margin:24px 0 8px}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.dfacts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}.dfacts div{background:rgba(255,255,255,.04);border-radius:8px;padding:6px 8px}.dfacts b{display:block;font-size:18px;color:var(--sky)}.dfacts span{font-size:11px;color:var(--muted)}
.dmap{position:relative;max-width:320px;margin:0 auto}.dmap canvas{width:100%;aspect-ratio:1;border-radius:8px;display:block;touch-action:none}.dro{position:absolute;left:6px;bottom:6px;background:rgba(7,11,20,.8);border-radius:6px;padding:2px 7px;font-size:11.5px;pointer-events:none}
.dleg{display:flex;align-items:center;gap:6px;max-width:320px;margin:6px auto 0;font-size:10.5px;color:var(--dim)}.dleg i{flex:1;height:6px;border-radius:3px;background:linear-gradient(90deg,#bee9e1,#5aa6bf,#14559a)}
table{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}
th{font-weight:600;color:var(--muted);font-size:12px;text-align:center;padding:6px 2px;border-bottom:1px solid var(--line)}
td{text-align:center;padding:7px 2px;border-bottom:1px solid var(--line)}tr:last-child td{border-bottom:none}
th:first-child,td:first-child{text-align:left}td small{display:block;font-size:10.5px;color:var(--dim)}
.tide{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font-size:13px}
.tide div{background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:7px 9px}
.tide b{display:block;font-size:15px}.hi b{color:#fbbf24}.lo b{color:var(--sky)}
.months{display:grid;grid-template-columns:repeat(12,1fr);gap:4px;align-items:end;height:150px;margin-top:18px}
.bar{border-radius:5px 5px 0 0;position:relative;display:flex;justify-content:center;min-height:4px}
.bar span{position:absolute;top:-17px;font-size:10.5px;color:var(--text);font-weight:700}
.ml,.suit{display:grid;grid-template-columns:repeat(12,1fr);gap:4px;text-align:center}
.ml{font-size:10.5px;color:var(--muted);margin-top:4px}.suit{font-size:9.5px;margin-top:4px;color:var(--dim)}
.shop{padding:10px 0;border-bottom:1px solid var(--line)}.shop:last-of-type{border-bottom:none}
.shop .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.shop .hd b{font-size:14.5px}
.tag{font-size:10px;color:var(--accent);border:1px solid rgba(255,176,0,.5);border-radius:4px;padding:0 5px}
.shop .lg{font-size:11.5px;color:var(--muted);margin-left:auto}.shop .nt{font-size:12px;color:var(--muted);margin:3px 0 7px}
.shop .bt{display:flex;gap:6px;flex-wrap:wrap}.shop .bt a{font-size:12px;font-weight:600;text-decoration:none;padding:6px 11px;border-radius:8px;border:1px solid var(--line);background:rgba(255,255,255,.05)}
.shop .bt a.call{background:rgba(255,176,0,.14);border-color:rgba(255,176,0,.45);color:#ffd27a}
.near{display:flex;flex-wrap:wrap;gap:6px}
.near a{text-decoration:none;font-size:13px;padding:6px 11px;border:1px solid var(--line);border-radius:999px;background:var(--bg2)}
.near a small{color:var(--muted);margin-left:4px}
p.txt{font-size:13.5px;color:var(--muted);margin:6px 0}p.note{font-size:11.5px;color:var(--dim);margin:8px 0 0}
.foot{margin-top:28px;font-size:11px;color:var(--dim);line-height:1.7}.foot a{margin-right:8px}
.idx h2{margin-top:20px}.idx .near a{font-size:12.5px}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111827;border:1px solid var(--line);padding:8px 14px;border-radius:999px;font-size:13px;display:none}
@media(max-width:560px){.cards{grid-template-columns:repeat(2,1fr)}.tide{grid-template-columns:repeat(2,1fr)}.bar span{font-size:9px}.suit{font-size:8px}h1{font-size:21px}}`;

function page({ lang, title, desc, canonical, alternates, jsonld, body, base }) {
  const alt = alternates ? LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${base}${alternates[l]}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${base}${alternates.en}">` : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${base}${canonical}">${alt}
<meta property="og:type" content="website"><meta property="og:site_name" content="otemp"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${base}${canonical}"><meta property="og:image" content="${base}/og.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${base}/og.jpg"><meta name="theme-color" content="#070B14">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
<style>${CSS}</style></head><body><div class="wrap">${body}</div><div id="toast"></div></body></html>`;
}

function header(lang, hrefs) {
  const names = { ko: '한국어', en: 'English', ja: '日本語' };
  return `<div class="top"><a class="logo" href="/">otemp<span>.app</span></a><nav class="langs">${LANGS.map(l => `<a href="${hrefs[l]}" hreflang="${l}"${l === lang ? ' aria-current="page"' : ''}>${names[l]}</a>`).join('')}</nav></div>`;
}

// ───────── [ADD] 주변 수심(api/_depth.js): 요약 숫자 + 수심 색 지도(10m 간격 선) + 동서 단면 ─────────
const DEPTH_T = {
  ko: { h: '주변 수심', max: (r) => `${r}m 안 최대`, avg: (r) => `${r}m 안 평균`, far: '1km 안 최대', at: '포인트 지점', prof: '동서 단면', land: '육지', depth: '수심',
    note: (n, r) => `자료: ${n} (약 ${r}m 격자). 해도가 아니라서 실제 수심, 특히 직벽이나 수중 바위와 다를 수 있어요. 다이빙 계획은 현지 정보와 다이브 컴퓨터를 기준으로 하세요.`, tap: '지도를 누르면 그 지점 수심' },
  en: { h: 'Depth around the spot', max: (r) => `Max within ${r}m`, avg: (r) => `Avg within ${r}m`, far: 'Max within 1km', at: 'At the spot', prof: 'West–east profile', land: 'Land', depth: 'Depth',
    note: (n, r) => `Source: ${n} (~${r}m grid). Not a nautical chart; real depths (walls, pinnacles) can differ. Plan dives with local knowledge and your dive computer.`, tap: 'Tap the map for depth' },
  ja: { h: '周辺の水深', max: (r) => `${r}m以内の最大`, avg: (r) => `${r}m以内の平均`, far: '1km以内の最大', at: 'ポイント地点', prof: '東西断面', land: '陸地', depth: '水深',
    note: (n, r) => `出典：${n}（約${r}m格子）。海図ではないため、実際の水深（壁・根など）とは異なる場合があります。ダイビング計画は現地情報とダイブコンピューターを基準にしてください。`, tap: '地図をタップで水深表示' }
};
function depthHtml(lang, dp) {
  if (!dp || !dp.ok || !dp.grid) return '';
  const T = DEPTH_T[lang] || DEPTH_T.en, g = dp.grid;
  const facts = [];
  if (dp.max300 != null) facts.push([`${dp.max300}m`, T.max(dp.radius || 300)]);
  if (dp.avg300 != null) facts.push([`${dp.avg300}m`, T.avg(dp.radius || 300)]);
  if (dp.max1k != null) facts.push([`${dp.max1k}m`, T.far]);
  // 단면: 포인트 위도를 지나는 줄(쌍선형)
  const zAt = (lat, lon) => { const fi = (lat - g.la0) / g.dla, fj = (lon - g.lo0) / g.dlo, i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= g.rows - 1 || j >= g.cols - 1) return null; const q = [g.z[i * g.cols + j], g.z[i * g.cols + j + 1], g.z[(i + 1) * g.cols + j], g.z[(i + 1) * g.cols + j + 1]];
    if (q.every(v => v == null)) return null; for (let k = 0; k < 4; k++) if (q[k] == null) q[k] = 8; const a = fi - i, b = fj - j; return q[0] * (1 - a) * (1 - b) + q[1] * (1 - a) * b + q[2] * a * (1 - b) + q[3] * a * b; };
  const W = 320, H = 110, ml = 30, mb = 16, kx = 111.32 * Math.cos(dp.lat * Math.PI / 180);
  const lo0 = g.lo0, lo1 = g.lo0 + (g.cols - 1) * g.dlo, pts = [];
  for (let k = 0; k <= 120; k++) { const lon = lo0 + (lo1 - lo0) * k / 120, v = zAt(dp.lat, lon); if (v != null) pts.push([(lon - dp.lon) * kx, v]); }
  let prof = '';
  if (pts.length > 10) {
    const deep = Math.max(30, Math.ceil(Math.max(...pts.map(p => -p[1])) / 10) * 10), x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    const X = (x) => ml + (x - x0) / (x1 - x0) * (W - ml - 4), Y = (z) => 4 + (15 - Math.min(z, 15)) / (deep + 15) * (H - mb - 8);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const step = deep > 90 ? 30 : deep > 40 ? 20 : 10, ticks = []; for (let v = 0; v <= deep; v += step) ticks.push(v);
    prof = `<p class="note" style="margin:10px auto 2px;max-width:320px">${T.prof}</p><svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:320px;display:block;margin:0 auto">
${ticks.map(v => `<line x1="${ml}" x2="${W - 4}" y1="${Y(-v).toFixed(1)}" y2="${Y(-v).toFixed(1)}" stroke="rgba(255,255,255,.08)"/><text x="${ml - 4}" y="${(Y(-v) + 3).toFixed(1)}" fill="#64708A" font-size="9" text-anchor="end">${v}m</text>`).join('')}
<path d="${line}L${X(x1).toFixed(1)},${H - mb}L${X(x0).toFixed(1)},${H - mb}Z" fill="rgba(56,189,248,.18)"/><path d="${line}" fill="none" stroke="#38BDF8" stroke-width="1.6"/>
<line x1="${X(0).toFixed(1)}" x2="${X(0).toFixed(1)}" y1="4" y2="${H - mb}" stroke="#F43F5E"/>
${[Math.ceil(x0), 0, Math.floor(x1)].map(v => `<text x="${X(v).toFixed(1)}" y="${H - 3}" fill="#64708A" font-size="9" text-anchor="middle">${v ? (v > 0 ? '+' : '') + v + 'km' : '●'}</text>`).join('')}</svg>`;
  }
  const data = JSON.stringify({ g: { la0: g.la0, lo0: g.lo0, dla: g.dla, dlo: g.dlo, rows: g.rows, cols: g.cols, z: g.z.map(v => v == null ? null : Math.round(v)) }, lat: dp.lat, lon: dp.lon, land: T.land, depth: T.depth });
  return `<h2>${T.h}</h2><div class="card">
<div class="dfacts">${facts.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
<div class="dmap"><canvas id="dmap" width="300" height="300"></canvas><div class="dro" id="dro">${T.tap}</div></div>
<div class="dleg"><span>0</span><i></i><span>60m+</span></div>
${prof}
<p class="note">${T.note(esc(dp.srcName), dp.res)}${dp.license ? ` · ${esc(dp.license)}` : ''}</p></div>
<script>(function(){var D=${data.replace(/</g, '\\u003c')},g=D.g,c=document.getElementById('dmap');if(!c)return;var x=c.getContext('2d'),W=c.width,H=c.height,img=x.createImageData(W,H);
function z(la,lo){var fi=(la-g.la0)/g.dla,fj=(lo-g.lo0)/g.dlo,i=Math.floor(fi),j=Math.floor(fj);if(i<0||j<0||i>=g.rows-1||j>=g.cols-1)return null;var q=[g.z[i*g.cols+j],g.z[i*g.cols+j+1],g.z[(i+1)*g.cols+j],g.z[(i+1)*g.cols+j+1]];for(var k=0;k<4;k++)if(q[k]==null)q[k]=8;var a=fi-i,b=fj-j;return q[0]*(1-a)*(1-b)+q[1]*(1-a)*b+q[2]*a*(1-b)+q[3]*a*b}
var la1=g.la0+(g.rows-1)*g.dla,lo1=g.lo0+(g.cols-1)*g.dlo;function P(px,py){return[la1-py/H*(la1-g.la0),g.lo0+px/W*(lo1-g.lo0)]}
function col(d){var t=Math.min(1,d/60);return[Math.round(190-170*t),Math.round(235-150*t),Math.round(225-75*t)]}
var Z=new Float32Array(W*H);for(var py=0;py<H;py++)for(var px=0;px<W;px++){var p=P(px,py),v=z(p[0],p[1]);Z[py*W+px]=v==null?NaN:v}
for(var py=0;py<H;py++)for(var px=0;px<W;px++){var v=Z[py*W+px],o=(py*W+px)*4,cc;if(isNaN(v))cc=[11,17,32];else if(v>=0)cc=[110,100,76];else{cc=col(-v);var b0=Math.floor(-v/10),r=px<W-1?Z[py*W+px+1]:v,d=py<H-1?Z[(py+1)*W+px]:v;if((!isNaN(r)&&r<0&&Math.floor(-r/10)!==b0)||(!isNaN(d)&&d<0&&Math.floor(-d/10)!==b0)){var strong=[3,4,6].indexOf(Math.max(b0,Math.floor(-(isNaN(r)?v:r)/10),Math.floor(-(isNaN(d)?v:d)/10)))>=0;cc=strong?[255,255,255]:[cc[0]+40,cc[1]+40,cc[2]+30]}}img.data[o]=cc[0];img.data[o+1]=cc[1];img.data[o+2]=cc[2];img.data[o+3]=255}
x.putImageData(img,0,0);var sx=(D.lon-g.lo0)/(lo1-g.lo0)*W,sy=(la1-D.lat)/(la1-g.la0)*H;x.beginPath();x.arc(sx,sy,5,0,7);x.fillStyle='#F43F5E';x.fill();x.lineWidth=2;x.strokeStyle='#fff';x.stroke();
x.strokeStyle='rgba(244,63,94,.6)';x.setLineDash([4,3]);x.beginPath();x.moveTo(0,sy);x.lineTo(W,sy);x.stroke();
var ro=document.getElementById('dro');function sh(e){var r=c.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*W,py=(e.clientY-r.top)/r.height*H,v=Z[Math.max(0,Math.min(H-1,Math.round(py)))*W+Math.max(0,Math.min(W-1,Math.round(px)))];ro.textContent=isNaN(v)?'–':v>=0?D.land:D.depth+' ~'+Math.round(-v)+'m'}c.addEventListener('pointermove',sh);c.addEventListener('pointerdown',sh)})();</script>`;
}

function renderSpot(lang, st0, all, d, shops, clim, base, climVis, depth) {
  const t = T[lang];
  const st = { ...st0, name: nameIn(st0, lang) };
  const cname = regionName(st.cc, lang, st.country);
  const tz = d.tz;
  const fmtDate = (ms, o) => { try { return new Intl.DateTimeFormat(lang, { ...o, timeZone: tz }).format(new Date(ms)); } catch (_) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); } };
  const nowT = d.obs ? r1(d.obs.t) : r1(d.now.sst);
  const today = d.days[0] || {};
  const visToday = d.vis && d.vis[d.today];
  const inland = d.water === 'inland';
  const title = inland ? t.titleIn(st.name, nowT) : t.title(st.name, nowT);
  const description = inland ? t.descIn(st.name, cname, nowT) : t.desc(st.name, cname, nowT, visToday ? fmtVis(visToday.v) : null, r1(d.now.wave));
  const hrefs = Object.fromEntries(LANGS.map(l => [l, pathOf(l, st)]));
  const deg = (x) => x == null ? '' : t.dir[Math.round(((x % 360) + 360) % 360 / 45) % 8];
  const F = lang === 'en' ? (v) => ` <small>(${f(v)}°F)</small>` : () => '';

  const cards = `<div class="cards">
<div class="c t"><div class="l">${t.nowT}</div><div class="v">${nowT ?? '–'}<small>°C</small></div><div class="s">${d.obs ? esc(t.obs(d.obs.name, d.obs.dist)) : t.model}${lang === 'en' && nowT != null ? ` · ${f(nowT)}°F` : ''}</div></div>
${inland ? `<div class="c"><div class="l">${t.air}</div><div class="v">${d.now.air != null ? Math.round(d.now.air) : '–'}<small>°C</small></div><div class="s">${d.days[0] && d.days[0].airMin != null ? `${d.days[0].airMin}~${Math.round(d.days[0].airMax)}°C` : ''}</div></div>` : `<div class="c"><div class="l">${t.vis}</div><div class="v">${visToday ? fmtVis(visToday.v) : '–'}<small>m</small></div><div class="s">${visToday ? t.range(fmtVis(visToday.lo), fmtVis(visToday.hi)) : ''}</div></div>
<div class="c"><div class="l">${t.wave}</div><div class="v">${r1(d.now.wave) ?? '–'}<small>m</small></div><div class="s">${d.now.period != null ? t.period(Math.round(d.now.period)) : ''}</div></div>`}
<div class="c"><div class="l">${t.wind}</div><div class="v">${d.now.wind != null ? Math.round(d.now.wind) : '–'}<small>m/s</small></div><div class="s">${d.now.dir != null ? t.dirW(deg(d.now.dir)) : ''}${d.now.gust != null ? ' · ' + t.gust(Math.round(d.now.gust)) : ''}</div></div>
</div>`;

  let tide = '';
  if (!inland && d.tide && d.tide.ex.length) {
    const sgn = (h) => (h > 0 ? '+' : h < 0 ? '−' : '') + Math.abs(h).toFixed(1) + 'm';
    tide = `<h2>${t.tideH}</h2><div class="card"><div class="tide">${d.tide.ex.slice(0, 4).map(e => `<div class="${e.type === 'high' ? 'hi' : 'lo'}">${e.type === 'high' ? t.high : t.low}<b>${e.t}</b>${sgn(e.h)}</div>`).join('')}</div>
<p class="note">${esc(t.tideSrc[d.tide.src](d.tide.station, d.tide.dist))} · ${t.msl}</p></div>`;
  }

  let days = '';
  if (d.days.length && inland) {
    const wd = (date) => { try { return new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z')); } catch (_) { return ''; } };
    days = `<h2>${t.daysH}</h2><div class="card"><table><tr><th></th>${t.colsIn.map(c => `<th>${c}</th>`).join('')}</tr>
${d.days.map((x, i) => `<tr><td>${t.dayN[i] || x.date} <small style="display:inline">(${wd(x.date)})</small></td><td>${x.airMin != null ? `${x.airMin}~${Math.round(x.airMax)}°C` : '–'}</td><td>${x.wind != null ? Math.round(x.wind) + ' m/s' : '–'}</td><td>${x.gust != null ? Math.round(x.gust) + ' m/s' : '–'}</td></tr>`).join('')}
</table></div>`;
  } else if (d.days.length) {
    const wd = (date) => { try { return new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z')); } catch (_) { return ''; } };
    days = `<h2>${t.daysH}</h2><div class="card"><table><tr><th></th>${t.cols.map(c => `<th>${c}</th>`).join('')}</tr>
${d.days.map((x, i) => { const v = d.vis && d.vis[x.date]; return `<tr><td>${t.dayN[i] || x.date} <small style="display:inline">(${wd(x.date)})</small></td><td>${x.sst != null ? x.sst + '°C' : '–'}</td><td>${x.wave != null ? x.wave + 'm' : '–'}</td><td>${x.wind != null ? Math.round(x.wind) + ' m/s' : '–'}</td><td>${v ? `${fmtVis(v.v)}m<small>${fmtVis(v.lo)}–${fmtVis(v.hi)}m</small>` : '–'}</td></tr>`; }).join('')}
</table>${d.vis ? `<p class="note">${t.visNote(d.visSat)}</p>` : ''}</div>`;
  }

  let climH = '';
  if (clim) {
    const m = clim.months; const hi = m.indexOf(Math.max(...m)), lo = m.indexOf(Math.min(...m));
    const minV = Math.min(...m), maxV = Math.max(...m), span = Math.max(6, maxV - minV + 4), floor = minV - 2;
    climH = `<h2>${climVis ? t.climH : t.climHTemp}</h2><div class="card">
<div class="months">${m.map((v, i) => `<div class="bar" style="height:${((v - floor) / span * 100).toFixed(0)}%;background:${tempColor(v)}" title="${t.month(i)} ${v}°C"><span>${Math.round(v)}°</span></div>`).join('')}</div>
<div class="ml">${m.map((_, i) => `<span>${t.month(i)}</span>`).join('')}</div>
<div class="suit">${m.map(v => `<span>${suitFor(v)}</span>`).join('')}</div>
<p class="txt">${t.climTxt(esc(st.name), t.month(hi), m[hi], t.month(lo), m[lo])}</p>
<table style="margin-top:6px"><tr><th></th>${m.map((_, i) => `<th>${t.month(i)}</th>`).join('')}</tr>
<tr><td style="font-size:11px;color:var(--muted);white-space:nowrap">${t.rowTemp}</td>${m.map(v => `<td style="font-size:11.5px">${v}</td>`).join('')}</tr>
${climVis ? `<tr><td style="font-size:11px;color:var(--sky);white-space:nowrap">${t.rowVis}</td>${climVis.months.map(v => `<td style="font-size:11.5px;color:var(--sky)">${v == null ? '–' : fmtVis(v)}</td>`).join('')}</tr>` : ''}</table>
${climVis ? (() => { const vm = climVis.months; const ok = vm.map((v, i) => [v, i]).filter(x => x[0] != null); const b = ok.reduce((a, x) => x[0] > a[0] ? x : a), w = ok.reduce((a, x) => x[0] < a[0] ? x : a); return `<p class="txt">${t.visTxt(t.month(b[1]), fmtVis(b[0]), t.month(w[1]), fmtVis(w[0]))}</p>`; })() : ''}
<p class="note">${t.climNote(clim.years, clim.from, clim.to)}${climVis ? ' · ' + t.visClimNote(climVis.years, climVis.from, climVis.to) : ''} · ${t.suit}: ${lang === 'ko' ? '참고용' : lang === 'ja' ? '目安' : 'rough guide'}</p></div>`;
  }

  const LANGN = (code) => { try { return new Intl.DisplayNames([code], { type: 'language' }).of(code); } catch (_) { return code; } };
  const shopLang = (s) => /^[a-z]{2,3}(,[a-z]{2,3})*$/.test(s.lang || '') ? s.lang.split(',').map(LANGN).join(' · ') : (s.lang || '');
  const shopBtns = (s) => {
    const b = [];
    if (s.phone) b.push(['tel', `tel:${s.phone}`, 'call']);
    if (s.kakao) b.push(['kakao', s.kakao]); if (s.whatsapp) b.push(['whatsapp', s.whatsapp]);
    if (s.instagram) b.push(['instagram', s.instagram]); if (s.web) b.push(['web', s.web]);
    return b.map(([k, u, cls]) => `<a ${cls ? `class="${cls}" ` : ''}href="${esc(u)}" data-shop="${esc(s.id)}" data-k="${k}"${k === 'tel' ? '' : ' target="_blank" rel="noopener nofollow"'}>${t.shopBtn[k]}</a>`).join('');
  };
  const shopHtml = `<h2>${t.shopH(esc(st.name))}</h2><div class="card">${shops.length ? shops.map(s => `<div class="shop"><div class="hd"><b>${esc(s.name)}</b>${s.type === 'liveaboard' ? `<span class="tag">${({ ko: '리브어보드', ja: 'ライブアボード' })[lang] || 'Liveaboard'}</span>` : ''}${s.paid ? `<span class="tag">${t.partner}</span>` : ''}<span class="lg">${esc(shopLang(s))}</span></div>${s.note ? `<div class="nt">${esc(s.note)}</div>` : ''}<div class="bt">${shopBtns(s)}</div></div>`).join('') : `<p class="txt">${t.shopNone}</p>`}
<p class="txt" style="font-size:12px;margin-top:8px">${t.shopAsk} <a href="/shop/?spot=${st.no}" style="color:var(--accent)">${t.shopReg}</a></p></div>`;

  const byNo = Object.fromEntries(all.map(s => [s.no, s]));
  const nearHtml = d.near && d.near.length ? `<h2>${t.nearH}</h2><div class="near">${d.near.filter(x => byNo[x.no]).map(x => `<a href="${pathOf(lang, byNo[x.no])}">${esc(nameIn(byNo[x.no], lang))}<small>${x.d}km${x.t != null ? ` · ${r1(x.t)}°C` : ''}</small></a>`).join('')}</div>` : '';

  const body = `${header(lang, hrefs)}
<nav class="crumb"><a href="/${lang}/s/">${t.links[1]}</a> › <a href="/${lang}/s/#${st.cc || 'xx'}">${esc(cname)}</a> › ${esc(st.name)}</nav>
<h1>${esc(inland ? t.h1In(st.name) : t.h1(st.name))}</h1>
<p class="sub">${t.sub(st.lat.toFixed(3), st.lon.toFixed(3))} · ${t.upd(fmtDate(d.obs ? d.obs.at : d.at, t.dateFmt))}</p>
${cards}
${d.obs && d.obs.kind === 'seoul' ? `<p class="note" style="margin:0 0 10px">${d.obs.extra && d.obs.extra.length ? `${t.trib}: ${d.obs.extra.map(x => `${esc(x.name)} ${x.t}°C`).join(' · ')}<br>` : ''}${t.seoulSrc}</p>` : ''}
<div class="cta"><a class="btn" href="/?no=${st.no}">${t.cta}</a><button class="btn g" id="share" type="button">${t.share}</button></div>
${tide}${days}${climH}${inland ? '' : depthHtml(lang, depth)}${shopHtml}${nearHtml}
<h2>${t.aboutH(esc(st.name))}</h2><p class="txt">${esc(inland ? t.aboutIn(st.name, cname) : t.about(st.name, cname))}</p>
<div class="foot">${t.foot}<br>© otemp.app · <a href="/">${t.links[0]}</a><a href="/${lang}/s/">${t.links[1]}</a><a href="/shop/">${t.links[2]}</a><a href="/spot/">${t.links[3]}</a></div>
<script>(function(){var no=${st.no};document.getElementById('share').onclick=function(){var u=location.href.split('#')[0];if(navigator.share){navigator.share({title:document.title,url:u}).catch(function(){})}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){var x=document.getElementById('toast');x.textContent=${JSON.stringify(t.copied)};x.style.display='block';setTimeout(function(){x.style.display='none'},1600)})}};
var ids=[].slice.call(document.querySelectorAll('[data-shop]')).map(function(a){return a.getAttribute('data-shop')}).filter(function(v,i,a){return a.indexOf(v)===i});
try{ids.forEach(function(id){navigator.sendBeacon('/api/shops?svc=imp&id='+encodeURIComponent(id)+'&no='+no)})}catch(e){}
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-shop]');if(!a)return;try{navigator.sendBeacon('/api/shops?svc=click&id='+encodeURIComponent(a.getAttribute('data-shop'))+'&k='+a.getAttribute('data-k')+'&no='+no)}catch(_){}});})();</script>`;

  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'TouristAttraction', name: st.name, description, url: base + hrefs[lang],
      geo: { '@type': 'GeoCoordinates', latitude: st.lat, longitude: st.lon }, ...(st.cc ? { address: { '@type': 'PostalAddress', addressCountry: st.cc } } : {}) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: t.links[1], item: `${base}/${lang}/s/` },
      { '@type': 'ListItem', position: 2, name: cname, item: `${base}/${lang}/s/#${st.cc || 'xx'}` },
      { '@type': 'ListItem', position: 3, name: st.name, item: base + hrefs[lang] }] }
  ];
  return page({ lang, title, desc: description, canonical: hrefs[lang], alternates: hrefs, jsonld, body, base });
}

function renderIndex(lang, all, base) {
  const t = T[lang];
  const groups = {};
  all.forEach(s => { const k = s.cc || 'xx'; (groups[k] = groups[k] || []).push(s); });
  const order = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || regionName(a, lang, a).localeCompare(regionName(b, lang, b), lang));
  const hrefs = Object.fromEntries(LANGS.map(l => [l, `/${l}/s/`]));
  const body = `${header(lang, hrefs)}<div class="idx"><h1 style="margin-top:16px">${t.indexH1}</h1><p class="sub">${t.indexDesc}</p>
${order.map(cc => `<h2 id="${cc}">${esc(regionName(cc, lang, groups[cc][0].country))} <small style="color:var(--dim);font-weight:500">${groups[cc].length}</small></h2><div class="near">${groups[cc].map(s => `<a href="${pathOf(lang, s)}">${esc(nameIn(s, lang))}</a>`).join('')}</div>`).join('')}
<div class="foot">© otemp.app · <a href="/">${t.links[0]}</a><a href="/shop/">${t.links[2]}</a><a href="/spot/">${t.links[3]}</a></div></div>`;
  return page({ lang, title: t.indexTitle, desc: t.indexDesc, canonical: hrefs[lang], alternates: hrefs, body, base });
}

function pickLang(req) {
  const q = String((req.query || {}).lang || '').toLowerCase();
  if (LANGS.includes(q)) return q;
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  for (const part of al.split(',')) { const c = part.trim().slice(0, 2); if (LANGS.includes(c)) return c; }
  return 'en';
}

// 통계(사람/봇/검색 유입). 실패해도 페이지엔 영향 없음
async function count(req, no) {
  try {
    const day = new Date().toISOString().slice(0, 10), hour = String(new Date().getUTCHours());
    const bot = botInfo(req.headers['user-agent']);
    const cmds = [];
    if (bot) {
      const country = req.headers['x-vercel-ip-country'] || '??';
      cmds.push(['HINCRBY', `b:pn:${day}`, `${bot.cat}|${no}`, 1], ['HINCRBY', `b:n:${day}`, bot.name, 1], ['HINCRBY', `b:h:${day}`, `${bot.cat}|${hour}`, 1], ['HINCRBY', `b:c:${day}`, `${bot.cat}|${country}`, 1]);
    } else {
      cmds.push(['HINCRBY', `pg:${day}`, String(no), 1]);
      if (no !== 'index') cmds.push(['HINCRBY', `sv:${day}`, String(no), 1], ['EXPIRE', `sv:${day}`, String(800 * 86400)]); // 샵 실적의 "조회"에도 포함
      const eng = searchEngine(req.headers.referer || req.headers.referrer);
      if (eng) cmds.push(['HINCRBY', `sr:${day}`, eng, 1], ['HINCRBY', `sr:${day}`, `${eng}|${no}`, 1]);
    }
    await S.R(...cmds);
  } catch (_) {}
}

function sendHtml(res, code, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=120'); // CDN 캐시 안 함(조회 수를 정확히 세려고)
  res.status(code).send(html);
}

module.exports = async function spotPage(req, res) {
  const q = req.query || {};
  const base = S.baseOf(req);
  const svc = String(q.svc || 'page');
  try {
    const all = await loadStations(base);
    if (svc === 'sitemap') {
      const today = new Date().toISOString().slice(0, 10);
      const alt = (paths) => LANGS.map(l => `<xhtml:link rel="alternate" hreflang="${l}" href="${base}${paths[l]}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${base}${paths.en}"/>`;
      const urls = [];
      const idx = Object.fromEntries(LANGS.map(l => [l, `/${l}/s/`]));
      LANGS.forEach(l => urls.push(`<url><loc>${base}${idx[l]}</loc>${alt(idx)}<lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>`));
      all.forEach(st => { const p = Object.fromEntries(LANGS.map(l => [l, pathOf(l, st)])); LANGS.forEach(l => urls.push(`<url><loc>${base}${p[l]}</loc>${alt(p)}<lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`)); });
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n<url><loc>${base}/</loc><changefreq>daily</changefreq></url>\n${urls.join('\n')}\n</urlset>`);
    }
    const lang = pickLang(req);
    if (svc === 'index') { count(req, 'index'); return sendHtml(res, 200, renderIndex(lang, all, base)); }
    // [ADD] 이름 바로가기: otemp.app/문섬 → 정식 주소(/ko/s/39/문섬)로. 여러 곳이면 고르는 화면, 없으면 비슷한 이름 목록
    if (svc === 'go') {
      const dec = (x) => { let v = String(x || ''); for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(v); if (d === v) break; v = d; } catch (_) { break; } } return v; };
      const raw = dec(q.name).trim().slice(0, 80);
      const key = (x) => String(x || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const k = key(raw);
      const t = T[lang];
      if (!k) { res.setHeader('Location', '/'); return res.status(302).end(); }
      const keys = (s) => [s.name, s.label, s.slug].map(key);
      let hits = all.filter(s => keys(s).includes(k));
      if (hits.length === 1) {
        // [CHANGE] 상세 페이지가 아니라 지도로: 그 포인트를 지도 가운데에 가장 크게(SPOT_ZOOM) 열기 (앱의 /?no= 바로가기)
        res.setHeader('Location', `/?no=${hits[0].no}`); res.setHeader('Cache-Control', 'public, s-maxage=600');
        return res.status(302).end();
      }
      if (!hits.length) hits = all.filter(s => keys(s).some(x => x.includes(k) || (x.length >= 2 && k.includes(x))));
      const lst = hits.slice(0, 30).map(s => `<li><a href="/?no=${s.no}" style="color:var(--accent)">${esc(s.label || s.name)}</a> <span class="txt" style="font-size:12px">${esc(s.name !== s.label ? s.name : '')} · ${esc(regionName(s.cc, lang, s.country))}</span></li>`).join('');
      const msg = { ko: hits.length ? `"${raw}"에 해당하는 포인트` : `"${raw}" 포인트를 찾지 못했어요`, en: hits.length ? `Spots matching "${raw}"` : `No spot named "${raw}"`, ja: hits.length ? `「${raw}」のポイント` : `「${raw}」のポイントが見つかりません` }[lang];
      const body = `${header(lang, { ko: '/ko/s/', en: '/en/s/', ja: '/ja/s/' })}<h1 style="margin-top:20px">${esc(msg)}</h1>${lst ? `<div class="card"><ul style="margin:0;padding-left:18px;line-height:2">${lst}</ul></div>` : ''}<p class="txt"><a href="/${lang}/s/" style="color:var(--accent)">${esc(t.indexTitle)}</a></p>`;
      res.setHeader('X-Robots-Tag', 'noindex');
      return sendHtml(res, hits.length ? 200 : 404, page({ lang, title: `${msg} | otemp`, desc: t.indexDesc, canonical: `/${lang}/s/`, body, base }));
    }
    const no = parseInt(q.no, 10);
    const st = all.find(s => s.no === no);
    if (!st) {
      const t = T[lang];
      return sendHtml(res, 404, page({ lang, title: `${t.notFound} | otemp`, desc: t.indexDesc, canonical: `/${lang}/s/`, body: `${header(lang, { ko: '/ko/s/', en: '/en/s/', ja: '/ja/s/' })}<h1 style="margin-top:20px">${t.notFound}</h1><p class="txt"><a href="/${lang}/s/" style="color:var(--accent)">${t.links[1]} ›</a></p>`, base }));
    }
    // 언어 없이 들어왔거나 주소 이름이 다르면 정식 주소로
    const want = pathOf(lang, st);
    const norm = (x) => { let v = String(x || ''); for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(v); if (d === v) break; v = d; } catch (_) { break; } } return v.normalize('NFC').toLowerCase(); };
    if (!q.lang || (q.slug !== undefined && norm(q.slug) !== norm(st.slug))) { res.setHeader('Location', want); res.setHeader('Cache-Control', 'no-store'); return res.status(q.lang ? 301 : 302).end(); }
    // [ADD] 주변 수심: 저장된 값이 없으면 처음 한 번 받아요(9초 넘으면 이번엔 건너뛰고 다음 방문 때)
    const depthP = require('./_depth').depthCached(st.lat, st.lon).then(v => v || Promise.race([require('./_depth').depthAt(st.lat, st.lon), new Promise(r => setTimeout(() => r(null), 9000))])).catch(() => null);
    const [d, shopsAll, clim, , climVis, depth] = await Promise.all([
      dataFor(st, all),
      S.hgetallJSON(S.K.shops).catch(() => ({})),
      climFor(st.lat, st.lon).catch(() => null),
      count(req, st.no),
      climVisFor(st.lat, st.lon).catch(() => null),
      depthP
    ]);
    const live = Object.values(shopsAll).filter(s => S.isLive(s) && (s.spots || []).map(Number).includes(st.no)).map(S.publicShop);
    const shops = [...live.filter(s => s.paid).sort(() => Math.random() - 0.5), ...live.filter(s => !s.paid).sort(() => Math.random() - 0.5)];
    return sendHtml(res, 200, renderSpot(lang, st, all, d, shops, clim, base, climVis, depth));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send('error: ' + esc(String(e && e.message || e)));
  }
};
module.exports._test = { renderSpot, loadStations, visProjection, extremesFromHourly, slugOf, regionCode, fetchClimYear };
