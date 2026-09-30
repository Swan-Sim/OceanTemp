// [TEST] 시야(투명도) 추정용 위성 Kd490 접속 테스트 - Vercel 서버리스 함수.
// 사용: /api/kd490?lat=37.76&lon=-122.53
// NOAA CoastWatch ERDDAP의 gap-filled(구름 빈칸 채움) Kd490 2km 일별 자료에서
// 최근 90개 날짜를 받아 Secchi 시야 ≈ 1.7 / Kd490 (m)로 바꿔 돌려줍니다.
// 서버 두 곳을 차례로 시도하고, 어느 쪽이 되는지 결과에 같이 적어요.
const SERVERS = [
  'https://coastwatch.noaa.gov/erddap',
  'https://coastwatch.pfeg.noaa.gov/erddap',
];
const DATASET = 'noaacwNPPN20S3AkdSCIDINEOF2kmDaily';

module.exports = async function handler(req, res) {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ error: 'lat, lon 필요' });
  const q = `kd_490%5Blast-89:1:last%5D%5B0%5D%5B(${lat.toFixed(3)})%5D%5B(${lon.toFixed(3)})%5D`;
  const tried = [];
  for (const base of SERVERS) {
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const r = await fetch(`${base}/griddap/${DATASET}.csv?${q}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const lines = (await r.text()).trim().split('\n').slice(2);
      const days = [];
      let px = null;
      for (const l of lines) {
        const c = l.split(',');
        const kd = parseFloat(c[4]);
        if (!px) px = [parseFloat(c[2]), parseFloat(c[3])];
        days.push({ d: c[0].slice(0, 10), kd: isFinite(kd) ? +kd.toFixed(4) : null,
                    secchi: isFinite(kd) && kd > 0 ? +(1.7 / kd).toFixed(1) : null });
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
      return res.status(200).json({ ok: true, server: base, ms: Date.now() - t0, pixel: px, tried, days });
    } catch (e) {
      const cause = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
      tried.push({ server: base, ms: Date.now() - t0, error: String(e && e.message || e) + cause });
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(502).json({ ok: false, tried });
};
