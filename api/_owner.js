// [ADD] 샵·리브어보드·풀장 소유자(회원 계정) 연결
//  - shop.owner = 회원 uid (샵 JSON 안에 저장)
//  - 처음 로그인한 회원의 이메일(구글·카카오 등에서 확인된 주소)이 샵 등록 이메일과 같으면 "이 샵의 주인인가요?" 물어보고 연결
//  - 주인이 없는 샵은 지도에서 "소유권 주장" → 관리자가 승인(shopclaim:v1)
//  - 주인은 계정 창에서 "정보 수정"을 누르면 하루짜리 수정 링크를 받아요(shopotk:{hash} → 's:id')
const S = require('./_store');
const { K, R } = S;
const CLAIM = 'shopclaim:v1';
const OTK_SEC = 86400;

const brief = (s) => ({ id: String(s.id), name: s.name || '', type: S.shopType(s.type) });

// 회원 정보 창용: 내가 주인인 샵 + 이메일이 같아서 물어볼 샵
async function forUser(uid, user) {
  const shops = Object.values(await S.hgetallJSON(K.shops));
  const owned = shops.filter(s => s.owner === uid).map(brief);
  const mail = user && user.email ? String(user.email).toLowerCase() : '';
  const skip = new Set((user && user.ownSkip) || []);
  const suggest = mail ? shops.filter(s => !s.owner && s.email && String(s.email).toLowerCase() === mail && !skip.has(String(s.id))).map(brief) : [];
  return { owned, ownSuggest: suggest };
}

async function getShop(id) { const [raw] = await R(['HGET', K.shops, String(id)]); return raw ? JSON.parse(raw) : null; }
async function saveShop(s) { await R(['HSET', K.shops, String(s.id), JSON.stringify(s)]); }

// 회원 쪽 동작(로그인 확인 뒤 api/_auth.js가 부름) → 처리했으면 true
async function userAction(a, b, uid, user, json, base, notify) {
  if (a === 'ownAccept' || a === 'ownSkip') {
    const s = await getShop(b.id); if (!s) { json(404, { ok: false, error: 'no_shop' }); return true; }
    const mail = user.email ? String(user.email).toLowerCase() : '';
    if (a === 'ownSkip') { user.ownSkip = [...new Set([...(user.ownSkip || []), String(s.id)])].slice(-50); await R(['HSET', 'users:v1', uid, JSON.stringify(user)]); json(200, { ok: true }); return true; }
    if (s.owner) { json(400, { ok: false, error: 'has_owner' }); return true; }
    if (!mail || !s.email || String(s.email).toLowerCase() !== mail) { json(403, { ok: false, error: 'email_mismatch' }); return true; }
    s.owner = uid; s.ownerAt = Date.now(); s.ownerBy = 'email'; await saveShop(s);
    json(200, { ok: true, shop: brief(s) }); return true;
  }
  if (a === 'ownClaim') {
    const s = await getShop(b.id); if (!s) { json(404, { ok: false, error: 'no_shop' }); return true; }
    if (s.owner === uid) { json(200, { ok: true, already: true }); return true; }
    if (s.owner) { json(400, { ok: false, error: 'has_owner' }); return true; }
    const id = `${s.id}_${uid}`;
    const [had] = await R(['HEXISTS', CLAIM, id]);
    await R(['HSET', CLAIM, id, JSON.stringify({ id, shopId: String(s.id), shopName: s.name, uid, userName: user.name || '', userEmail: user.email || '', msg: S.str(b.msg, 500), contact: S.str(b.contact, 120), at: Date.now() })]);
    if (!had && notify) await notify(`[otemp] 샵 소유권 주장: ${s.name}`, `<p>${S.esc(s.name)} ← ${S.esc(user.name || '')} (${S.esc(user.email || '이메일 없음')})</p><p>${S.esc(S.str(b.msg, 500))}</p><p><a href="${base}/admin/#shops">관리 페이지에서 확인</a></p>`);
    json(200, { ok: true }); return true;
  }
  if (a === 'ownEdit') {
    const s = await getShop(b.id); if (!s || s.owner !== uid) { json(403, { ok: false, error: 'not_owner' }); return true; }
    const { token, hash } = S.newToken();
    await R(['SET', 'shopotk:' + hash, 's:' + s.id, 'EX', String(OTK_SEC)]);
    json(200, { ok: true, url: S.editUrl(base, token) }); return true;
  }
  return false;
}

// 관리자 동작(api/_admin.js) → 처리했으면 true
async function adminAction(svc, b, ok, bad) {
  if (svc === 'ownerSet') { // { shopId 또는 q(샵 번호·이름 일부), uid('' = 해제) }
    let s = b.shopId ? await getShop(b.shopId) : null;
    if (!s && b.q) { const q = String(b.q).trim().toLowerCase(), all = Object.values(await S.hgetallJSON(K.shops));
      const hit = all.filter(x => String(x.id) === q || (x.name || '').toLowerCase() === q); const part = hit.length ? hit : all.filter(x => (x.name || '').toLowerCase().includes(q));
      if (part.length > 1) { bad('여러 곳: ' + part.slice(0, 8).map(x => `#${x.id} ${x.name}`).join(', ')); return true; }
      s = part[0] || null; }
    if (!s) { bad('no_shop'); return true; }
    const uid = S.str(b.uid, 40);
    if (uid) { const [u] = await R(['HGET', 'users:v1', uid]); if (!u) { bad('no_user'); return true; } s.owner = uid; s.ownerAt = Date.now(); s.ownerBy = 'admin'; }
    else { delete s.owner; delete s.ownerAt; delete s.ownerBy; }
    await saveShop(s); ok({ shop: brief(s) }); return true;
  }
  if (svc === 'claims') { ok({ claims: Object.values(await S.hgetallJSON(CLAIM)).sort((x, y) => y.at - x.at) }); return true; }
  if (svc === 'claimApprove' || svc === 'claimReject') {
    const [raw] = await R(['HGET', CLAIM, String(b.id)]); if (!raw) { bad('no_claim'); return true; }
    const c = JSON.parse(raw);
    if (svc === 'claimApprove') { const s = await getShop(c.shopId); if (!s) { await R(['HDEL', CLAIM, c.id]); bad('no_shop'); return true; }
      s.owner = c.uid; s.ownerAt = Date.now(); s.ownerBy = 'claim'; await saveShop(s);
      // 같은 샵의 다른 주장은 정리
      const all = await S.hgetallJSON(CLAIM); const del = Object.values(all).filter(x => x.shopId === c.shopId).map(x => x.id);
      if (del.length) await R(['HDEL', CLAIM, ...del]); }
    else await R(['HDEL', CLAIM, c.id]);
    ok(); return true;
  }
  return false;
}

// 수정 링크 확인(api/shops.js lookupToken)에서 하루짜리 소유자 링크도 받기
async function otkLookup(hash) { const [v] = await R(['GET', 'shopotk:' + hash]); return v || null; }

module.exports = { forUser, userAction, adminAction, otkLookup, CLAIM };
