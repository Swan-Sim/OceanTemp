// [ADD] 국립해양조사원(KHOA) 공공데이터포털 API 중계 - Vercel 서버리스 함수.
// 인증키는 코드에 넣지 않고 Vercel 환경변수 KHOA_API_KEY에서 읽어요.
// 사용 예:
//   /api/khoa?svc=recent&obs=DT_0004            → 조위관측소 최신 관측(조위·수온·염분·기온·기압·바람, 10분 간격, 오늘)
//   /api/khoa?svc=wtemp&obs=DT_0004&date=20261001 → 조위관측소 실측 수온(1시간 간격, 그날 하루)
// 정해진 서비스만 허용하고(아무 주소나 대신 불러주지 않게), 결과는 Vercel CDN에 10분 캐시해요.
const SERVICES = {
  recent: { path: '1192136/dtRecent/GetDTRecentApiService', min: 10, cache: 600 },
  wtemp:  { path: '1192136/surveyWaterTemp/GetSurveyWaterTempApiService', min: 60, cache: 1800 }
};

function kstToday() {
  const d = new Date(Date.now() + 9 * 3600e3); // 한국 시간 기준 날짜
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

module.exports = async function handler(req, res) {
  const key = process.env.KHOA_API_KEY;
  const svc = SERVICES[req.query.svc];
  const obs = String(req.query.obs || '');
  const date = /^\d{8}$/.test(req.query.date || '') ? req.query.date : kstToday();
  if (!key) return res.status(500).json({ ok: false, error: 'KHOA_API_KEY 환경변수가 없어요 (Vercel → Environments → Production에 추가)' });
  if (!svc || !/^[A-Z]{2}_\d{4}$/.test(obs)) return res.status(400).json({ ok: false, error: 'svc(recent|wtemp)와 obs(예: DT_0004)가 필요해요' });

  const url = `https://apis.data.go.kr/${svc.path}?serviceKey=${encodeURIComponent(key)}&type=json` +
    `&obsCode=${obs}&reqDate=${date}&min=${svc.min}&pageNo=1&numOfRows=300`;
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch (_) { throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`); }
    const code = j.header && j.header.resultCode;
    if (code !== '00') throw new Error(`KHOA ${code} ${j.header && j.header.resultMsg}`);
    const raw = (j.body && j.body.items && j.body.items.item) || [];
    const items = Array.isArray(raw) ? raw : [raw];
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `s-maxage=${svc.cache}, stale-while-revalidate=3600`);
    res.status(200).json({ ok: true, svc: req.query.svc, obs, date, ms: Date.now() - t0, count: items.length, items });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    const cause = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
    res.status(502).json({ ok: false, ms: Date.now() - t0, error: String(e && e.message || e) + cause });
  }
};
