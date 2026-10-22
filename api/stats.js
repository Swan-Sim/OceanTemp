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
  const S = require('./_store');
  // [ADD] 관리자 권한이 있는 회원이 로그인한 상태면 비밀번호 없이도 통과
  let viaSession = false;
  try { viaSession = await require('./_auth').isAdminReq(req); } catch (_) {}
  if (!viaSession && !process.env.ADMIN_PASSWORD && !(await S.adminCfg()).pwHash) return res.status(500).json({ error: 'ADMIN_PASSWORD 환경변수가 설정되지 않았어요' });
  if (!viaSession && !(await S.checkAdminPw(pw))) { // [CHANGE] 관리 페이지에서 바꾼 비밀번호(있으면) 우선
    await new Promise(r => setTimeout(r, 600)); // 무작위 대입 속도 늦추기
    return res.status(401).json({ error: 'unauthorized' });
  }
  // [ADD] 샵·정점 관리(승인/거절/수정) - POST /api/stats?svc=...
  if ((req.query || {}).svc) {
    try { return await require('./_admin')(req, res); }
    catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  }
  try {
    const qd = String((req.query || {}).days || '');
    const all = qd === 'all'; // [ADD] 누적: 지난 날들은 all:* 해시에 합쳐 두고(하루 한 번), 오늘(과 아직 안 합친 날)만 날짜별로 더해요
    const days = all ? 0 : Math.max(1, Math.min(90, parseInt(qd, 10) || 14));
    const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
    const KEYS = ['v:h', 'v:c', 'v:ct', 'st', 'sc', 'b:h', 'b:c', 'b:ct', 'b:n', 'pg', 'b:pn', 'sr'];
    const N = KEYS.length;
    const dayCmds = (d) => KEYS.map(k => ['HGETALL', `${k}:${d}`]);
    let dates = [], extra = [];
    if (all) {
      // 어제까지 아직 안 합친 날을 all:* 에 합쳐요(처음엔 최대 120일 거슬러 올라가요)
      const [[upto], [from]] = await redisPipeline([['GET', 'all:upto'], ['GET', 'all:from']]).then(r => r.map(x => [x.result]));
      const yday = dayStr(Date.now() - 86400000);
      let start = upto ? dayStr(Date.parse(upto + 'T00:00:00Z') + 86400000) : dayStr(Date.now() - 120 * 86400000);
      const pend = []; for (let t = Date.parse(start + 'T00:00:00Z'); dayStr(t) <= yday; t += 86400000) pend.push(dayStr(t));
      if (pend.length) {
        const raw = await redisPipeline(pend.flatMap(dayCmds));
        const inc = []; let first = from || '';
        pend.forEach((d, di) => { let any = false; KEYS.forEach((k, ki) => { const o = toObj(raw[di * N + ki].result); Object.entries(o).forEach(([f, n]) => { if (n) { any = true; inc.push(['HINCRBY', `all:${k}`, f, String(n)]); } }); }); if (any && !first) first = d; });
        if (first && first !== from) inc.push(['SET', 'all:from', first]);
        inc.push(['SET', 'all:upto', yday]);
        for (let i = 0; i < inc.length; i += 400) await redisPipeline(inc.slice(i, i + 400)); // 너무 긴 파이프라인은 나눠서
      }
      dates = [dayStr(Date.now())]; // 오늘은 날짜별로
      const outAll = await redisPipeline([...KEYS.map(k => ['HGETALL', `all:${k}`]), ['GET', 'all:from']]);
      extra = [Object.assign({ date: 'all', from: outAll[N].result || null }, Object.fromEntries(['hours', 'countries', 'cities', 'stations', 'shops', 'botHours', 'botCountries', 'botCities', 'botNames', 'pages', 'botPages', 'search'].map((f, i) => [f, toObj(outAll[i].result)])))];
    } else {
      // 시간대 변환 때문에 앞뒤로 하루씩 더 가져옵니다(화면에서 내 시간대로 다시 나눔)
      for (let i = -1; i <= days; i++) dates.push(dayStr(Date.now() - i * 86400000));
    }
    const cmds = dates.flatMap(dayCmds);
    const out = await redisPipeline(cmds);
    const data = extra.concat(dates.map((d, i) => ({
      date: d,
      hours: toObj(out[i * N].result),
      countries: toObj(out[i * N + 1].result),
      cities: toObj(out[i * N + 2].result),
      stations: toObj(out[i * N + 3].result),
      shops: toObj(out[i * N + 4].result), // [ADD] 다이빙샵 연락 버튼 클릭 "샵id|종류"
      botHours: toObj(out[i * N + 5].result),     // "s|시" → 수
      botCountries: toObj(out[i * N + 6].result), // "s|KR"
      botCities: toObj(out[i * N + 7].result),    // "s|KR|Seoul"
      botNames: toObj(out[i * N + 8].result),     // "구글" (앱·포인트 페이지 합계)
      pages: toObj(out[i * N + 9].result),        // 포인트 페이지 사람 조회 { 번호: 수 }
      botPages: toObj(out[i * N + 10].result),    // 포인트 페이지 봇 수집 { "s|번호": 수 }
      search: toObj(out[i * N + 11].result)       // 검색 결과에서 들어온 사람 { google: 수 }
    })));
    res.status(200).json({ days: all ? 'all' : days, data });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
