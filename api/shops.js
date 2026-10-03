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
  if (process.env.ADMIN_EMAIL) await S.sendMail(process.env.ADMIN_EMAIL, subject, html);
}

async function lookupToken(t) {
  if (!t || typeof t !== 'string' || t.length > 100) return null;
  const [v] = await R(['HGET', K.tok, S.sha(t)]);
  if (!v) return null;
  const [kind, id] = [v.slice(0, 1), v.slice(2)];
  return { kind, id, hash: S.sha(t) };
}

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const svc = String(q.svc || '');
  try {
    if (svc === 'click') {
      const id = String(q.id || ''), k = String(q.k || '');
      if (/^[\w-]{1,20}$/.test(id) && KINDS.has(k)) {
        const day = new Date().toISOString().slice(0, 10);
        try { await R(['HINCRBY', `sc:${day}`, `${id}|${k}`, 1], ['EXPIRE', `sc:${day}`, String(800 * 86400)]); } catch (_) {}
      }
      res.setHeader('Cache-Control', 'no-store'); return res.status(204).end();
    }

    if (svc === 'spots') {
      const all = await S.hgetallJSON(K.spots);
      const spots = Object.values(all).filter(s => s.show !== false).map(s => ({ no: s.no, country: s.country, name: s.name, label: s.label, lat: s.lat, lon: s.lon }));
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
      return res.status(200).json({ ok: true, spots });
    }

    if (svc === 'register' && req.method === 'POST') {
      const b = bodyOf(req);
      if (b.website2) return send(res, 200, { ok: true, token: '' }); // 스팸 봇(숨은 칸을 채움)
      if (await limited(req, 'reg', 5, 86400)) return send(res, 429, { ok: false, error: 'too_many' });
      const f = S.shopFields(b), mail = S.email(b.email);
      if (!f.name || !f.spots.length) return send(res, 400, { ok: false, error: 'need_name_spots' });
      if (!S.hasContact(f)) return send(res, 400, { ok: false, error: 'need_contact' });
      if (!mail) return send(res, 400, { ok: false, error: 'need_email' });
      if (!b.agree) return send(res, 400, { ok: false, error: 'need_agree' });
      const id = 'n' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      const { token, hash } = S.newToken();
      const rq = { id, type: 'new', data: f, email: mail, memo: S.str(b.memo, 500), at: Date.now(), tok: hash };
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
        return send(res, 200, { ok: true, status: 'pending_new', data: rq.data, email: rq.email });
      }
      const [raw, pend] = await R(['HGET', K.shops, tk.id], ['HGET', K.req, 'e' + tk.id]);
      if (!raw) return send(res, 404, { ok: false, error: 'bad_link' });
      const s = JSON.parse(raw), p = pend ? JSON.parse(pend) : null;
      return send(res, 200, { ok: true, status: p ? 'pending_edit' : (S.isLive(s) ? 'live' : 'hidden'),
        data: p ? p.data : S.shopFields(s), email: (p && p.email) || s.email || '', live: S.publicShop(s), expires: s.expires || '', plan: s.plan || 'free' });
    }

    if (svc === 'edit' && req.method === 'POST') {
      const b = bodyOf(req);
      if (await limited(req, 'edit', 30, 86400)) return send(res, 429, { ok: false, error: 'too_many' });
      const tk = await lookupToken(b.t);
      if (!tk) return send(res, 404, { ok: false, error: 'bad_link' });
      const f = S.shopFields(b), mail = S.email(b.email);
      if (!f.name || !f.spots.length) return send(res, 400, { ok: false, error: 'need_name_spots' });
      if (!S.hasContact(f)) return send(res, 400, { ok: false, error: 'need_contact' });
      if (!mail) return send(res, 400, { ok: false, error: 'need_email' });
      if (tk.kind === 'r') { // 아직 승인 전 → 대기 중인 요청을 그대로 고침
        const [raw] = await R(['HGET', K.req, tk.id]);
        if (!raw) return send(res, 404, { ok: false, error: 'bad_link' });
        const rq = JSON.parse(raw);
        Object.assign(rq, { data: f, email: mail, memo: S.str(b.memo, 500) || rq.memo, at: Date.now() });
        await R(['HSET', K.req, tk.id, JSON.stringify(rq)]);
        return send(res, 200, { ok: true, status: 'pending_new' });
      }
      const [raw] = await R(['HGET', K.shops, tk.id]);
      if (!raw) return send(res, 404, { ok: false, error: 'bad_link' });
      const s = JSON.parse(raw);
      const rq = { id: 'e' + tk.id, type: 'edit', shopId: tk.id, data: f, email: mail, memo: S.str(b.memo, 500), at: Date.now() };
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

    if (svc === 'spot' && req.method === 'POST') {
      const b = bodyOf(req);
      if (b.website2) return send(res, 200, { ok: true });
      if (await limited(req, 'spot', 10, 86400)) return send(res, 429, { ok: false, error: 'too_many' });
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
