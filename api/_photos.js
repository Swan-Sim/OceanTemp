// [ADD] 로그북 사진 - Cloudflare R2에 두 장씩 저장(작은 썸네일 _t, 인스타그램용 큰 사진 _b).
//  R2 키: lph/{회원id}/{사진id}_t | _b   ·  Redis: lphoto:own(사진id→회원id, 모든 사진) · lphoto:pub(사진id→{no,at}, 지도에 공개한 사진만)
//  사진은 기록(ulog)의 photos(id 목록)·pub(공개 여부)에 연결돼요. 기록을 지우거나 사진을 빼면 R2에서도 지워요.
const R2 = require('./_r2');
const ID = /^[0-9a-f]{16}$/;
const MAX_PHOTOS = 4, MAX_T = 90 * 1024, MAX_B = 900 * 1024, DAY_LIMIT = 60;
const isJpeg = (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
const b64 = (s) => Buffer.from(String(s || '').replace(/^data:[^,]*,/, ''), 'base64');

// 올리기: { t: 썸네일 JPEG(base64), b: 큰 사진 JPEG(base64) } → { id }
async function upload(b, uid, R, json) {
  if (!R2.on) { json(503, { ok: false, error: 'storage_off' }); return true; }
  const t = b64(b.t), big = b64(b.b);
  if (!isJpeg(t) || !isJpeg(big)) { json(400, { ok: false, error: 'bad_image' }); return true; }
  if (t.length > MAX_T || big.length > MAX_B) { json(413, { ok: false, error: 'too_big' }); return true; }
  const k = 'lphoto:day:' + uid, [n] = await R(['INCR', k]); if (n === 1) await R(['EXPIRE', k, '86400']);
  if (n > DAY_LIMIT) { json(429, { ok: false, error: 'daily_limit' }); return true; }
  const id = require('crypto').randomBytes(8).toString('hex');
  await R2.putBin(`lph/${uid}/${id}_t`, t, 'image/jpeg'); await R2.putBin(`lph/${uid}/${id}_b`, big, 'image/jpeg');
  await R(['HSET', 'lphoto:own', id, uid]);
  json(200, { ok: true, id }); return true;
}
// 기록에 붙일 사진 id 중 내 것만, 최대 4장
async function owned(R, uid, ids) {
  ids = (Array.isArray(ids) ? ids : []).map(String).filter(x => ID.test(x)).filter((x, i, a) => a.indexOf(x) === i).slice(0, MAX_PHOTOS);
  if (!ids.length) return [];
  const res = await R(...ids.map(i => ['HGET', 'lphoto:own', i]));
  return ids.filter((_, i) => res[i] === uid);
}
// 기록 저장·삭제 뒤: 빠진 사진 지우기 + 공개 목록 맞추기 (oldE/newE: 기록, 없으면 null)
async function sync(R, uid, oldE, newE) {
  const o = (oldE && oldE.photos) || [], n = (newE && newE.photos) || [], cmds = [];
  for (const id of o) if (!n.includes(id)) { cmds.push(['HDEL', 'lphoto:own', id], ['HDEL', 'lphoto:pub', id]); try { await R2.del(`lph/${uid}/${id}_t`); await R2.del(`lph/${uid}/${id}_b`); } catch (_) {} }
  for (const id of n) cmds.push(newE.pub ? ['HSET', 'lphoto:pub', id, JSON.stringify({ no: newE.no, at: Date.now() })] : ['HDEL', 'lphoto:pub', id]);
  if (cmds.length) await R(...cmds);
}
// 보여주기: ?id=..&s=t|b - 공개 사진은 누구나, 비공개는 주인·관리자만
async function serve(req, res, R) {
  const q = req.query || {}, id = ID.test(String(q.id)) ? String(q.id) : '', s = q.s === 'b' ? 'b' : 't';
  const nf = () => { res.setHeader('Cache-Control', 'no-store'); return res.status(404).end(); };
  if (!id || !R2.on) return nf();
  const [own, pub] = await R(['HGET', 'lphoto:own', id], ['HGET', 'lphoto:pub', id]);
  if (!own) return nf();
  let priv = false;
  if (!pub) {
    const A = require('./_auth'), su = await A.sessionUid(req);
    if (!su || (su !== own && !(await A.isAdminReq(req)))) return nf();
    priv = true;
  }
  const o = await R2.getBin(`lph/${own}/${id}_${s}`); if (!o) return nf();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', priv ? 'private, max-age=3600' : 'public, max-age=86400, s-maxage=86400');
  return res.status(200).end(o.buf);
}
// 지도용 공개 목록: { 포인트번호: { id(가장 최근), n(장수) } }
async function index(R) {
  const [arr] = await R(['HGETALL', 'lphoto:pub']), spots = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) { let v; try { v = JSON.parse(arr[i + 1]); } catch (_) { continue; } if (!v || !v.no) continue;
    const c = spots[v.no] || (spots[v.no] = { id: arr[i], at: v.at || 0, n: 0 }); c.n++; if ((v.at || 0) > c.at) { c.id = arr[i]; c.at = v.at || 0; } }
  return spots;
}
// 관리자: 공개 사진 지우기(부적절한 사진). 기록에 남은 id는 보이지 않게만 돼요.
async function adminDel(R, id) {
  if (!ID.test(String(id))) return false;
  const [own] = await R(['HGET', 'lphoto:own', id]); if (!own) return false;
  await R(['HDEL', 'lphoto:own', id], ['HDEL', 'lphoto:pub', id]);
  try { await R2.del(`lph/${own}/${id}_t`); await R2.del(`lph/${own}/${id}_b`); } catch (_) {}
  return true;
}
module.exports = { upload, owned, sync, serve, index, adminDel, MAX_PHOTOS };
