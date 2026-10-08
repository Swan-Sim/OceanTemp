// [ADD] 간편 로그인(구글·카카오·네이버·메타) + 계정 + 즐겨찾기. api/shops.js가 svc=auth일 때 불러요
//  (Vercel 무료 요금제는 서버 함수가 12개까지라 새 파일을 api/ 바로 아래 함수로 만들지 않고 여기서 처리).
//
//  주소(vercel.json rewrites)
//    /auth/start/:p      로그인 시작 → 각 회사 로그인 화면으로 이동        (p = google | kakao | naver | facebook)
//    /auth/callback/:p   로그인 끝나고 돌아오는 주소(각 회사 개발자 콘솔에 "Redirect URI"로 등록)
//    /auth/fb-delete     메타 "데이터 삭제 요청" 콜백(메타 앱 설정에 등록)
//  API
//    GET  /api/shops?svc=auth&a=me                내 정보 + 즐겨찾기 + 켜진 로그인 종류
//    POST /api/shops?svc=auth&a=logout
//    POST /api/shops?svc=auth&a=fav     {no, on}  즐겨찾기 넣기/빼기(포인트 번호)
//    POST /api/shops?svc=auth&a=delete            회원 탈퇴(계정·즐겨찾기·로그인 기록 모두 삭제)
//
//  Vercel 환경변수(있는 것만 버튼이 보여요)
//    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
//    KAKAO_REST_KEY / KAKAO_CLIENT_SECRET(선택: 카카오 콘솔에서 Client Secret을 켰을 때만)
//    NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
//    META_APP_ID / META_APP_SECRET
//
//  Redis 키
//    users:v1            해시 { uid: JSON }   이름·사진·이메일(받은 경우)·연결된 로그인
//    uidx:v1             해시 { "google:123": uid }
//    sess:{토큰해시}      uid (60일)         쿠키 원문은 저장하지 않고 해시만
//    usess:{uid}         세트 { 토큰해시 }   탈퇴·전체 로그아웃용
//    ufav:{uid}          세트 { 포인트 번호 }
const crypto = require('crypto');
const S = require('./_store');
const { R } = S;

const SESSION_DAYS = 60;
const PROVIDERS = {
  google: {
    on: () => process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    authUrl: (cb, state) => 'https://accounts.google.com/o/oauth2/v2/auth?' + qs({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: cb, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' }),
    async profile(code, cb) {
      const tok = await postForm('https://oauth2.googleapis.com/token', { code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: cb, grant_type: 'authorization_code' });
      const u = await getJson('https://openidconnect.googleapis.com/v1/userinfo', tok.access_token);
      return { sub: u.sub, name: u.name, email: u.email_verified ? u.email : '', avatar: u.picture };
    }
  },
  kakao: {
    on: () => process.env.KAKAO_REST_KEY,
    authUrl: (cb, state) => 'https://kauth.kakao.com/oauth/authorize?' + qs({ client_id: process.env.KAKAO_REST_KEY, redirect_uri: cb, response_type: 'code', state }),
    async profile(code, cb) {
      const tok = await postForm('https://kauth.kakao.com/oauth/token', { grant_type: 'authorization_code', client_id: process.env.KAKAO_REST_KEY, redirect_uri: cb, code, ...(process.env.KAKAO_CLIENT_SECRET ? { client_secret: process.env.KAKAO_CLIENT_SECRET } : {}) });
      const u = await getJson('https://kapi.kakao.com/v2/user/me', tok.access_token);
      const a = u.kakao_account || {}, p = a.profile || {};
      return { sub: u.id, name: p.nickname, email: a.is_email_verified ? a.email : '', avatar: p.thumbnail_image_url || p.profile_image_url };
    }
  },
  naver: {
    on: () => process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET,
    authUrl: (cb, state) => 'https://nid.naver.com/oauth2.0/authorize?' + qs({ response_type: 'code', client_id: process.env.NAVER_CLIENT_ID, redirect_uri: cb, state }),
    async profile(code, cb, state) {
      const tok = await postForm('https://nid.naver.com/oauth2.0/token', { grant_type: 'authorization_code', client_id: process.env.NAVER_CLIENT_ID, client_secret: process.env.NAVER_CLIENT_SECRET, code, state });
      const u = (await getJson('https://openapi.naver.com/v1/nid/me', tok.access_token)).response || {};
      return { sub: u.id, name: u.nickname || u.name, email: u.email || '', avatar: u.profile_image };
    }
  },
  facebook: {
    on: () => process.env.META_APP_ID && process.env.META_APP_SECRET,
    authUrl: (cb, state) => 'https://www.facebook.com/dialog/oauth?' + qs({ client_id: process.env.META_APP_ID, redirect_uri: cb, state, scope: 'public_profile,email', response_type: 'code' }),
    async profile(code, cb) {
      const tok = await getJson('https://graph.facebook.com/oauth/access_token?' + qs({ client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, redirect_uri: cb, code }));
      const u = await getJson('https://graph.facebook.com/me?' + qs({ fields: 'id,name,email,picture.type(normal)', access_token: tok.access_token }));
      return { sub: u.id, name: u.name, email: u.email || '', avatar: u.picture && u.picture.data && !u.picture.data.is_silhouette ? u.picture.data.url : '' };
    }
  }
};

const qs = (o) => new URLSearchParams(o).toString();
async function fetchJson(url, opt) {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), 10000);
  try {
    const r = await fetch(url, { ...opt, signal: c.signal });
    const text = await r.text(); let j; try { j = JSON.parse(text); } catch (_) { throw new Error(`HTTP ${r.status}`); }
    if (!r.ok || j.error) throw new Error(`HTTP ${r.status} ${j.error_code || ''} ${typeof j.error === 'string' ? j.error : ''} ${String(j.error_description || (j.error && j.error.message) || '').slice(0, 80)}`);
    return j;
  } finally { clearTimeout(tm); }
}
const postForm = (url, body) => fetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: qs(body) });
const getJson = (url, bearer) => fetchJson(url, bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {});

// ── 쿠키 ──
function cookies(req) { const o = {}; String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
const cookie = (name, val, maxAge) => `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const baseOf = (req) => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
const cbUrl = (req, p) => `${baseOf(req)}/auth/callback/${p}`;
// 로그인 후 돌아갈 곳: 같은 사이트 안의 경로만
const safeNext = (v) => { v = String(v || '/'); return /^\/(?!\/)[^\s\\]*$/.test(v) ? v.slice(0, 300) : '/'; };

async function sessionUid(req) {
  const t = cookies(req).ot_s; if (!t || t.length < 20) return null;
  try { const [uid] = await R(['GET', 'sess:' + sha(t)]); return uid || null; } catch (_) { return null; }
}
async function getUser(uid) { const [raw] = await R(['HGET', 'users:v1', uid]); try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; } }
const publicUser = (u) => u && { id: u.id, name: u.name || '', avatar: u.avatar || '', providers: (u.logins || []).map(l => l.p), created: u.created };

async function deleteUser(uid) {
  const u = await getUser(uid);
  const [sessions] = await R(['SMEMBERS', 'usess:' + uid]);
  const cmds = [['HDEL', 'users:v1', uid], ['DEL', 'ufav:' + uid, 'usess:' + uid]];
  (sessions || []).forEach(h => cmds.push(['DEL', 'sess:' + h]));
  ((u && u.logins) || []).forEach(l => cmds.push(['HDEL', 'uidx:v1', `${l.p}:${l.sub}`]));
  await R(...cmds);
}

// 메타 signed_request 확인(데이터 삭제 콜백)
function parseSignedRequest(sr) {
  const [sig, payload] = String(sr || '').split('.'); if (!sig || !payload) return null;
  const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const expect = crypto.createHmac('sha256', process.env.META_APP_SECRET || '').update(payload).digest();
  const got = b64(sig); if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
  try { return JSON.parse(b64(payload).toString('utf8')); } catch (_) { return null; }
}

const bodyOf = (req) => { let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } return b || {}; };
// 다른 사이트에서 몰래 보내는 POST 막기(쿠키 SameSite=Lax와 함께)
const sameOrigin = (req) => { const o = req.headers.origin; return !o || o === baseOf(req); };

module.exports = async function auth(req, res) {
  const q = req.query || {}, a = String(q.a || ''), p = String(q.p || '');
  res.setHeader('Cache-Control', 'no-store');
  const json = (code, o) => res.status(code).json(o);
  const back = (path, err) => { res.statusCode = 302; res.setHeader('Location', err ? `${path}${path.includes('?') ? '&' : '?'}login_error=${encodeURIComponent(err)}` : path); return res.end(); };

  if (a === 'start') {
    const P = PROVIDERS[p]; if (!P || !P.on()) return back('/', 'provider_off');
    const state = crypto.randomBytes(18).toString('base64url');
    res.setHeader('Set-Cookie', cookie('ot_st', `${state}|${p}|${safeNext(q.next)}`, 600));
    return back(P.authUrl(cbUrl(req, p), state));
  }

  if (a === 'cb') {
    const P = PROVIDERS[p]; const [state, sp, next0] = String(cookies(req).ot_st || '').split('|'); const next = safeNext(next0);
    res.setHeader('Set-Cookie', cookie('ot_st', '', 0));
    if (!P || !P.on()) return back(next, 'provider_off');
    if (q.error || !q.code) return back(next, 'cancelled'); // 사용자가 취소
    if (!state || state !== q.state || sp !== p) return back(next, 'state');
    let prof;
    try { prof = await P.profile(String(q.code), cbUrl(req, p), state); }
    catch (e) { console.error('[auth]', p, e.message);
      // [ADD] 원인 코드만 짧게 같이 돌려줘서(키·토큰 같은 값은 없음) 화면에 보여주기 - 예: KOE010(카카오 Client Secret 불일치), invalid_client
      // [CHANGE] 네이버처럼 오류인데도 HTTP 200으로 돌려주는 곳은 "HTTP200"만 보여서 원인을 알 수 없었어요 → 오류 이름·설명(키·토큰 없음)을 영문·숫자로 정리해 보여주기
      const msg = String(e.message), why = (msg.replace(/^HTTP \d{3}\s*/, '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || (msg.match(/HTTP \d{3}/) || [''])[0].replace(' ', ''));
      return back(next + (why ? (next.includes('?') ? '&' : '?') + 'login_why=' + encodeURIComponent(why) : ''), 'provider'); }
    if (!prof || !prof.sub) return back(next, 'provider');
    const key = `${p}:${prof.sub}`;
    const cur = await sessionUid(req); // 이미 로그인한 상태면 이 로그인을 같은 계정에 연결
    let [uid] = await R(['HGET', 'uidx:v1', key]);
    let user = uid ? await getUser(uid) : null;
    if (user && user.blocked) return back(next, 'blocked'); // [ADD] 차단된 계정은 합치기·로그인 모두 막기
    if (!user && cur) { uid = cur; user = await getUser(cur); }
    // [ADD] 이미 로그인한 상태에서 "다른 계정 연결"을 눌렀는데 그 로그인이 이미 다른 계정(예: 예전 카카오 계정)으로 있으면 → 두 계정을 하나로 합쳐요(즐겨찾기·연결된 로그인 모두)
    if (cur && uid && uid !== cur && user) {
      const curUser = await getUser(cur);
      if (curUser) {
        const [favs] = await R(['SMEMBERS', 'ufav:' + uid]);
        const [sess] = await R(['SMEMBERS', 'usess:' + uid]);
        (user.logins || []).forEach(l => { if (!curUser.logins.some(x => x.p === l.p && String(x.sub) === String(l.sub))) curUser.logins.push(l); });
        curUser.name = curUser.name || user.name; curUser.avatar = curUser.avatar || user.avatar; curUser.email = curUser.email || user.email;
        const cmds = [];
        if (favs && favs.length) cmds.push(['SADD', 'ufav:' + cur, ...favs.map(String)]);
        (user.logins || []).forEach(l => cmds.push(['HSET', 'uidx:v1', `${l.p}:${l.sub}`, cur]));
        (sess || []).forEach(h => cmds.push(['DEL', 'sess:' + h]));
        cmds.push(['HSET', 'users:v1', cur, JSON.stringify(curUser)], ['HDEL', 'users:v1', uid], ['DEL', 'ufav:' + uid, 'usess:' + uid]);
        await R(...cmds);
        uid = cur; user = curUser;
      }
    }
    const now = Date.now();
    if (user && user.blocked) return back(next, 'blocked'); // [ADD] 관리자가 차단한 계정
    if (!user) { uid = crypto.randomBytes(9).toString('base64url'); user = { id: uid, created: now, logins: [] }; }
    if (!user.logins.some(l => l.p === p && String(l.sub) === String(prof.sub))) user.logins.push({ p, sub: String(prof.sub), at: now });
    user.name = user.name || S.str(prof.name, 40) || '다이버';
    if (prof.avatar && /^https:\/\//.test(prof.avatar)) user.avatar = S.str(prof.avatar, 400);
    if (prof.email && !user.email) user.email = S.email(prof.email);
    user.last = now;
    const token = crypto.randomBytes(32).toString('base64url'), h = sha(token);
    await R(['HSET', 'users:v1', uid, JSON.stringify(user)], ['HSET', 'uidx:v1', key, uid],
      ['SET', 'sess:' + h, uid, 'EX', String(SESSION_DAYS * 86400)], ['SADD', 'usess:' + uid, h], ['EXPIRE', 'usess:' + uid, String(SESSION_DAYS * 86400)]);
    res.setHeader('Set-Cookie', [cookie('ot_st', '', 0), cookie('ot_s', token, SESSION_DAYS * 86400)]);
    return back(next);
  }

  if (a === 'me') {
    const on = Object.keys(PROVIDERS).filter(k => PROVIDERS[k].on());
    const uid = await sessionUid(req);
    const user = uid ? await getUser(uid) : null;
    if (!user) return json(200, { ok: true, user: null, providers: on });
    const [favs] = await R(['SMEMBERS', 'ufav:' + uid]);
    return json(200, { ok: true, user: publicUser(user), favs: (favs || []).map(Number).filter(Boolean), providers: on });
  }

  if (a === 'fbdelete' && req.method === 'POST') { // 메타 → 이 사용자 데이터 지워달라는 요청
    const b = typeof req.body === 'object' && req.body ? req.body : Object.fromEntries(new URLSearchParams(String(req.body || '')));
    const d = parseSignedRequest(b.signed_request); if (!d || !d.user_id) return json(400, { error: 'bad_request' });
    const [uid] = await R(['HGET', 'uidx:v1', `facebook:${d.user_id}`]);
    if (uid) await deleteUser(uid);
    const code = crypto.randomBytes(6).toString('hex');
    return json(200, { url: `${baseOf(req)}/privacy/?deleted=${code}`, confirmation_code: code });
  }

  if (req.method !== 'POST' || !sameOrigin(req)) return json(400, { ok: false, error: 'bad_request' });
  const uid = await sessionUid(req);
  if (!uid) return json(401, { ok: false, error: 'login_required' });
  const b = bodyOf(req);

  if (a === 'logout') {
    const t = cookies(req).ot_s, h = sha(t);
    await R(['DEL', 'sess:' + h], ['SREM', 'usess:' + uid, h]);
    res.setHeader('Set-Cookie', cookie('ot_s', '', 0));
    return json(200, { ok: true });
  }
  if (a === 'fav') {
    const no = parseInt(b.no, 10); if (!(no > 0 && no < 100000)) return json(400, { ok: false, error: 'bad_no' });
    if (b.on === false) await R(['SREM', 'ufav:' + uid, String(no)]);
    else { const [n] = await R(['SCARD', 'ufav:' + uid]); if (n >= 300) return json(400, { ok: false, error: 'too_many' }); await R(['SADD', 'ufav:' + uid, String(no)]); }
    return json(200, { ok: true });
  }
  if (a === 'delete') {
    await deleteUser(uid);
    res.setHeader('Set-Cookie', cookie('ot_s', '', 0));
    return json(200, { ok: true });
  }
  return json(400, { ok: false, error: 'unknown' });
};
