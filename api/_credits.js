// [ADD] 활동 크레딧과 레벨. 크레딧은 Redis 해시 ucred:v1 { uid: 숫자 } 에 따로 쌓아요(회원 정보 JSON과 분리 - 동시에 올라가도 안 꼬이게 HINCRBY 사용).
//  - 같은 활동은 하루 횟수 상한(cap)이 있어서 반복해서 눌러 크레딧을 모으는 걸 막아요.
//  - 레벨은 크레딧으로 계산해요(저장 안 함). 기준은 아래 LEVELS만 고치면 돼요.
//  - 레벨이 오르면 점점 더 많은 관리 권한을 나눠주려고 PERK_LEVEL에 "필요한 최소 레벨"을 적어 둬요(아직 쓰는 곳은 없고, 기능이 생길 때 can()으로 확인).
const LEVELS = [0, 20, 60, 150, 400, 1000]; // 레벨 1~6이 되는 최소 크레딧
const PERK_LEVEL = { reportReview: 4, photoModerate: 5, spotApprove: 6 };

// 적립표: 키 → { 크레딧, 하루 최대 횟수 }
const RULES = {
  login: { amount: 1, cap: 1 },      // 하루 첫 로그인
  fav: { amount: 1, cap: 5 },        // 처음 즐겨찾기하는 포인트(같은 포인트는 다시 안 쳐줘요)
  log: { amount: 3, cap: 2 },        // 로그북 새 기록(하루 2건까지)
  // 아래는 기능이 생기면 쓸 자리: photo(3, 3) · report(5, 3)
};

function info(credits) {
  const c = Math.max(0, Math.floor(+credits || 0));
  let level = 1; LEVELS.forEach((t, i) => { if (c >= t) level = i + 1; });
  return { credits: c, level, base: LEVELS[level - 1], next: level < LEVELS.length ? LEVELS[level] : null };
}

async function award(R, uid, key) {
  const rule = RULES[key]; if (!rule || !uid) return 0;
  const day = new Date().toISOString().slice(0, 10), k = `ucr:${uid}:${day}`;
  try {
    const [n] = await R(['HINCRBY', k, key, 1]);
    await R(['EXPIRE', k, '172800']);
    if (n > rule.cap) return 0;
    await R(['HINCRBY', 'ucred:v1', String(uid), rule.amount]);
    return rule.amount;
  } catch (_) { return 0; }
}

async function creditsOf(R, uid) { try { const [v] = await R(['HGET', 'ucred:v1', String(uid)]); return +v || 0; } catch (_) { return 0; } }
const can = (user, level, perk) => !!user && (user.role === 'admin' || (level >= (PERK_LEVEL[perk] || 99)));

module.exports = { LEVELS, PERK_LEVEL, RULES, info, award, creditsOf, can };
