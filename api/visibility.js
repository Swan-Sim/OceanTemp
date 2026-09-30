// [ADD] 시야(물 투명도) 추정용 위성 자료 - Vercel 서버리스 함수.
// 사용: /api/visibility?lat=37.76&lon=-122.53
//
// NOAA CoastWatch(NESDIS STAR)의 "구름 빈칸을 채운(gap-filled DINEOF)" 2km 일별 자료 두 가지를
// 최근 90개 날짜만큼 받아서 날짜별로 합쳐 돌려줍니다.
//   - Kd490  : 490nm 빛이 물속에서 얼마나 빨리 약해지는지(m^-1) = 물이 탁한 정도
//   - 엽록소 : 식물플랑크톤 농도(mg/m^3)
// 시야 계산(Secchi ≈ 1.7 ÷ Kd490)과 원인 분해는 브라우저(js/live-data.js)에서 합니다.
//
// NOAA 서버가 브라우저 직접 요청(CORS)을 막아서 이 함수가 대신 받아 옵니다. Vercel CDN이
// 12시간 캐시하므로 같은 정점은 하루 두 번 정도만 원본에 요청이 가요. 원본 서버가 가끔
// 502를 내서 한 번 더 시도하고, 해안에 너무 붙어 값이 없으면(육지 픽셀) 바다 쪽으로 조금씩
// 옮겨가며 값이 있는 픽셀을 찾습니다.
const BASE = 'https://coastwatch.noaa.gov/erddap/griddap/';
const KD_DS = 'noaacwNPPN20S3AkdSCIDINEOF2kmDaily';
const CHL_DS = 'noaacwNPPN20S3ASCIDINEOF2kmDaily';
const OFFSETS = [[0, 0], [0, -0.03], [0, 0.03], [-0.03, 0], [0.03, 0], [0, -0.06], [0, 0.06]];

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
async function fetchSeries(ds, variable, lat, lon) {
  const url = `${BASE}${ds}.csv?${variable}%5Blast-89:1:last%5D%5B0%5D%5B(${lat.toFixed(3)})%5D%5B(${lon.toFixed(3)})%5D`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const lines = (await fetchText(url, 9000)).trim().split('\n').slice(2);
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
  throw lastErr;
}

module.exports = async function handler(req, res) {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat, lon 필요' });
  }
  try {
    // 1) Kd490: 값이 있는 픽셀을 찾을 때까지 바다 쪽으로 조금씩 이동
    let kd = null, used = null;
    for (const [dLat, dLon] of OFFSETS) {
      const s = await fetchSeries(KD_DS, 'kd_490', lat + dLat, lon + dLon);
      const valid = s.rows.filter(r => r[1] != null).length;
      if (valid >= 10) { kd = s; used = [lat + dLat, lon + dLon]; break; }
    }
    if (!kd) {
      res.setHeader('Cache-Control', 's-maxage=86400');
      return res.status(200).json({ ok: false, reason: 'no-ocean-pixel' });
    }
    // 2) 엽록소: 같은 위치. 실패해도 시야는 보여줄 수 있으니 없이 진행
    let chlMap = {};
    try {
      const c = await fetchSeries(CHL_DS, 'chlor_a', used[0], used[1]);
      c.rows.forEach(([d, v]) => { chlMap[d] = v; });
    } catch (_) { chlMap = null; }

    const days = kd.rows.map(([d, v]) => ({ d, kd: v, chl: chlMap ? (chlMap[d] ?? null) : null }));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
    res.status(200).json({
      ok: true,
      source: 'NOAA CoastWatch NESDIS STAR - VIIRS/OLCI gap-filled (DINEOF) Kd490 & chlorophyll-a, 2km daily',
      pixel: kd.pixel, hasChl: !!chlMap, days
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    const cause = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
    res.status(502).json({ ok: false, error: String(e && e.message || e) + cause });
  }
};

// 원본 서버가 느릴 때를 대비해 최대 실행 시간을 늘려 둡니다(기본 10초).
module.exports.config = { maxDuration: 30 };
