// [ADD] "지구 바다에 실제 수온 색상 다시 넣기" 요청 반영 - Vercel 서버리스 함수.
// NOAA Coral Reef Watch CoralTemp(위성 합성 해수면온도, 5km, 매일 갱신, 약
// 2일 지연) 최신 하루치를 PacIOOS ERDDAP에서 1° 간격(360×180)으로 받아와
// 가벼운 JSON으로 바꿔 돌려줍니다. Vercel CDN이 6시간 캐시하므로 방문자가
// 많아도 원본 서버에는 거의 요청이 가지 않아요.
// [FIX] "바다에 색상이 안 입혀졌어" - 처음 쓴 NOAA CoastWatch 서버는 Vercel
// 서버에서 접속 자체가 실패("fetch failed")했어요. 브라우저·서버 양쪽에서
// 모두 잘 열리는 PacIOOS(하와이대) ERDDAP으로 바꿨습니다. 같은 NOAA 위성
// 수온 자료예요. 브라우저 쪽(js/live-data.js)에도 이 서버가 실패하면 원본에서
// 직접 받아오는 대체 경로가 있어서, 이 함수가 죽어도 색상은 나옵니다.
const ERDDAP_URL =
  'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km.csv' +
  '?CRW_SST%5B(last)%5D%5B0:20:3599%5D%5B0:20:7199%5D';

const W = 360, H = 180;          // 1° 격자
const LAT0 = 89.975, LON0 = -179.975; // 0행 = 북쪽 끝, 0열 = 서경 180°

// [ADD] 서버(Redis)에 저장해 두고 바로 돌려줘요. 6시간 지나면 새로 받고, 원본이 안 되면 저장본으로.
const { redisPipeline } = require('./_redis');
const KEY = 'sst:grid';
function sendGrid(res, body, tag) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  res.setHeader('X-Sst-Cache', tag);
  res.status(200).send(body);
}

module.exports = async function handler(req, res) {
  let saved = null;
  try { const [{ result }] = await redisPipeline([['GET', KEY]]); if (result) saved = JSON.parse(result); } catch (_) {}
  if (saved && Date.now() - saved.savedAt < 6 * 3600e3 && req.query.refresh !== '1') return sendGrid(res, saved.body, 'redis');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const r = await fetch(ERDDAP_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('ERDDAP HTTP ' + r.status);
    const text = await r.text();

    const v = new Array(W * H).fill(null); // 수온×10 정수, 육지/결측은 null
    let date = null;
    const lines = text.split('\n');
    // 1행: 변수명, 2행: 단위 → 3행부터 데이터 (time,latitude,longitude,CRW_SST)
    for (let i = 2; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 4) continue;
      const lat = parseFloat(cols[1]), lon = parseFloat(cols[2]), sst = parseFloat(cols[3]);
      if (!date) date = cols[0].slice(0, 10);
      if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(sst)) continue;
      const row = Math.round(LAT0 - lat), col = Math.round(lon - LON0);
      if (col < 0 || col >= W || row < 0 || row >= H) continue;
      v[row * W + col] = Math.round(sst * 10);
    }

    const body = JSON.stringify({
      source: 'NOAA Coral Reef Watch CoralTemp v3.1 (PacIOOS ERDDAP dhw_5km)',
      date, w: W, h: H, lat0: LAT0, lon0: LON0, scale: 0.1, v
    });
    if (v.filter(x => x != null).length > 20000) {
      try { await redisPipeline([['SET', KEY, JSON.stringify({ savedAt: Date.now(), body }), 'EX', String(10 * 86400)]]); } catch (_) {}
    }
    return sendGrid(res, body, 'erddap');
  } catch (e) {
    if (saved) return sendGrid(res, saved.body, 'redis-stale'); // 원본이 안 되면 저장본(며칠 지난 것)이라도

    res.setHeader('Cache-Control', 'no-store');
    const cause = e && e.cause ? ' (' + (e.cause.code || e.cause.message || e.cause) + ')' : '';
    res.status(502).json({ error: String(e && e.message || e) + cause });
  }
};
