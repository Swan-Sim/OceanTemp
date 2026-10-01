// [ADD] "어느 지역에서 어느 시간에 사람들이 얼마나 접속하는지" 통계 수집.
// 방문(페이지 열기) 한 번 = 날짜·시간(UTC)·국가·도시별 숫자를 1씩 올립니다.
// IP나 기기 정보 같은 개인정보는 저장하지 않아요. 국가/도시는 Vercel이
// 요청에 붙여주는 대략적인 위치 정보(x-vercel-ip-*)를 씁니다.
// ?e=station&s=정점명 으로 부르면 "정점 클릭 수"를 올립니다.
const { redisPipeline } = require('./_redis');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);          // UTC 날짜
    const hour = String(now.getUTCHours());               // UTC 시(0~23)
    const q = req.query || {};
    const cmds = [];
    if (q.e === 'donate') {
      cmds.push(['HINCRBY', `ev:${day}`, 'donate_click', 1]); // [ADD] 후원 버튼 클릭 수
    } else if (q.e === 'station' && q.s) {
      const name = String(q.s).slice(0, 120);
      cmds.push(['HINCRBY', `st:${day}`, name, 1]);
    } else {
      const country = req.headers['x-vercel-ip-country'] || '??';
      let city = req.headers['x-vercel-ip-city'] || '';
      try { city = decodeURIComponent(city); } catch (_) {}
      cmds.push(['HINCRBY', `v:h:${day}`, hour, 1]);
      cmds.push(['HINCRBY', `v:c:${day}`, country, 1]);
      cmds.push(['HINCRBY', `v:ct:${day}`, `${country}|${city || '?'}`, 1]);
    }
    await redisPipeline(cmds);
    res.status(204).end();
  } catch (e) {
    // 통계가 실패해도 사이트에는 아무 영향이 없게 조용히 끝냅니다
    res.status(204).end();
  }
};
