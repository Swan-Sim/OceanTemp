// [ADD] 유럽(및 그 밖의 바다) 실측 - Copernicus Marine In Situ(유럽 해양관측 통합 자료) 중계. 키 필요 없음.
// 각 나라 기관(스페인 항만청, 영국 기상청, 네덜란드 수자원청, 포르투갈 등)의 부이·조위관측소 자료를
// Copernicus가 모아서 공개 저장소에 하루 단위 파일(NetCDF4)로 올려 둡니다. 브라우저가 이 파일을 직접 읽기는 무거워서
// 여기서 받아 간추린 뒤 돌려줘요.
//   /api/cmems?svc=stations                         → 최근 10일 안에 자료가 들어온 고정 부이·조위관측소 목록(하루 캐시)
//   /api/cmems?svc=obs&id=IR_TS_MO_Barcelona-coast-buoy&days=7 → 최근 며칠 실측(UTC ms): 수온·파고·주기·바람·조위
//   /api/cmems?svc=wtdaily&id=...&m=...&days=155     → 수온 일평균(90일 추이용, Redis에 날짜별 저장)
//   /api/cmems?svc=wtclim&id=...                    → 저장된 일평균으로 월별 평년
//   /api/cmems?svc=backfill&id=...&m=...&months=36  → 지난 3년 월별 파일을 받아 일평균을 미리 쌓아 둠(매일 GitHub 작업이 호출)
const { redisPipeline } = require('./_redis');
const { parseNc } = require('./_nc');

const BASE = 'https://s3.waw3-1.cloudferro.com/mdl-native-01/native/INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030/cmems_obs-ins_glo_phybgcwav_mynrt_na_irr_202311/';
const ID_RE = /^[A-Z]{2}_TS_(MO|TG|DB)_[A-Za-z0-9._-]{1,60}$/;

async function get(url, ms, asText) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || 15000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'OceanTemp (otemp.app)' } });
    if (r.status === 404 || r.status === 403) return null; // 그날 파일 없음
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return asText ? await r.text() : await r.arrayBuffer();
  } finally { clearTimeout(timer); }
}

const ymdUtc = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

// 관측소 목록: index_platform.txt(약 18MB)에서 최근 자료가 있는 고정 관측소만 간추림
async function stationList() {
  try {
    const [{ result }] = await redisPipeline([['GET', 'cmems:stations']]);
    if (result) { const s = JSON.parse(result); if (Date.now() - s.savedAt < 86400e3) return s.list; }
  } catch (_) {}
  const text = await get(BASE + 'index_platform.txt', 50000, true);
  if (!text) throw new Error('index_platform.txt 없음');
  const recent = Date.now() - 10 * 86400e3;
  const list = [];
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const c = line.split(',');
    const n = c.length;
    if (n < 11) continue;
    const last = Date.parse(c[n - 1]);
    if (!(last > recent)) continue;
    const lat = +c[n - 3], lon = +c[n - 2];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const toks = String(c[4]).split(' ');
    const pick = (suffix) => {
      const all = toks.filter(s => s.endsWith(suffix)).map(s => s.slice(0, -suffix.length));
      return all.find(s => /_TS_(MO|TG)_/.test(s)) || null; // 떠다니는 부이(DB)는 위치가 바뀌어서 제외
    };
    const d = pick('_YYYYMMDD');
    if (!d || !ID_RE.test(d)) continue;
    const m = pick('_YYYYMM');
    const par = ' ' + c[n - 4] + ' ';
    let p = '';
    if (par.includes(' TEMP ')) p += 'T';
    if (/ (VHM0|VAVH) /.test(par)) p += 'W';
    if (par.includes(' SLEV ')) p += 'S';
    if (par.includes(' WSPD ')) p += 'V';
    if (!p) continue;
    list.push({ id: d, m: m && m !== d ? m : undefined, name: c[0], inst: String(c[5] || '').slice(0, 60), lat: +lat.toFixed(4), lon: +lon.toFixed(4), p });
  }
  if (list.length > 300) {
    try { await redisPipeline([['SET', 'cmems:stations', JSON.stringify({ savedAt: Date.now(), list }), 'EX', String(3 * 86400)]]); } catch (_) {}
  }
  return list;
}

// 하루치 파일 하나 → 행 목록 (지난 날짜는 Redis에 6시간 저장: 늦게 들어오는 자료가 있어서 길게는 안 둠)
async function dayRows(id, ymd) {
  const key = `cmems:day:${id}:${ymd}`;
  const isPast = ymd < ymdUtc(Date.now() - 86400e3);
  if (isPast) {
    try { const [{ result }] = await redisPipeline([['GET', key]]); if (result) return JSON.parse(result); } catch (_) {}
  }
  const buf = await get(`${BASE}latest/${ymd}/${id}_${ymd}.nc`, 15000);
  const rows = buf ? await parseNc(buf) : [];
  if (isPast) { try { await redisPipeline([['SET', key, JSON.stringify(rows), 'EX', String(6 * 3600)]]); } catch (_) {} }
  return rows;
}

async function recentObs(id, days) {
  const dates = Array.from({ length: days + 1 }, (_, i) => ymdUtc(Date.now() - i * 86400e3));
  const parts = await Promise.all(dates.map(d => dayRows(id, d).catch(() => [])));
  const cutoff = Date.now() - days * 86400e3;
  return parts.flat().filter(r => r.t >= cutoff).sort((a, b) => a.t - b.t);
}

// 행 목록 → 날짜별 수온 평균 { YYYYMMDD: 평균 }
function dailyMeans(rows) {
  const by = {};
  rows.forEach(r => { if (r.wt == null || r.wt < -3 || r.wt > 40) return; const d = ymdUtc(r.t); (by[d] = by[d] || []).push(r.wt); });
  const out = {};
  Object.keys(by).forEach(d => { const a = by[d]; if (a.length >= 3) out[d] = +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2); });
  return out;
}

async function hgetall(H) {
  const stored = {};
  try { const [{ result }] = await redisPipeline([['HGETALL', H]]); if (Array.isArray(result)) for (let i = 0; i < result.length; i += 2) stored[result[i]] = result[i + 1]; } catch (_) {}
  return stored;
}

// 월별 파일(지난 달들)로 일평균을 채워 Redis 해시 cmems:wtd:{id}에 저장.  필드: YYYYMMDD → 평균, M:YYYYMM → 처리 표시
async function fillMonths(id, mid, months, maxFetch, stored) {
  if (!mid) return 0;
  const type = mid.split('_')[2];
  const now = new Date();
  const list = [];
  for (let k = 1; k <= months; k++) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    const ym = dt.toISOString().slice(0, 7).replace('-', '');
    if (!stored['M:' + ym]) list.push(ym);
  }
  const todo = list.slice(0, maxFetch);
  const fresh = {};
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < todo.length) {
      const ym = todo[next++];
      try {
        const buf = await get(`${BASE}monthly/${type}/${ym}/${mid}_${ym}.nc`, 25000);
        // 지난달 파일은 다음 달 초에 올라와요. 아직 없으면(최근 2개월) 표시하지 않고 다음에 다시 시도
        const recentMonth = ym >= ymdUtc(Date.now() - 45 * 86400e3).slice(0, 6);
        if (!buf) { if (!recentMonth) fresh['M:' + ym] = 'na'; continue; }
        Object.assign(fresh, dailyMeans(await parseNc(buf)));
        fresh['M:' + ym] = '1';
      } catch (_) {}
    }
  }));
  const keys = Object.keys(fresh);
  if (keys.length) {
    try { await redisPipeline([['HSET', `cmems:wtd:${id}`, ...keys.flatMap(k => [k, String(fresh[k])])], ['EXPIRE', `cmems:wtd:${id}`, String(400 * 86400)]]); } catch (_) {}
    Object.assign(stored, fresh);
  }
  return todo.length;
}

// 최근 약 30일은 하루 파일(latest)로. 이틀 지난 날은 해시에 저장
async function fillRecentDays(id, days, stored) {
  const n = Math.min(days, 30);
  const today = ymdUtc(Date.now()), yday = ymdUtc(Date.now() - 86400e3);
  const dates = Array.from({ length: n }, (_, i) => ymdUtc(Date.now() - i * 86400e3)).filter(d => !(d in stored) || d === today || d === yday);
  const fresh = {}, live = {};
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < dates.length) {
      const d = dates[next++];
      try {
        const buf = await get(`${BASE}latest/${d}/${id}_${d}.nc`, 15000);
        const m = buf ? dailyMeans(await parseNc(buf)) : {};
        const v = m[d];
        if (d === today || d === yday) { if (v != null) live[d] = v; }
        else fresh[d] = v != null ? v : 'na';
      } catch (_) {}
    }
  }));
  const keys = Object.keys(fresh);
  if (keys.length) {
    try { await redisPipeline([['HSET', `cmems:wtd:${id}`, ...keys.flatMap(k => [k, String(fresh[k])])], ['EXPIRE', `cmems:wtd:${id}`, String(400 * 86400)]]); } catch (_) {}
  }
  Object.assign(stored, fresh, live);
}

function climFrom(stored) {
  const byMonth = Array.from({ length: 12 }, () => []);
  Object.entries(stored).forEach(([d, v]) => { if (!/^\d{8}$/.test(d) || v === 'na') return; byMonth[+d.slice(4, 6) - 1].push(+v); });
  const months = byMonth.map(a => a.length >= 10 ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
  const nDays = byMonth.reduce((a, m) => a + m.length, 0);
  return { months, nDays, years: +(nDays / 365).toFixed(1) };
}

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  const send = (body, cache) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', cache ? `s-maxage=${cache}, stale-while-revalidate=3600` : 'no-store');
    res.status(200).json(body);
  };
  try {
    const svc = req.query.svc;
    if (svc === 'stations') {
      const list = await stationList();
      return send({ ok: true, ms: Date.now() - t0, count: list.length, stations: list }, 43200);
    }
    const id = String(req.query.id || '');
    if (!ID_RE.test(id)) return res.status(400).json({ ok: false, error: 'id(예: IR_TS_MO_Barcelona-coast-buoy)가 필요해요' });
    const mid = ID_RE.test(String(req.query.m || '')) ? String(req.query.m) : id;
    if (svc === 'obs') {
      const days = Math.max(1, Math.min(8, parseInt(req.query.days, 10) || 7));
      const rows = await recentObs(id, days);
      return send({ ok: true, id, ms: Date.now() - t0, count: rows.length, rows }, 1200);
    }
    if (svc === 'wtdaily') {
      const days = Math.max(7, Math.min(200, parseInt(req.query.days, 10) || 155));
      const stored = await hgetall(`cmems:wtd:${id}`);
      await fillRecentDays(id, days, stored);
      await fillMonths(id, mid, Math.ceil(days / 30) + 1, 8, stored);
      const from = ymdUtc(Date.now() - days * 86400e3);
      const rows = Object.keys(stored).filter(d => /^\d{8}$/.test(d) && d >= from && stored[d] !== 'na').sort()
        .map(d => ({ d: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, t: +stored[d] }));
      return send({ ok: true, id, ms: Date.now() - t0, count: rows.length, rows }, 21600);
    }
    if (svc === 'wtclim') {
      const stored = await hgetall(`cmems:wtd:${id}`);
      return send({ ok: true, id, ...climFrom(stored) }, 43200);
    }
    if (svc === 'backfill') {
      const months = Math.max(1, Math.min(40, parseInt(req.query.months, 10) || 36));
      const maxFetch = Math.max(1, Math.min(40, parseInt(req.query.maxFetch, 10) || 12));
      const stored = await hgetall(`cmems:wtd:${id}`);
      const fetched = await fillMonths(id, mid, months, maxFetch, stored);
      return send({ ok: true, id, ms: Date.now() - t0, fetched, ...climFrom(stored), months: undefined }, 0);
    }
    return res.status(400).json({ ok: false, error: 'svc는 stations | obs | wtdaily | wtclim | backfill' });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    const cause = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
    res.status(502).json({ ok: false, ms: Date.now() - t0, error: String(e && e.message || e) + cause });
  }
};
