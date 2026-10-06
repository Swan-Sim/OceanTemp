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
const FRESH_MS = 20 * 3600e3, KEEP_SEC = 21 * 86400; // 이어 붙이기 방식이라 오래 보관

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
      const lines = (await fetchText(url, Math.min(15000, left))).trim().split('\n').slice(2);
      const by = {};
      const rKm = r * 111.2;
      let minKm = Infinity; // 정점 좌표에서 가장 가까운 "바다 값이 있는" 픽셀까지 거리
      for (const l of lines) {
        const c = l.split(',');
        const v = parseFloat(c[4]);
        if (!(v > 0)) continue;
        const dk = kmBetween(lat, lon, +c[2], +c[3]);
        if (dk < minKm) minKm = dk;
        if (dk > rKm) continue;
        (by[c[0].slice(0, 10)] = by[c[0].slice(0, 10)] || []).push(v);
      }
      Object.defineProperty(by, '__minKm', { value: minKm, enumerable: false });
      return by;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('timeout');
}

// [CHANGE] "한국 시야 조회가 너무 오래 걸려" - NOAA 서버가 90일치 상자를 한 번에 달라고 하면 10초 만에
// 502(프록시 시간 초과)를 내요. 그래서
//   1) 처음 받을 때는 30일씩 3번에 나눠서 차례로 받고(실패한 구간이 있어도 받은 만큼 저장),
//   2) 그다음부터는 저장본에 "새로 생긴 최근 10일"만 받아 이어 붙여요(작은 요청이라 1~5초).
//   3) 비어 있는 오래된 구간은 갱신할 때마다 한 구간씩 다시 채워요.
//   4) NOAA가 끝내 안 되면 예전 방식 저장본(vis2/vis)이라도 바로 돌려줘요.
const CHUNKS = ['last-29:1:last', 'last-59:1:last-30', 'last-89:1:last-60'];
const toDays = (kd, chl) => Object.keys(kd).sort().map(d => ({
  d, kd: +median(kd[d]).toFixed(4), n: kd[d].length,
  chl: chl && chl[d] && chl[d].length ? +median(chl[d]).toFixed(4) : null
}));
const mergeDays = (a, b) => {
  const m = new Map((a || []).map(x => [x.d, x]));
  (b || []).forEach(x => m.set(x.d, x));
  return [...m.values()].sort((x, y) => x.d.localeCompare(y.d)).slice(-90);
};
async function fetchCheck(lat, lon, deadline) {
  try {
    const by = await fetchBox(CHECK_DS, 'kd_490', lat, lon, RCHECK, 'last-13:1:last', deadline);
    const all = [].concat(...Object.values(by));
    const ds = Object.keys(by).sort();
    return all.length >= 5 ? { src: 'NOAA VIIRS NRT 4km', kd: +median(all).toFixed(4), n: all.length, from: ds[0], to: ds[ds.length - 1], radiusKm: 12 } : null;
  } catch (_) { return null; }
}
async function fetchChunk(lat, lon, r, sel, deadline) {
  const [kd, chl] = await Promise.all([
    fetchBox(KD_DS, 'kd_490', lat, lon, r, sel, deadline),
    fetchBox(CHL_DS, 'chlor_a', lat, lon, r, sel, deadline).catch(() => null)
  ]);
  const days = toDays(kd, chl);
  days.minKm = kd.__minKm; // 배열에 거리 정보를 붙여서 돌려줌
  return days;
}
// [ADD] "시내(육지) 좌표면 측정 불가가 정상" - 정점 좌표에서 가장 가까운 바다 픽셀까지 거리(km)를 같이 돌려줘서
// 3km보다 멀면 화면에서 시야를 보여주지 않게 해요(좌표가 육지 안쪽이라는 뜻).
const bodyOf = (lat, lon, radiusKm, days, check, nearestSeaKm) => ({
  ok: true, nearestSeaKm: Number.isFinite(nearestSeaKm) ? +nearestSeaKm.toFixed(1) : null,
  source: `NOAA CoastWatch NESDIS STAR - VIIRS/OLCI gap-filled (DINEOF) Kd490 & chlorophyll-a, 2km daily, median within ${radiusKm} km`,
  method: 'median', radiusKm, pixel: [lat, lon], hasChl: days.some(x => x.chl != null), days, check
});

// 처음: 최근 30일로 반경을 정하고(바다 픽셀이 없으면 넓힘), 나머지 60일은 30일씩 차례로
async function fetchFull(lat, lon) {
  const deadline = Date.now() + 50000;
  const checkP = fetchCheck(lat, lon, deadline);
  let days = [], r = RADII[0];
  let seaKm = Infinity;
  for (const rr of RADII) {
    r = rr;
    days = await fetchChunk(lat, lon, rr, CHUNKS[0], deadline);
    if (Number.isFinite(days.minKm)) seaKm = Math.min(seaKm, days.minKm);
    if (days.length >= 5) break;
  }
  if (days.length < 5) return { ok: false, reason: 'no-ocean-pixel' };
  for (const sel of CHUNKS.slice(1)) {
    if (deadline - Date.now() < 8000) break;
    try { days = mergeDays(days, await fetchChunk(lat, lon, r, sel, deadline)); } catch (_) {}
  }
  return bodyOf(lat, lon, Math.round(r * 111), days, await checkP, seaKm);
}

// 갱신: 최근 10일만 + (90일이 덜 찼으면) 오래된 구간 하나
async function fetchUpdate(lat, lon, prev) {
  const deadline = Date.now() + 40000;
  const r = (prev.radiusKm || 3) / 111;
  const checkP = fetchCheck(lat, lon, deadline);
  const recent = await fetchChunk(lat, lon, r, 'last-9:1:last', deadline);
  let seaKm = Number.isFinite(recent.minKm) ? recent.minKm : (prev.nearestSeaKm ?? Infinity);
  let days = mergeDays(prev.days, recent);
  if (days.length < 75) {
    for (const sel of CHUNKS.slice(1).reverse()) {
      if (deadline - Date.now() < 8000) break;
      try { days = mergeDays(days, await fetchChunk(lat, lon, r, sel, deadline)); break; } catch (_) {}
    }
  }
  return bodyOf(lat, lon, prev.radiusKm || 3, days, (await checkP) || prev.check || null, seaKm);
}

module.exports = async function handler(req, res) {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat, lon 필요' });
  }
  const ll = `${lat.toFixed(3)}_${lon.toFixed(3)}`;
  const key = `vis3:${ll}`; // 반경 3km 중앙값 방식
  const send = (body, cacheState, maxAge) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', `s-maxage=${maxAge}, stale-while-revalidate=86400`);
    res.setHeader('X-Vis-Cache', cacheState);
    res.status(200).send(JSON.stringify(body));
  };

  // 1) Redis 저장본 (+ 예전 방식 저장본: 새 방식이 아직 없을 때 대신 보여줄 것)
  let stored = null, legacy = null;
  try {
    const r = await redisPipeline([['GET', key], ['GET', `vis2:${ll}`], ['GET', `vis:${ll}`]]);
    if (r[0].result) stored = JSON.parse(r[0].result);
    legacy = r[1].result ? JSON.parse(r[1].result) : (r[2].result ? JSON.parse(r[2].result) : null);
  } catch (_) { /* Redis가 없거나 실패해도 원본으로 진행 */ }
  // 매일 미리 채우기(refresh=1)용 - 남용 방지로 저장한 지 6시간이 지난 것만 새로 받음
  const force = req.query.refresh === '1' && stored && Date.now() - stored.savedAt > 6 * 3600e3;
  if (stored && !force && Date.now() - stored.savedAt < FRESH_MS) return send(stored.body, 'redis', 21600);
  // [ADD] 포인트 페이지(서버)용: 저장본이 조금 오래됐어도 바로 돌려줌(새로 받기는 30~50초 걸려서 페이지가 시야 없이 나가던 문제)
  if (stored && stored.body && stored.body.ok && req.query.fast === '1') return send(stored.body, 'redis-fast', 600);

  // 2) NOAA 원본: 저장본이 있으면 최근 며칠만 이어 붙이고, 없으면 30일씩 나눠 처음부터
  try {
    const body = stored && stored.body && stored.body.ok ? await fetchUpdate(lat, lon, stored.body) : await fetchFull(lat, lon);
    try { await redisPipeline([['SET', key, JSON.stringify({ savedAt: Date.now(), body }), 'EX', String(KEEP_SEC)]]); } catch (_) {}
    return send(body, stored ? 'noaa-update' : 'noaa', body.ok ? 21600 : 86400);
  } catch (e) {
    // 3) 원본 실패 → 조금 오래된 저장본이라도, 그것도 없으면 예전 방식 저장본
    if (stored) return send(stored.body, 'redis-stale', 600);
    if (legacy && legacy.body && legacy.body.ok) return send(legacy.body, 'legacy', 300);
    res.setHeader('Cache-Control', 'no-store');
    const cause = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
    return res.status(502).json({ ok: false, error: String(e && e.message || e) + cause });
  }
};
