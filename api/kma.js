// [ADD] 기상청 해양관측(해양기상부이·파고부이) 중계 - Vercel 서버리스 함수.
// 인증키는 Vercel 환경변수 KMA_API_KEY (기상청 API허브).
// 기상청 "해양기상종합관측(sea_obs)"은 한 번 부르면 그 시각의 전국 부이 값을 "전부" 줘요.
// 그래서 시각별 묶음(스냅샷)을 Redis에 저장해 두고 모든 정점이 같이 써요 - 지난 시각 값은 바뀌지 않으니 한 번만 받으면 돼요.
//   /api/kma?svc=stations              → 부이 목록(B 해양기상부이, C 파고부이: 지점번호·이름·위경도)
//   /api/kma?svc=obs&stn=22441&days=7  → 최근 며칠 3시간 간격 실측(수온·파고·바람)
//   /api/kma?svc=daily&stn=22441&days=155 → 매일 정오 수온(90일 추이용)
//   /api/kma?svc=clim&stn=22441        → 쌓인 정오 수온으로 월평균(평년)
//   /api/kma?svc=backfill&days=1095&maxFetch=300 → 매일 GitHub 작업이 정오 수온 3년치를 조금씩 채움(지점별로 저장)
const { redisPipeline } = require('./_redis');

const BASE = 'https://apihub.kma.go.kr/api/typ01/url/sea_obs.php';
const KINDS = new Set(['B', 'C']); // 해양기상부이, 파고부이만 (조위관측소 N은 국립해양조사원 자료로 따로 받음)
const H = 3600e3;

// KST 기준 "YYYYMMDDHH00"
const kstStr = (ms) => new Date(ms + 9 * H).toISOString().replace(/[-T:]/g, '').slice(0, 10) + '00';
const kstHourFloor = (ms) => Math.floor((ms + 9 * H) / H) * H - 9 * H;

async function fetchSnap(key, tm) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(`${BASE}?tm=${tm}&stn=0&help=0&authKey=${encodeURIComponent(key)}`, { signal: controller.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = new TextDecoder('euc-kr').decode(await r.arrayBuffer());
    if (/"status"\s*:\s*4\d\d/.test(text)) throw new Error('KMA ' + text.slice(0, 120));
    const snap = {};
    text.split('\n').forEach(line => {
      if (!/^[A-Z],/.test(line)) return;
      const c = line.split(',').map(s => s.trim());
      if (!KINDS.has(c[0])) return;
      const n = (v) => { const x = +v; return Number.isFinite(x) && x > -90 ? x : null; };
      // [종류, 이름, 경도, 위도, 파고, 풍향, 풍속, 돌풍, 수온, 기온]
      snap[c[2]] = [c[0], c[3], +(+c[4]).toFixed(4), +(+c[5]).toFixed(4), n(c[6]), n(c[7]), n(c[8]), n(c[9]), n(c[10]), n(c[11])];
    });
    return snap;
  } finally { clearTimeout(timer); }
}

// 여러 시각의 스냅샷: Redis에 있으면 꺼내고, 없으면 받아서 저장(지난 시각만)
async function getSnaps(key, tms, maxFetch, deadlineMs) {
  const keys = tms.map(tm => `kma:snap:${tm}`);
  const out = {};
  try {
    const res = await redisPipeline([['MGET', ...keys]]);
    const vals = (res[0] && res[0].result) || [];
    vals.forEach((v, i) => { if (v) out[tms[i]] = JSON.parse(v); });
  } catch (_) {}
  const nowTm = kstStr(kstHourFloor(Date.now()));
  const missing = tms.filter(tm => !out[tm]).slice(0, maxFetch);
  const deadline = Date.now() + deadlineMs;
  const toSave = [];
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < missing.length && Date.now() < deadline) {
      const tm = missing[next++];
      try {
        const s = await fetchSnap(key, tm);
        if (Object.keys(s).length) { out[tm] = s; if (tm < nowTm) toSave.push([tm, s]); }
      } catch (_) {}
    }
  }));
  if (toSave.length) {
    try { await redisPipeline(toSave.map(([tm, s]) => ['SET', `kma:snap:${tm}`, JSON.stringify(s), 'EX', String(10 * 86400)])); } catch (_) {}
  }
  return out;
}

const tmToLocal = (tm) => `${tm.slice(0, 4)}-${tm.slice(4, 6)}-${tm.slice(6, 8)} ${tm.slice(8, 10)}:${tm.slice(10, 12)}`;
const noonDates = (days) => Array.from({ length: days }, (_, i) => kstStr(kstHourFloor(Date.now()) - (i + 1) * 24 * H).slice(0, 8));

// 정오 수온 쌓기: 날짜별 전국 스냅샷(정오)을 받아 지점별 해시(kma:wt:{지점})에 "날짜 → 수온"으로 저장.
// 어떤 날짜를 이미 받았는지는 kma:noondone 집합으로 기억. (스냅샷 자체는 크니까 저장하지 않음)
async function fillNoon(key, dates, maxFetch, deadlineMs) {
  let done = new Set();
  try { const [{ result }] = await redisPipeline([['SMEMBERS', 'kma:noondone']]); done = new Set(result || []); } catch (_) {}
  const missing = dates.filter(d => !done.has(d)).slice(0, maxFetch);
  const deadline = Date.now() + deadlineMs;
  let next = 0, fetched = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < missing.length && Date.now() < deadline) {
      const d = missing[next++];
      try {
        const snap = await fetchSnap(key, d + '1200');
        const cmds = [];
        Object.entries(snap).forEach(([id, v]) => { if (v[8] != null && v[8] > 3 && v[8] < 35) cmds.push(['HSET', `kma:wt:${id}`, d, String(v[8])]); });
        cmds.push(['SADD', 'kma:noondone', d]);
        await redisPipeline(cmds);
        fetched++;
      } catch (_) {}
    }
  }));
  return { fetched, have: done.size + fetched };
}
async function stationNoon(stn) {
  try { const [{ result }] = await redisPipeline([['HGETALL', `kma:wt:${stn}`]]); const o = {}; for (let i = 0; i < (result || []).length; i += 2) o[result[i]] = +result[i + 1]; return o; } catch (_) { return {}; }
}

module.exports = async function handler(req, res) {
  const key = process.env.KMA_API_KEY;
  const t0 = Date.now();
  const send = (body, cache) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `s-maxage=${cache}, stale-while-revalidate=3600`);
    res.status(200).json(body);
  };
  if (!key) return res.status(500).json({ ok: false, error: 'KMA_API_KEY 환경변수가 없어요' });
  const svc = req.query.svc, stn = String(req.query.stn || '');
  try {
    if (svc === 'stations') {
      const now = kstHourFloor(Date.now());
      const tms = [kstStr(now - H), kstStr(now - 2 * H)];
      const snaps = await getSnaps(key, tms, 2, 20000);
      const s = snaps[tms[0]] || snaps[tms[1]] || {};
      const stations = Object.entries(s).map(([id, v]) => ({ id, name: v[1], lat: v[3], lon: v[2], kind: v[0] }));
      return send({ ok: true, ms: Date.now() - t0, count: stations.length, stations }, 86400);
    }
    if (!/^\d{3,6}$/.test(stn) && svc !== 'backfill') return res.status(400).json({ ok: false, error: 'stn 필요' });
    if (svc === 'obs') {
      const days = Math.max(1, Math.min(7, parseInt(req.query.days, 10) || 7));
      const now = kstHourFloor(Date.now());
      const tms = [];
      for (let t = now; t > now - days * 24 * H; t -= H) {
        const hh = new Date(t + 9 * H).getUTCHours();
        if (t > now - 6 * H || hh % 3 === 0) tms.push(kstStr(t)); // 최근 6시간은 매시, 그 전은 3시간 간격
      }
      const snaps = await getSnaps(key, tms, 80, 40000);
      const rows = tms.filter(tm => snaps[tm] && snaps[tm][stn]).sort().map(tm => {
        const v = snaps[tm][stn];
        return { t: tmToLocal(tm), wv: v[4], wd: v[5], ws: v[6], gust: v[7], wt: v[8], at: v[9] };
      });
      return send({ ok: true, stn, ms: Date.now() - t0, count: rows.length, rows }, 900);
    }
    if (svc === 'daily') {
      const days = Math.max(7, Math.min(160, parseInt(req.query.days, 10) || 155));
      const dates = noonDates(days);
      await fillNoon(key, dates, 60, 40000); // 최근 빠진 날만 조금 채우고(나머지는 매일 작업이 채움)
      const o = await stationNoon(stn);
      const rows = dates.filter(d => o[d] != null).sort().map(d => ({ d: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, t: o[d] }));
      return send({ ok: true, stn, ms: Date.now() - t0, count: rows.length, rows }, 21600);
    }
    if (svc === 'years') {
      const days = await stationNoon(stn);
      return send({ ok: true, stn, days }, 43200);
    }
    if (svc === 'clim') {
      const o = await stationNoon(stn);
      const byMonth = Array.from({ length: 12 }, () => []);
      Object.entries(o).forEach(([d, v]) => byMonth[+d.slice(4, 6) - 1].push(v));
      const months = byMonth.map(a => a.length >= 10 ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
      const nDays = byMonth.reduce((a, m) => a + m.length, 0);
      return send({ ok: true, stn, months, nDays, years: +(nDays / 365).toFixed(1) }, 43200);
    }
    if (svc === 'backfill') {
      const days = Math.max(7, Math.min(1300, parseInt(req.query.days, 10) || 1250));
      const maxFetch = Math.max(1, Math.min(400, parseInt(req.query.maxFetch, 10) || 300));
      const r = await fillNoon(key, noonDates(days), maxFetch, 100000);
      return send({ ok: true, ms: Date.now() - t0, ...r, of: days }, 0);
    }
    return res.status(400).json({ ok: false, error: 'svc는 stations | obs | daily | clim | backfill' });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ ok: false, ms: Date.now() - t0, error: String(e && e.message || e) });
  }
};
