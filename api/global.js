// [ADD] 서버 함수 개수 줄이기: NOAA·수온(sst)·시야·접속통계(track)를 한 함수로 합쳤어요.
// 주소는 그대로(/api/noaa, /api/sst, /api/visibility, /api/track)이고 vercel.json rewrites가 이어 줘요.
const H = { noaa: './_noaa', sst: './_sst', visibility: './_visibility', track: './_track' };
module.exports = async function handler(req, res) {
  const k = String((req.query || {})._h || '');
  if (!H[k]) return res.status(404).json({ ok: false, error: 'unknown' });
  return require(H[k])(req, res);
};
