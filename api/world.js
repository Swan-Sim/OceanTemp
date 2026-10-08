// [ADD] 서버 함수 개수(Vercel 무료 12개 한도)를 줄이려고 NOAA·수온(sst)·시야·접속통계(track)를 한 함수로 합쳤어요.
// 기존 주소(/api/noaa 등)는 vercel.json rewrites가 이 함수로 이어 줘요. 실제 동작은 api/_noaa.js 등 각 파일에 그대로 있어요.
// 주의: require 경로는 글자 그대로 적어야 Vercel이 그 파일을 배포에 포함해요.
const H = {
  noaa: () => require('./_noaa'),
  sst: () => require('./_sst'),
  visibility: () => require('./_visibility'),
  track: () => require('./_track')
};
module.exports = async function handler(req, res) {
  const k = String((req.query || {})._h || '');
  if (!H[k]) return res.status(404).json({ ok: false, error: 'unknown' });
  try {
    return await H[k]()(req, res);
  } catch (e) { // 함수가 통째로 죽지 않고 원인이 화면에 보이게
    console.error('[world]', k, e && e.stack || e);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: String(e && e.message || e).slice(0, 300), where: k });
  }
};
