// [ADD] /admin 페이지가 부르는 통계 조회 API. 비밀번호(ADMIN_PASSWORD 환경변수)가
// 맞아야만 데이터를 돌려줍니다. 비밀번호는 코드에 없고 Vercel 설정에만 있어요.
const crypto = require('crypto');
const { redisPipeline } = require('./_redis');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function toObj(arr) { // HGETALL 결과 [k1, v1, k2, v2 ...] → { k1: v1 }
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) o[arr[i]] = +arr[i + 1];
  return o;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const pw = req.headers['x-admin-password'] || '';
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD 환경변수가 설정되지 않았어요' });
  if (!safeEqual(pw, process.env.ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 600)); // 무작위 대입 속도 늦추기
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const days = Math.max(1, Math.min(90, parseInt((req.query || {}).days, 10) || 14));
    // 시간대 변환 때문에 앞뒤로 하루씩 더 가져옵니다(화면에서 내 시간대로 다시 나눔)
    const dates = [];
    for (let i = -1; i <= days; i++) {
      const d = new Date(Date.now() - i * 86400000);
      dates.push(d.toISOString().slice(0, 10));
    }
    const cmds = [];
    dates.forEach(d => {
      cmds.push(['HGETALL', `v:h:${d}`], ['HGETALL', `v:c:${d}`], ['HGETALL', `v:ct:${d}`], ['HGETALL', `st:${d}`], ['HGETALL', `sc:${d}`]);
    });
    const out = await redisPipeline(cmds);
    const data = dates.map((d, i) => ({
      date: d,
      hours: toObj(out[i * 5].result),
      countries: toObj(out[i * 5 + 1].result),
      cities: toObj(out[i * 5 + 2].result),
      stations: toObj(out[i * 5 + 3].result),
      shops: toObj(out[i * 5 + 4].result) // [ADD] 다이빙샵 연락 버튼 클릭 "샵id|종류"
    }));
    res.status(200).json({ days, data });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
