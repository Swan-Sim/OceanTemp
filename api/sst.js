// [ADD] "지구 바다에 실제 수온 색상 다시 넣기" 요청 반영 - Vercel 서버리스 함수.
// NOAA OISST v2.1(위성+부이 합성, 매일 갱신, 약 2일 지연) 최신 하루치를
// NOAA CoastWatch ERDDAP에서 1° 간격(360×180)으로 받아와 가벼운 JSON으로
// 바꿔 돌려줍니다. ERDDAP은 CORS 헤더가 없어서 브라우저(WebGL)가 직접
// 못 쓰기 때문에, 같은 도메인(/api/sst)에서 대신 받아다 주는 역할이에요.
// Vercel CDN이 6시간 캐시하므로 방문자가 많아도 NOAA에는 거의 요청이 안 갑니다.
const ERDDAP_URL =
  'https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21NrtAgg_LonPM180.csv' +
  '?sst%5B(last)%5D%5B(0.0)%5D%5B(-89.875):4:(89.875)%5D%5B(-179.875):4:(179.875)%5D';

const W = 360, H = 180; // 경도 -179.875부터 1°씩 360칸, 위도 -89.875부터 1°씩 180칸

module.exports = async function handler(req, res) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const r = await fetch(ERDDAP_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('ERDDAP HTTP ' + r.status);
    const text = await r.text();

    // 수온×10 정수 배열(북쪽 위도부터 한 줄씩), 육지/결측은 null
    const v = new Array(W * H).fill(null);
    let date = null;
    const lines = text.split('\n');
    // 1행: 변수명, 2행: 단위 → 3행부터 데이터 (time,zlev,latitude,longitude,sst)
    for (let i = 2; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 5) continue;
      const lat = parseFloat(cols[2]);
      const lon = parseFloat(cols[3]);
      const sst = parseFloat(cols[4]);
      if (!date) date = cols[0].slice(0, 10);
      if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(sst)) continue;
      const col = Math.round(lon + 179.875);
      const row = Math.round(89.875 - lat); // 0 = 북쪽 끝
      if (col < 0 || col >= W || row < 0 || row >= H) continue;
      v[row * W + col] = Math.round(sst * 10);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).send(JSON.stringify({
      source: 'NOAA OISST v2.1 NRT (ERDDAP ncdcOisst21NrtAgg)', date, w: W, h: H, scale: 0.1, v
    }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e && e.message || e) });
  }
};
