// [ADD] 국립해양조사원(KHOA) 공공데이터포털 API 중계 - Vercel 서버리스 함수.
// 인증키는 코드에 넣지 않고 Vercel 환경변수 KHOA_API_KEY에서 읽어요.
// 사용 예:
//   /api/khoa?svc=stations                       → 관측소 목록(코드·이름·위도·경도). 사이트가 가까운 관측소를 찾을 때 씀
//   /api/khoa?svc=obs&obs=DT_0004&days=3          → 최근 3일 실측(10분 간격: 수온·조위·바람·기온), 간추린 형태
//   /api/khoa?svc=wtdaily&obs=DT_0004&days=150    → 실측 수온 일평균(90일 추이용, Redis에 날짜별 저장)
//   /api/khoa?svc=recent&obs=DT_0004              → 최신 관측 원본(오늘, 10분 간격)
//   /api/khoa?svc=wtemp&obs=DT_0004&date=20261001 → 실측 수온 원본(1시간 간격, 그날 하루)
// 정해진 서비스만 허용하고(아무 주소나 대신 불러주지 않게), 결과는 Vercel CDN에 캐시해요.
const { redisPipeline } = require('./_redis');

const SERVICES = {
  recent: { path: '1192136/dtRecent/GetDTRecentApiService', min: 10, cache: 600 },
  wtemp:  { path: '1192136/surveyWaterTemp/GetSurveyWaterTempApiService', min: 60, cache: 1800 }
};

// 관측소 코드 후보: 조위관측소(DT_0001~0099)와 해양과학기지(IE_). 값이 나오는 코드만 목록에 넣어요.
const CANDIDATES = [
  ...Array.from({ length: 99 }, (_, i) => 'DT_' + String(i + 1).padStart(4, '0')),
  'IE_0060', 'IE_0061', 'IE_0062'
];

const ymd = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ''); // 한국 날짜

async function callKhoa(key, svc, obs, date, rows) {
  const url = `https://apis.data.go.kr/${svc.path}?serviceKey=${encodeURIComponent(key)}&type=json` +
    `&obsCode=${obs}&reqDate=${date}&min=${svc.min}&pageNo=1&numOfRows=${rows || 300}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(url, { signal: controller.signal });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch (_) { throw new Error(`HTTP ${r.status} ${text.slice(0, 120)}`); }
    const code = j.header && j.header.resultCode;
    if (code === '03') return []; // 자료 없음
    if (code !== '00') throw new Error(`KHOA ${code} ${j.header && j.header.resultMsg}`);
    const raw = (j.body && j.body.items && j.body.items.item) || [];
    return Array.isArray(raw) ? raw : [raw];
  } finally { clearTimeout(timer); }
}

// 관측소 목록: 후보 코드를 한 줄씩만 조회해서 이름·위치를 모읍니다. 오래 걸리니 Redis에 7일 저장.
async function stationList(key) {
  try {
    const [{ result }] = await redisPipeline([['GET', 'khoa:stations']]);
    if (result) { const s = JSON.parse(result); if (Date.now() - s.savedAt < 7 * 86400e3) return s.list; }
  } catch (_) {}
  const today = ymd(Date.now()), yday = ymd(Date.now() - 86400e3);
  const list = [];
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < CANDIDATES.length) {
      const code = CANDIDATES[next++];
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          let it = await callKhoa(key, SERVICES.recent, code, today, 1);
          if (!it.length) it = await callKhoa(key, SERVICES.recent, code, yday, 1);
          const a = it[0];
          if (a && Number.isFinite(+a.lat) && Number.isFinite(+a.lot)) {
            list.push({ code, name: a.obsvtrNm, lat: +(+a.lat).toFixed(5), lon: +(+a.lot).toFixed(5) });
          }
          break;
        } catch (e) {
          // 초당 호출 한도(23) 등 일시 오류면 잠깐 쉬고 한 번 더, 그 외(없는 코드)는 건너뜀
          if (!/KHOA 2[23]|abort|fetch failed/i.test(String(e && e.message))) break;
          await new Promise(r => setTimeout(r, 700));
        }
      }
    }
  }));
  list.sort((a, b) => a.code.localeCompare(b.code));
  if (list.length >= 30) { // 일부만 잡힌 목록이 오래 저장되지 않게
    try { await redisPipeline([['SET', 'khoa:stations', JSON.stringify({ savedAt: Date.now(), list }), 'EX', String(40 * 86400)]]); } catch (_) {}
  }
  return list;
}

// 최근 며칠 실측을 간추려서: t(한국시각 "YYYY-MM-DD HH:MM"), wt 수온, tide 조위(cm), ws 풍속, wd 풍향, gust 순간최대, at 기온
async function recentObs(key, obs, days) {
  const dates = Array.from({ length: days }, (_, i) => ymd(Date.now() - i * 86400e3));
  const parts = await Promise.all(dates.map(d => callKhoa(key, SERVICES.recent, obs, d, 300).catch(() => [])));
  const seen = new Set(), rows = [];
  let meta = null;
  parts.flat().forEach(a => {
    if (!a || !a.obsrvnDt || seen.has(a.obsrvnDt)) return;
    seen.add(a.obsrvnDt);
    if (!meta) meta = { name: a.obsvtrNm, lat: +a.lat, lon: +a.lot };
    const n = (v) => (v == null || v === '' || !Number.isFinite(+v)) ? null : +v;
    rows.push({ t: String(a.obsrvnDt).slice(0, 16), wt: n(a.wtem), tide: n(a.bscTdlvHgt), ws: n(a.wspd), wd: n(a.wndrct), gust: n(a.maxMmntWspd), at: n(a.artmp) });
  });
  rows.sort((a, b) => a.t.localeCompare(b.t));
  return { meta, rows };
}


// [ADD] 90일 추이용: 실측 수온 "일평균"을 최근 N일(최대 160일) 돌려줌.
// 실측 수온 API는 하루치씩만 주기 때문에, 한 번 계산한 날은 Redis에 저장해 두고 빠진 날만 새로 받아요
// (처음 한 번만 오래 걸리고, 이후엔 하루 1번 호출).
async function dailyWaterTemp(key, obs, days) {
  const H = `khoa:wtd:${obs}`;
  const dates = Array.from({ length: days }, (_, i) => ymd(Date.now() - (i + 1) * 86400e3)); // 어제부터 과거로
  let stored = {};
  try { const [{ result }] = await redisPipeline([['HGETALL', H]]); if (Array.isArray(result)) for (let i = 0; i < result.length; i += 2) stored[result[i]] = result[i + 1]; } catch (_) {}
  const missing = dates.filter(d => !(d in stored));
  const fresh = {};
  let next = 0;
  const deadline = Date.now() + 40000;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < missing.length && Date.now() < deadline) {
      const d = missing[next++];
      try {
        const items = await callKhoa(key, SERVICES.wtemp, obs, d, 30);
        const v = items.map(a => +a.wtem).filter(x => Number.isFinite(x) && x > -3 && x < 40);
        // 자료가 없는 날은 'na'로 표시(3일 넘게 지난 날만 - 최근 날은 나중에 들어올 수 있어서 다시 시도)
        if (v.length) fresh[d] = (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2);
        else if (Date.now() - Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) > 4 * 86400e3) fresh[d] = 'na';
      } catch (_) { /* 이번엔 건너뛰고 다음 요청 때 다시 */ }
    }
  }));
  const freshKeys = Object.keys(fresh);
  if (freshKeys.length) {
    try { await redisPipeline([['HSET', H, ...freshKeys.flatMap(k => [k, fresh[k]])], ['EXPIRE', H, String(400 * 86400)]]); } catch (_) {}
  }
  const all = { ...stored, ...fresh };
  return dates.slice().reverse()
    .filter(d => all[d] && all[d] !== 'na')
    .map(d => ({ d: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, t: +all[d] }));
}

module.exports = async function handler(req, res) {
  const key = process.env.KHOA_API_KEY;
  if (!key) return res.status(500).json({ ok: false, error: 'KHOA_API_KEY 환경변수가 없어요 (Vercel → Environments → Production에 추가)' });
  const svcName = req.query.svc;
  const obs = String(req.query.obs || '');
  const t0 = Date.now();
  const sendJson = (body, cache) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `s-maxage=${cache}, stale-while-revalidate=3600`);
    res.status(200).json(body);
  };
  try {
    if (svcName === 'stations') {
      const list = await stationList(key);
      return sendJson({ ok: true, ms: Date.now() - t0, count: list.length, stations: list }, 86400);
    }
    if (!/^[A-Z]{2}_\d{4}$/.test(obs)) return res.status(400).json({ ok: false, error: 'obs(예: DT_0004)가 필요해요' });
    if (svcName === 'wtdaily') {
      const days = Math.max(7, Math.min(160, parseInt(req.query.days, 10) || 90));
      const rows = await dailyWaterTemp(key, obs, days);
      return sendJson({ ok: true, obs, ms: Date.now() - t0, count: rows.length, rows }, 21600);
    }
    if (svcName === 'obs') {
      const days = Math.max(1, Math.min(7, parseInt(req.query.days, 10) || 3));
      const { meta, rows } = await recentObs(key, obs, days);
      return sendJson({ ok: true, obs, ms: Date.now() - t0, meta, count: rows.length, rows }, 600);
    }
    const svc = SERVICES[svcName];
    if (!svc) return res.status(400).json({ ok: false, error: 'svc는 stations | obs | wtdaily | recent | wtemp 중 하나예요' });
    const date = /^\d{8}$/.test(req.query.date || '') ? req.query.date : ymd(Date.now());
    const items = await callKhoa(key, svc, obs, date, 300);
    return sendJson({ ok: true, svc: svcName, obs, date, ms: Date.now() - t0, count: items.length, items }, svc.cache);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    const cause = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
    res.status(502).json({ ok: false, ms: Date.now() - t0, error: String(e && e.message || e) + cause });
  }
};
