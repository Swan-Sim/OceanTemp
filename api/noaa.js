// [ADD] 미국 NOAA 실측 자료 중계 - Vercel 서버리스 함수. (키 필요 없음)
//   /api/noaa?svc=stations      → CO-OPS 조위·수온 관측소 + NDBC 기상 부이 목록(간추린 형태). 짝짓기용, 하루 캐시
//   /api/noaa?svc=ndbc&id=46026 → NDBC 부이 최근 실측(파고·수온·바람, UTC). NDBC는 브라우저 직접 호출(CORS)이 막혀서 여기서 받아요
// CO-OPS 자료 자체(조위·수온·바람·조석 예측)는 브라우저 직접 호출이 허용돼서 사이트가 바로 불러요.
const { redisPipeline } = require('./_redis');

const COOPS_MD = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=';
const NDBC_ACTIVE = 'https://www.ndbc.noaa.gov/activestations.xml';
const NDBC_RT = 'https://www.ndbc.noaa.gov/data/realtime2/';

async function getText(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || 15000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'OceanTemp (otemp.app)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}

async function stationList() {
  try {
    const [{ result }] = await redisPipeline([['GET', 'noaa:stations']]);
    if (result) { const s = JSON.parse(result); if (Date.now() - s.savedAt < 7 * 86400e3) return s.body; }
  } catch (_) {}
  const [wl, wt, ndbcXml] = await Promise.allSettled([
    getText(COOPS_MD + 'waterlevels', 25000), getText(COOPS_MD + 'watertemp', 25000), getText(NDBC_ACTIVE, 25000)
  ]);
  const coops = new Map();
  const addCoops = (res, flag) => {
    if (res.status !== 'fulfilled') return;
    let j; try { j = JSON.parse(res.value); } catch (_) { return; }
    (j.stations || []).forEach(s => {
      if (!Number.isFinite(+s.lat) || !Number.isFinite(+s.lng)) return;
      const o = coops.get(s.id) || { id: s.id, name: s.name, lat: +(+s.lat).toFixed(4), lon: +(+s.lng).toFixed(4), wl: false, wt: false };
      o[flag] = true; coops.set(s.id, o);
    });
  };
  addCoops(wl, 'wl'); addCoops(wt, 'wt');
  const ndbc = [];
  if (ndbcXml.status === 'fulfilled') {
    const re = /<station\s+([^>]*?)\/?>/g; let m;
    while ((m = re.exec(ndbcXml.value))) {
      const a = {}; m[1].replace(/(\w+)="([^"]*)"/g, (_, k, v) => { a[k] = v; });
      if (a.met !== 'y' || !Number.isFinite(+a.lat) || !Number.isFinite(+a.lon)) continue;
      ndbc.push({ id: a.id, name: (a.name || '').replace(/&amp;/g, '&'), lat: +a.lat, lon: +a.lon, type: a.type });
    }
  }
  const body = { coops: [...coops.values()], ndbc };
  if (body.coops.length > 100 && ndbc.length > 100) {
    try { await redisPipeline([['SET', 'noaa:stations', JSON.stringify({ savedAt: Date.now(), body }), 'EX', String(10 * 86400)]]); } catch (_) {}
  }
  return body;
}

// NDBC 표준 기상 파일(.txt): 최근 45일, 최신이 위. 최근 8일만 간추려서 돌려줌 (시각은 UTC)
async function ndbcRecent(id) {
  const text = await getText(NDBC_RT + id + '.txt', 12000);
  const lines = text.split('\n');
  const head = (lines[0] || '').replace(/^#/, '').trim().split(/\s+/);
  const col = (n) => head.indexOf(n);
  const iW = col('WVHT'), iT = col('WTMP'), iS = col('WSPD'), iD = col('WDIR'), iG = col('GST'), iP = col('DPD');
  const cutoff = Date.now() - 8 * 86400e3;
  const rows = [];
  for (const line of lines.slice(2)) {
    const c = line.trim().split(/\s+/);
    if (c.length < 5) continue;
    const t = Date.UTC(+c[0], +c[1] - 1, +c[2], +c[3], +c[4]);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const n = (i) => (i < 0 || c[i] === undefined || c[i] === 'MM') ? null : +c[i];
    rows.push({ t, wvht: n(iW), wtmp: n(iT), wspd: n(iS), wdir: n(iD), gst: n(iG), dpd: n(iP) });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

// 지난 해 비교·평년: CO-OPS 수온 최근 4년(1년씩 4번 요청) → 날짜별 평균. Redis에 7일 저장
// 고장 난 센서가 하루 종일 같은 값(예: 0.0)을 보내는 날은 버려요(하루 최고-최저 차이가 0.05°C 미만)
async function coopsDaily(id) {
  const key = `noaa:wtd:${id}`;
  try { const [{ result }] = await redisPipeline([['GET', key]]); if (result) return JSON.parse(result); } catch (_) {}
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const now = Date.now(), Y = 365 * 86400e3;
  const parts = await Promise.all([0, 1, 2, 3].map(i => getText(
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${id}&product=water_temperature&units=metric&time_zone=lst_ldt&format=json&application=OceanTemp&interval=h&begin_date=${ymd(now - (i + 1) * Y + 86400e3)}&end_date=${ymd(now - i * Y)}`, 25000
  ).then(t => JSON.parse(t)).catch(() => null)));
  const by = {};
  parts.forEach(j => ((j && j.data) || []).forEach(o => { const v = +o.v; if (!Number.isFinite(v) || v < -3 || v > 40) return; const d = String(o.t).slice(0, 10).replace(/-/g, ''); (by[d] = by[d] || []).push(v); }));
  const days = {};
  Object.entries(by).forEach(([d, a]) => {
    if (a.length >= 6 && Math.max(...a) - Math.min(...a) < 0.05) return; // 멈춘 센서
    days[d] = +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
  });
  const body = { days };
  if (Object.keys(days).length > 60) { try { await redisPipeline([['SET', key, JSON.stringify(body), 'EX', String(7 * 86400)]]); } catch (_) {} }
  return body;
}
async function coopsClim(id) {
  const { days } = await coopsDaily(id);
  const byMonth = Array.from({ length: 12 }, () => []);
  Object.entries(days).forEach(([d, v]) => byMonth[+d.slice(4, 6) - 1].push(v));
  const months = byMonth.map(a => a.length >= 10 ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
  const nDays = Object.keys(days).length;
  return { months, nDays, years: +(nDays / 365).toFixed(1) };
}

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  const send = (body, cache) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `s-maxage=${cache}, stale-while-revalidate=3600`);
    res.status(200).json(body);
  };
  try {
    if (req.query.svc === 'stations') {
      const body = await stationList();
      return send({ ok: true, ms: Date.now() - t0, coops: body.coops, ndbc: body.ndbc }, 86400);
    }
    if (req.query.svc === 'ndbc') {
      const id = String(req.query.id || '');
      if (!/^[A-Za-z0-9]{3,8}$/.test(id)) return res.status(400).json({ ok: false, error: 'id 필요' });
      const rows = await ndbcRecent(id);
      return send({ ok: true, id, ms: Date.now() - t0, count: rows.length, rows }, 1200);
    }
    if (req.query.svc === 'wtclim') {
      const id = String(req.query.id || '');
      if (!/^\d{7}$/.test(id)) return res.status(400).json({ ok: false, error: 'id(7자리) 필요' });
      const body = await coopsClim(id);
      return send({ ok: true, id, ms: Date.now() - t0, ...body }, 86400);
    }
    if (req.query.svc === 'wtyears') {
      const id = String(req.query.id || '');
      if (!/^\d{7}$/.test(id)) return res.status(400).json({ ok: false, error: 'id(7자리) 필요' });
      const body = await coopsDaily(id);
      return send({ ok: true, id, ms: Date.now() - t0, days: body.days }, 43200);
    }
    return res.status(400).json({ ok: false, error: 'svc는 stations | ndbc | wtclim | wtyears' });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    const cause = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
    res.status(502).json({ ok: false, ms: Date.now() - t0, error: String(e && e.message || e) + cause });
  }
};
