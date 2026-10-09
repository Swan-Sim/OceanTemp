// [CHANGE] 다이빙샵(제휴) 공개 API - 샵 목록 + 샵 등록/수정 + 수정 링크 재발송 + 정점 등록 제안.
// 승인은 /admin(비밀번호)에서만 해요(api/stats.js). 데이터는 Upstash Redis(api/_store.js 참고).
//   GET  /api/shops                      사이트에 보일 샵(승인·만료 전·숨김 아님)
//   GET  /api/shops?svc=spots            승인된 사용자 등록 정점
//   GET  /api/shops?svc=click&id=&k=     연락 버튼 클릭 수 +1 (sendBeacon은 POST)
//   POST /api/shops?svc=register         새 샵 등록 요청 → 수정 전용 링크를 바로 돌려줌
//   POST /api/shops?svc=me      {t}      수정 링크로 내 샵 정보 불러오기
//   POST /api/shops?svc=edit    {t,...}  수정 요청(승인 후 반영)
//   POST /api/shops?svc=resend  {email}  등록 이메일로 새 수정 링크 보내기
//   POST /api/shops?svc=spot    {...}    새 정점(다이빙 포인트) 등록 요청
//   *    /api/shops?svc=auth&a=…          간편 로그인·계정·즐겨찾기 (api/_auth.js)
const crypto = require('crypto');
const S = require('./_store');
const { K, R } = S;

const KINDS = new Set(['tel', 'kakao', 'whatsapp', 'instagram', 'web', 'all', 'map']);

// 같은 사람이 너무 많이 보내지 못하게(IP는 그날의 해시로만 잠깐 셈, 원문 저장 안 함)
async function limited(req, name, max, sec) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const h = crypto.createHash('sha256').update(ip + new Date().toISOString().slice(0, 10) + (process.env.ADMIN_PASSWORD || '')).digest('hex').slice(0, 16);
  const key = `rl:${name}:${h}`;
  try { const [n] = await R(['INCR', key], ['EXPIRE', key, String(sec)]); return n > max; } catch (_) { return false; }
}
const bodyOf = (req) => { let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } return b || {}; };
const send = (res, code, obj) => { res.setHeader('Cache-Control', 'no-store'); res.status(code).json(obj); };

async function notifyAdmin(subject, html) {
  const to = await S.adminEmail(); // [CHANGE] 관리 페이지에서 바꾼 이메일 우선
  if (to) await S.sendMail(to, subject, html);
}

async function lookupToken(t) {
  if (!t || typeof t !== 'string' || t.length > 100) return null;
  const [v] = await R(['HGET', K.tok, S.sha(t)]);
  if (!v) return null;
  const [kind, id] = [v.slice(0, 1), v.slice(2)];
  return { kind, id, hash: S.sha(t) };
}

// [ADD] 샵 실적: 최근 N일, 이 샵이 걸린 포인트별 [포인트 조회 · 바로가기 노출 · 버튼 클릭(종류별)]
async function shopStats(s, days) {
  const id = String(s.id), spots = s.spots || [];
  const dates = [];
  const since = s.created ? new Date(s.created).toISOString().slice(0, 10) : '';
  for (let i = 0; i < days; i++) { const d = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10); if (since && d < since) break; dates.push(d); }
  const cmds = [];
  dates.forEach(d => { cmds.push(['HMGET', `sv:${d}`, ...spots.map(String)]); cmds.push(['HGETALL', `si:${d}`], ['HGETALL', `sc:${d}`]); });
  const out = cmds.length ? await R(...cmds) : [];
  const rows = Object.fromEntries(spots.map(n => [n, { no: n, views: 0, imp: 0, clicks: {} }]));
  const other = { no: 0, views: 0, imp: 0, clicks: {} }; // 포인트 정보 없이 기록된 예전 클릭
  for (let i = 0; i < dates.length; i++) {
    const sv = out[i * 3] || [], si = out[i * 3 + 1] || [], sc = out[i * 3 + 2] || [];
    spots.forEach((n, j) => { rows[n].views += +sv[j] || 0; });
    for (let k = 0; k < si.length; k += 2) { const [sid, no] = si[k].split('|'); if (sid === id && rows[no]) rows[no].imp += +si[k + 1] || 0; }
    for (let k = 0; k < sc.length; k += 2) {
      const [sid, kind, no] = sc[k].split('|'); if (sid !== id) continue;
      const r = (no && rows[no]) || other; r.clicks[kind] = (r.clicks[kind] || 0) + (+sc[k + 1] || 0);
    }
  }
  const list = Object.values(rows);
  if (Object.keys(other.clicks).length) list.push(other);
  return { days, from: dates[dates.length - 1] || '', rows: list };
}

// 무료(제한)·유료 샵: 만료 14일 전 / 만료 후 한 번씩 결제 링크 안내. 샵 이메일이 없으면 관리자에게.
// 만료된 샵은 사이트에서 자동으로 숨겨지고(isLive), 관리자가 기간을 늘리면 다시 보여요.
async function expiryNotices(base) {
  const shops = await S.hgetallJSON(K.shops);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 14 * 86400e3).toISOString().slice(0, 10);
  const pay = process.env.PAYMENT_URL || '';
  const sent = [], adminTo = await S.adminEmail();
  for (const s of Object.values(shops)) {
    if (s.plan === 'friend' || s.plan === 'free' || !s.expires || s.show === false) continue;
    const n = (s.notice && s.notice.for === s.expires) ? s.notice : { for: s.expires };
    let kind = '';
    if (s.expires < today && !n.end) kind = 'end';
    else if (s.expires >= today && s.expires <= soon && !n.soon) kind = 'soon';
    if (!kind) continue;
    const plan = S.PLAN_KO[s.plan] || s.plan;
    const payLine = pay ? `<p>계속 노출하려면 아래에서 결제해 주세요. 결제가 확인되면 1년 연장해 드려요.<br><a href="${S.esc(pay)}">${S.esc(pay)}</a></p>` : '<p>연장을 원하시면 이 메일에 답장해 주세요.</p>';
    const subject = kind === 'end' ? `[otemp.app] ${s.name} 게시 기간이 끝났어요` : `[otemp.app] ${s.name} 게시 기간이 ${s.expires}에 끝나요`;
    const body = `<p>${S.esc(s.name)} (${plan}) 게시 기간: ~${s.expires}</p>${kind === 'end' ? '<p>지금은 사이트에 보이지 않아요.</p>' : ''}${payLine}<p style="color:#888">Your listing ${kind === 'end' ? 'has ended' : 'ends on ' + s.expires}. ${pay ? 'Renew here: ' + S.esc(pay) : 'Reply to renew.'}</p>`;
    const to = s.email || adminTo;
    const ok = to ? await S.sendMail(to, subject, (s.email ? '' : `<p><b>[샵 이메일 없음 - 관리자에게 보냄]</b></p>`) + body) : false;
    if (s.email && adminTo) await S.sendMail(adminTo, `[otemp] 안내 발송: ${subject}`, body);
    // 실제로 보냈을 때만 표시(메일 설정 전이면 다음 날 다시 시도)
    if (ok) { n[kind] = Date.now(); s.notice = n; await R(['HSET', K.shops, String(s.id), JSON.stringify(s)]); }
    sent.push({ id: s.id, kind, mailed: ok });
  }
  return { sent };
}

const { botInfo } = require('./_bots');
module.exports = async function handler(req, res) {
  const q = req.query || {};
  const svc = String(q.svc || '');
  try {
    if (svc === 'auth') return await require('./_auth')(req, res); // [ADD] 간편 로그인·계정·즐겨찾기(api/_auth.js)
    if (svc === 'site') { // [ADD] 공지(팝업)·버전 표시 설정 - 누구나 읽기(30초 캐시)
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
      return res.status(200).json({ ok: true, ...(await require('./_site').get()) });
    }
    if (svc === 'click') {
      const id = String(q.id || ''), k = String(q.k || ''), no = parseInt(q.no, 10);
      if (/^[\w-]{1,20}$/.test(id) && KINDS.has(k) && !botInfo(req.headers['user-agent'])) { // [CHANGE] 봇 클릭은 안 셈
        const day = new Date().toISOString().slice(0, 10);
        const field = no > 0 && no < 100000 ? `${id}|${k}|${no}` : `${id}|${k}`; // [CHANGE] 어느 포인트에서 눌렀는지도
        try { await R(['HINCRBY', `sc:${day}`, field, 1], ['EXPIRE', `sc:${day}`, String(800 * 86400)]); } catch (_) {}
      }
      res.setHeader('Cache-Control', 'no-store'); return res.status(204).end();
    }

    // [ADD] 매일 한 번(Vercel Cron): 게시 기간 끝나기 14일 전·끝난 날 결제 안내 메일
    if (svc === 'cron') {
      if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return send(res, 401, { ok: false });
      return send(res, 200, { ok: true, ...(await expiryNotices(S.baseOf(req))) });
    }

    // [ADD] 아래 정보 줄 바로가기에 이 샵이 보인 횟수
    if (svc === 'imp') {
      const id = String(q.id || ''), no = parseInt(q.no, 10);
      if (/^[\w-]{1,20}$/.test(id) && no > 0 && no < 100000 && !botInfo(req.headers['user-agent'])) { // [CHANGE] 봇 노출은 안 셈
        const day = new Date().toISOString().slice(0, 10);
        try { await R(['HINCRBY', `si:${day}`, `${id}|${no}`, 1], ['EXPIRE', `si:${day}`, String(800 * 86400)]); } catch (_) {}
      }
      res.setHeader('Cache-Control', 'no-store'); return res.status(204).end();
    }

    if (svc === 'spots') {
      // [CHANGE] 전체 포인트 목록(관리 페이지에서 관리 · 옮기기 전엔 구글 시트+사용자 등록+기본 포인트). 앱·샵·포인트 등록 페이지가 이걸 읽어요
      const spots = (await S.allSpots(S.baseOf(req))).map(s => ({ no: s.no, country: s.country, name: s.name, label: s.label, lat: s.lat, lon: s.lon, network: s.network, depth: s.depth, face: s.face ?? undefined, prof: S.normProf(s) || undefined }));
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
      return res.status(200).json({ ok: true, spots });
    }

    if (svc === 'register' && req.method === 'POST') {
      const b = bodyOf(req);
      if (b.website2) return send(res, 200, { ok: true, token: '' }); // 스팸 봇(숨은 칸을 채움)
      if (await limited(req, 'reg', 5, 86400)) return send(res, 429, { ok: false, error: 'too_many' });
      const f = S.shopFields(b), mail = S.email(b.email);
      if (!S.shopValid(f)) return send(res, 400, { ok: false, error: f.type === 'pool' ? 'need_name_loc' : 'need_name_spots' });
      if (!S.hasContact(f)) return send(res, 400, { ok: false, error: 'need_contact' });
      if (!mail) return send(res, 400, { ok: false, error: 'need_email' });
      if (!b.agree || b.terms !== S.TERMS_VERSION) return send(res, 400, { ok: false, error: 'need_agree' }); // [CHANGE] 약관 동의 필수
      const id = 'n' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      const { token, hash } = S.newToken();
      const rq = { id, type: 'new', data: f, email: mail, memo: S.str(b.memo, 500), at: Date.now(), tok: hash, terms: S.TERMS_VERSION, termsAt: Date.now() };
      await R(['HSET', K.req, id, JSON.stringify(rq)], ['HSET', K.tok, hash, 'r:' + id]);
      const base = S.baseOf(req), url = S.editUrl(base, token);
      await notifyAdmin(`[otemp] 새 샵 등록 요청: ${f.name}`, `<p>${S.esc(f.name)} (${S.esc(mail)})</p><p><a href="${base}/admin/#shops">관리 페이지에서 확인</a></p>`);
      await S.sendMail(mail, '[otemp.app] 샵 등록 요청을 받았어요 / Shop registration received',
        `<p>${S.esc(f.name)} 등록 요청을 받았어요. 확인 후 사이트에 보여요.</p><p>정보 수정 링크(다른 사람에게 알려주지 마세요):<br><a href="${url}">${url}</a></p><hr><p>We received your registration. Your private edit link is above.</p>`);
      return send(res, 200, { ok: true, token, url });
    }

    if (svc === 'me' && req.method === 'POST') {
      const tk = await lookupToken(bodyOf(req).t);
      if (!tk) return send(res, 404, { ok: false, error: 'bad_link' });
      if (tk.kind === 'r') {
        const [raw] = await R(['HGET', K.req, tk.id]);
        if (!raw) return send(res, 404, { ok: false, error: 'bad_link' });
        const rq = JSON.parse(raw);
        return send(res, 200, { ok: true, status: 'pending_new', data: rq.data, email: rq.email, termsOk: rq.terms === S.TERMS_VERSION, terms: S.TERMS_VERSION });
      }
      const [raw, pend] = await R(['HGET', K.shops, tk.id], ['HGET', K.req, 'e' + tk.id]);
      if (!raw) return send(res, 404, { ok: false, error: 'bad_link' });
      const s = JSON.parse(raw), p = pend ? JSON.parse(pend) : null;
      const days = [30, 90, 365].includes(+bodyOf(req).days) ? +bodyOf(req).days : 30;
      let stats = null;
      try { stats = await shopStats(s, days); } catch (_) {}
      return send(res, 200, { ok: true, status: p ? 'pending_edit' : (S.isLive(s) ? 'live' : 'hidden'),
        data: p ? p.data : S.shopFields(s), email: (p && p.email) || s.email || '', live: S.publicShop(s), expires: s.expires || '', plan: s.plan || 'free', stats,
        termsOk: s.terms === S.TERMS_VERSION || !!(p && p.terms === S.TERMS_VERSION), terms: S.TERMS_VERSION });
    }

    if (svc === 'edit' && req.method === 'POST') {
      const b = bodyOf(req);
      if (await limited(req, 'edit', 30, 86400)) return send(res, 429, { ok: false, error: 'too_many' });
      const tk = await lookupToken(b.t);
      if (!tk) return send(res, 404, { ok: false, error: 'bad_link' });
      const f = S.shopFields(b), mail = S.email(b.email);
      if (!S.shopValid(f)) return send(res, 400, { ok: false, error: f.type === 'pool' ? 'need_name_loc' : 'need_name_spots' });
      if (!S.hasContact(f)) return send(res, 400, { ok: false, error: 'need_contact' });
      if (!mail) return send(res, 400, { ok: false, error: 'need_email' });
      if (tk.kind === 'r') { // 아직 승인 전 → 대기 중인 요청을 그대로 고침
        const [raw] = await R(['HGET', K.req, tk.id]);
        if (!raw) return send(res, 404, { ok: false, error: 'bad_link' });
        const rq = JSON.parse(raw);
        if (rq.terms !== S.TERMS_VERSION && b.terms !== S.TERMS_VERSION) return send(res, 400, { ok: false, error: 'need_agree' });
        Object.assign(rq, { data: f, email: mail, memo: S.str(b.memo, 500) || rq.memo, at: Date.now() });
        if (b.terms === S.TERMS_VERSION) { rq.terms = S.TERMS_VERSION; rq.termsAt = Date.now(); }
        await R(['HSET', K.req, tk.id, JSON.stringify(rq)]);
        return send(res, 200, { ok: true, status: 'pending_new' });
      }
      const [raw] = await R(['HGET', K.shops, tk.id]);
      if (!raw) return send(res, 404, { ok: false, error: 'bad_link' });
      const s = JSON.parse(raw);
      // [ADD] 아직 지금 약관에 동의하지 않은 샵(가져오기·관리자 추가·예전 약관)은 수정할 때 동의 받기
      if (s.terms !== S.TERMS_VERSION && b.terms !== S.TERMS_VERSION) return send(res, 400, { ok: false, error: 'need_agree' });
      const rq = { id: 'e' + tk.id, type: 'edit', shopId: tk.id, data: f, email: mail, memo: S.str(b.memo, 500), at: Date.now() };
      if (b.terms === S.TERMS_VERSION) { rq.terms = S.TERMS_VERSION; rq.termsAt = Date.now(); }
      await R(['HSET', K.req, rq.id, JSON.stringify(rq)]);
      await notifyAdmin(`[otemp] 샵 수정 요청: ${s.name}`, `<p>${S.esc(s.name)} → ${S.esc(f.name)}</p><p><a href="${S.baseOf(req)}/admin/#shops">관리 페이지에서 확인</a></p>`);
      return send(res, 200, { ok: true, status: 'pending_edit' });
    }

    if (svc === 'resend' && req.method === 'POST') {
      const mail = S.email(bodyOf(req).email);
      // 있든 없든 같은 답(어떤 이메일이 등록됐는지 알아낼 수 없게)
      const done = () => send(res, 200, { ok: true, mail: !!process.env.RESEND_API_KEY });
      if (!mail || await limited(req, 'resend', 5, 3600)) return done();
      const [shops, reqs] = await Promise.all([S.hgetallJSON(K.shops), S.hgetallJSON(K.req)]);
      const base = S.baseOf(req), links = [], cmds = [];
      Object.values(shops).filter(s => s.email === mail).forEach(s => {
        const { token, hash } = S.newToken();
        if (s.tok) cmds.push(['HDEL', K.tok, s.tok]);
        s.tok = hash; cmds.push(['HSET', K.shops, String(s.id), JSON.stringify(s)], ['HSET', K.tok, hash, 's:' + s.id]);
        links.push([s.name, S.editUrl(base, token)]);
      });
      Object.values(reqs).filter(r => r.type === 'new' && r.email === mail).forEach(r => {
        const { token, hash } = S.newToken();
        if (r.tok) cmds.push(['HDEL', K.tok, r.tok]);
        r.tok = hash; cmds.push(['HSET', K.req, r.id, JSON.stringify(r)], ['HSET', K.tok, hash, 'r:' + r.id]);
        links.push([r.data.name + ' (검토 중)', S.editUrl(base, token)]);
      });
      if (links.length && process.env.RESEND_API_KEY) {
        await R(...cmds); // 메일을 보낼 수 있을 때만 링크를 바꿈(예전 링크는 더 이상 안 됨)
        await S.sendMail(mail, '[otemp.app] 샵 정보 수정 링크 / Your edit link',
          `<p>새 수정 링크예요. 예전 링크는 더 이상 쓸 수 없어요.</p>${links.map(([n, u]) => `<p><b>${S.esc(n)}</b><br><a href="${u}">${u}</a></p>`).join('')}<hr><p>Here is your new edit link. Old links no longer work.</p>`);
      }
      return done();
    }

    // [ADD] 샵 정보 이의 제기(본인이 등록하지 않음·업주 변경·정보 틀림·폐업 등) → 관리 페이지에서 처리
    if (svc === 'report' && req.method === 'POST') {
      const b = bodyOf(req);
      if (b.website2) return send(res, 200, { ok: true });
      if (await limited(req, 'report', 5, 86400)) return send(res, 429, { ok: false, error: 'too_many' });
      const REASONS = ['not_mine', 'owner_changed', 'wrong_info', 'closed', 'other'], WHOS = ['owner', 'customer', 'other'];
      const shopId = S.str(b.id, 20), mail = S.email(b.email), detail = S.str(b.detail, 1000);
      if (!REASONS.includes(b.reason) || !WHOS.includes(b.who) || !detail || !mail) return send(res, 400, { ok: false, error: 'need_fields' });
      const [raw] = await R(['HGET', K.shops, shopId]);
      if (!raw) return send(res, 400, { ok: false, error: 'need_fields' });
      const shop = JSON.parse(raw);
      const id = 'x' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      await R(['HSET', K.reports, id, JSON.stringify({ id, shopId, shopName: shop.name, reason: b.reason, who: b.who, detail, email: mail, at: Date.now() })]);
      await notifyAdmin(`[otemp] 샵 이의 제기: ${shop.name}`, `<p>${S.esc(shop.name)} · ${S.esc(b.reason)} · ${S.esc(b.who)}</p><p>${S.esc(detail)}</p><p>${S.esc(mail)}</p><p><a href="${S.baseOf(req)}/admin/#shops">관리 페이지에서 확인</a></p>`);
      return send(res, 200, { ok: true });
    }

    if (svc === 'spot' && req.method === 'POST') {
      const b = bodyOf(req);
      if (b.website2) return send(res, 200, { ok: true });
      if (await limited(req, 'spot', 30, 86400)) /* [CHANGE] 하루 10 → 30곳(같은 사람 기준) */ return send(res, 429, { ok: false, error: 'too_many' });
      const f = S.spotFields(b);
      if (!f.name || f.lat == null || f.lon == null) return send(res, 400, { ok: false, error: 'need_name_pos' });
      const id = 'p' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      await R(['HSET', K.spotreq, id, JSON.stringify({ id, data: f, email: S.email(b.email), at: Date.now() })]);
      await notifyAdmin(`[otemp] 새 정점 등록 요청: ${f.name}`, `<p>${S.esc(f.name)} ${f.lat}, ${f.lon}</p><p><a href="${S.baseOf(req)}/admin/#spots">관리 페이지에서 확인</a></p>`);
      return send(res, 200, { ok: true });
    }

    // 기본: 사이트에 보일 샵 목록
    const all = await S.hgetallJSON(K.shops);
    const shops = Object.values(all).filter(S.isLive).map(S.publicShop);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=86400');
    return res.status(200).send(JSON.stringify({ ok: true, count: shops.length, shops }));
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e && e.message || e) });
  }
};
