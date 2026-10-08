// [ADD] 서버 함수 개수(Vercel 무료 12개 한도)를 줄이려고 한국 관측 자료 4개를 한 함수로 합쳤어요.
// 주소는 그대로(/api/khoa, /api/kma, /api/jmatide, /api/busanwq)이고 vercel.json rewrites가 이 함수로 이어 줘요.
// 실제 동작은 api/_khoa.js 등 각 파일에 그대로 있어요. (_h 는 이 함수 전용 구분값)
const H = { khoa: './_khoa', kma: './_kma', jmatide: './_jmatide', busanwq: './_busanwq' };
module.exports = async function handler(req, res) {
  const k = String((req.query || {})._h || '');
  if (!H[k]) return res.status(404).json({ ok: false, error: 'unknown' });
  return require(H[k])(req, res);
};
