// [ADD] 시야(물 투명도) 추정용 위성 자료 - Vercel 서버리스 함수.
// 사용: /api/visibility?lat=37.76&lon=-122.53
//
// NOAA CoastWatch(NESDIS STAR)의 "구름 빈칸을 채운(gap-filled DINEOF)" 2km 일별 자료 두 가지를
// 최근 90개 날짜만큼 받아서 날짜별로 합쳐 돌려줍니다.
//   - Kd490  : 490nm 빛이 물속에서 얼마나 빨리 약해지는지(m^-1) = 물이 탁한 정도
//   - 엽록소 : 식물플랑크톤 농도(mg/m^3)
// 시야 계산(Secchi ≈ 1.7 ÷ Kd490)과 원인 분해는 브라우저(js/live-data.js)에서 합니다.
//
// [FIX] "시야 값 불러오는 게 몇 분 걸려" - NOAA 원본은 한 번에 8~18초씩 걸리고 가끔 502를
// 내요. 그래서
//   1) 한 번 받은 결과를 Upstash Redis에 저장해 두고(20시간 동안은 원본에 안 감) 바로 돌려줍니다.
//      Vercel CDN 캐시와 달리 Redis는 전 세계 어느 지역에서 와도 같은 저장소라 첫 방문도 빨라요.
//   2) 매일 GitHub Actions(.github/workflows/warm-visibility.yml)가 모든 정점을 미리 한 번씩
//      불러서 Redis를 채워 둡니다 → 방문자는 거의 항상 즉시 받습니다.
//   3) 원본에 갈 때도 Kd490·엽록소를 동시에 요청하고, 전체 25초 제한을 둬서 몇 분씩 끌지 않게 했어요.
//   4) 원본이 실패하면 7일 이내의 저장본이라도 돌려줍니다.
const { redisPipeline } = require('./_redis');

const BASE = 'https://coastwatch.noaa.gov/erddap/griddap/';
const KD_DS = 'noaacwNPPN20S3AkdSCIDINEOF2kmDaily';
const CHL_DS = 'noaacwNPPN20S3ASCIDINEOF2kmDaily';
// [CHANGE] "코론 시야가 실제 20m 가까운데 2.8m" - 정점 좌표의 픽셀 하나만 쓰면 해안·항구·얕은 산호초 바닥
// 반사 때문에 그 픽셀만 유난히 탁하게 나오는 일이 많았어요(바로 옆 픽셀은 8~10m). 그래서
//   1) 정점 반경 약 3km 안의 모든 바다 픽셀을 받아 날짜별 "중앙값"을 씁니다(튀는 픽셀 하나에 안 끌려감).
//      값이 없으면(육지 안쪽 좌표) 6km, 10km로 넓혀요.
//   2) 교차 확인: 처리 방식이 다른 NOAA VIIRS 근실시간 4km 자료(빈칸 채우기 없음, 더 최근까지)로
//      최근 14일 반경 약 12km 중앙값을 따로 계산해 같이 돌려줍니다(check).
const CHECK_DS = 'noaacwNPPVIIRSkd490Daily';
// [CHANGE] 부산항처럼 항구(2~4m)와 바깥 바다(20m+)가 몇 km 사이에 갈리는 곳이 있어서 5km → 3km로 좁힘.
// 3km 안에도 픽셀 7개쯤이라 튀는 픽셀 하나는 여전히 걸러져요. 값이 없으면 6km, 10km로 넓힘
const RADII = [0.03, 0.06, 0.1], RCHECK = 0.11;
const FRESH_MS = 20 * 3600e3, KEEP_SEC = 7 * 86400;

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const kmBetween = (la1, lo1, la2, lo2) => Math.hypot(la2 - la1, (lo2 - lo1) * Math.cos(la1 * Math.PI / 180)) * 111.2;

// 반경 r(도) 상자 → 원 안 픽셀만, 날짜별 { 날짜: [값...] }
async function fetchBox(ds, variable, lat, lon, r, timeSel, deadline) {
  const url = `${BASE}${ds}.csv?${variable}%5B${timeSel}%5D%5B0%5D%5B(${(lat + r).toFixed(3)}):(${(lat - r).toFixed(3)})%5D%5B(${(lon - r).toFixed(3)}):(${(lon + r).toFixed(3)})%5D`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (left < 2000) break;
    try {
      const lines = (await fetchText(url, Math.min(20000, left))).trim().split('\n').slice(2);
      const by = {};
      const rKm = r * 111.2;
      for (const l of lines) {
        const c = l.split(',');
        const v = parseFloat(c[4]);
        if (!(v > 0)) continue;
        if (kmBetween(lat, lon, +c[2], +c[3]) > rKm) continue;
        (by[c[0].slice(0, 10)] = by[c[0].slice(0, 10)] || []).push(v);
      }
      return by;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('timeout');
}

async function fetchFromNoaa(lat, lon) {
  const deadline = Date.now() + 40000;
  const T90 = 'last-89:1:last';
  const [kdRes, chlRes, chkRes] = await Promise.allSettled([
    fetchBox(KD_DS, 'kd_490', lat, lon, RADII[0], T90, deadline),
    fetchBox(CHL_DS, 'chlor_a', lat, lon, RADII[0], T90, deadline),
    fetchBox(CHECK_DS, 'kd_490', lat, lon, RCHECK, 'last-13:1:last', deadline)
  ]);
  if (kdRes.status !== 'fulfilled') throw kdRes.reason;
  let kd = kdRes.value, chl = chlRes.status === 'fulfilled' ? chlRes.value : null, radiusKm = 3;
  const count = (by) => Object.keys(by || {}).length;
  for (const r of RADII.slice(1)) {
    if (count(kd) >= 10) break;
    // 육지 안쪽 좌표 등 → 반경을 넓혀서
    kd = await fetchBox(KD_DS, 'kd_490', lat, lon, r, T90, deadline).catch(() => ({}));
    chl = await fetchBox(CHL_DS, 'chlor_a', lat, lon, r, T90, deadline).catch(() => null);
    radiusKm = Math.round(r * 111);
  }
  if (count(kd) < 10) return { ok: false, reason: 'no-ocean-pixel' };
  const dates = Object.keys(kd).sort();
  const days = dates.map(d => ({
    d, kd: +median(kd[d]).toFixed(4), n: kd[d].length,
    chl: chl && chl[d] && chl[d].length ? +median(chl[d]).toFixed(4) : null
  }));
  // 교차 확인: 14일 동안의 모든 픽셀 값을 모아 중앙값(구름 때문에 날마다 픽셀 수가 달라서)
  let check = null;
  if (chkRes.status === 'fulfilled') {
    const all = [].concat(...Object.values(chkRes.value));
    const ds = Object.keys(chkRes.value).sort();
    if (all.length >= 5) check = { src: 'NOAA VIIRS NRT 4km', kd: +median(all).toFixed(4), n: all.length, from: ds[0], to: ds[ds.length - 1], radiusKm: 12 };
  }
  return {
    ok: true,
    source: `NOAA CoastWatch NESDIS STAR - VIIRS/OLCI gap-filled (DINEOF) Kd490 & chlorophyll-a, 2km daily, median within ${radiusKm} km`,
    method: 'median', radiusKm, pixel: [lat, lon], hasChl: !!chl && days.some(x => x.chl != null),
    days, check
  };
}

module.exports = async function handler(req, res) {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat, lon 필요' });
  }
  const key = `vis3:${lat.toFixed(3)}_${lon.toFixed(3)}`; // 방식이 바뀌어서 새 키(예전 한 픽셀 값과 섞이지 않게)
  const send = (body, cacheState, maxAge) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `s-maxage=${maxAge}, stale-while-revalidate=86400`);
    res.setHeader('X-Vis-Cache', cacheState);
    res.status(200).send(JSON.stringify(body));
  };

  // 1) Redis 저장본
  let stored = null;
  try {
    const [{ result }] = await redisPipeline([['GET', key]]);
    if (result) stored = JSON.parse(result);
  } catch (_) { /* Redis가 없거나 실패해도 원본으로 진행 */ }
  // 매일 미리 채우기(refresh=1)용 - 남용 방지로 저장한 지 6시간이 지난 것만 새로 받음
  const force = req.query.refresh === '1' && stored && Date.now() - stored.savedAt > 6 * 3600e3;
  if (stored && !force && Date.now() - stored.savedAt < FRESH_MS) return send(stored.body, 'redis', 21600);

  // 2) NOAA 원본
  try {
    const body = await fetchFromNoaa(lat, lon);
    try { await redisPipeline([['SET', key, JSON.stringify({ savedAt: Date.now(), body }), 'EX', String(KEEP_SEC)]]); } catch (_) {}
    return send(body, 'noaa', body.ok ? 21600 : 86400);
  } catch (e) {
    // 3) 원본 실패 → 조금 오래된 저장본이라도
    if (stored) return send(stored.body, 'redis-stale', 600);
    res.setHeader('Cache-Control', 'no-store');
    const cause = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
    return res.status(502).json({ ok: false, error: String(e && e.message || e) + cause });
  }
};
