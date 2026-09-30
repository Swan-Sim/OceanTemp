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
const OFFSETS = [[0, -0.03], [0, 0.03], [-0.03, 0], [0.03, 0]]; // 해안 픽셀에 값이 없을 때만 사용
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

// 90일치 한 픽셀 시계열 → { pixel:[lat,lon], rows:[[날짜, 값|null], ...] }
async function fetchSeries(ds, variable, lat, lon, deadline) {
  const url = `${BASE}${ds}.csv?${variable}%5Blast-89:1:last%5D%5B0%5D%5B(${lat.toFixed(3)})%5D%5B(${lon.toFixed(3)})%5D`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    try {
      const lines = (await fetchText(url, Math.min(12000, left))).trim().split('\n').slice(2);
      let pixel = null;
      const rows = lines.map(l => {
        const c = l.split(',');
        if (!pixel) pixel = [+(+c[2]).toFixed(4), +(+c[3]).toFixed(4)];
        const v = parseFloat(c[4]);
        return [c[0].slice(0, 10), Number.isFinite(v) && v > 0 ? +v.toFixed(4) : null];
      });
      return { pixel, rows };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('timeout');
}

const validCount = (s) => s ? s.rows.filter(r => r[1] != null).length : 0;

async function fetchFromNoaa(lat, lon) {
  const deadline = Date.now() + 25000;
  // Kd490과 엽록소를 동시에 요청 (엽록소는 실패해도 시야는 보여줄 수 있음)
  const [kdRes, chlRes] = await Promise.allSettled([
    fetchSeries(KD_DS, 'kd_490', lat, lon, deadline),
    fetchSeries(CHL_DS, 'chlor_a', lat, lon, deadline)
  ]);
  let kd = kdRes.status === 'fulfilled' ? kdRes.value : null;
  let chl = chlRes.status === 'fulfilled' ? chlRes.value : null;
  if (!kd && kdRes.reason) throw kdRes.reason;
  // 해안에 너무 붙어 값이 없으면(육지 픽셀) 바다 쪽으로 조금씩 옮겨서 다시
  if (validCount(kd) < 10) {
    kd = null; chl = null;
    for (const [dLat, dLon] of OFFSETS) {
      if (deadline - Date.now() < 3000) break;
      const s = await fetchSeries(KD_DS, 'kd_490', lat + dLat, lon + dLon, deadline).catch(() => null);
      if (validCount(s) >= 10) {
        kd = s;
        chl = await fetchSeries(CHL_DS, 'chlor_a', lat + dLat, lon + dLon, deadline).catch(() => null);
        break;
      }
    }
    if (!kd) return { ok: false, reason: 'no-ocean-pixel' };
  }
  const chlMap = {};
  if (chl) chl.rows.forEach(([d, v]) => { chlMap[d] = v; });
  return {
    ok: true,
    source: 'NOAA CoastWatch NESDIS STAR - VIIRS/OLCI gap-filled (DINEOF) Kd490 & chlorophyll-a, 2km daily',
    pixel: kd.pixel, hasChl: !!chl,
    days: kd.rows.map(([d, v]) => ({ d, kd: v, chl: chl ? (chlMap[d] ?? null) : null }))
  };
}

module.exports = async function handler(req, res) {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat, lon 필요' });
  }
  const key = `vis:${lat.toFixed(3)}_${lon.toFixed(3)}`;
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
