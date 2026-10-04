// [ADD] 관리 페이지(/admin)의 샵·정점 관리 동작. api/stats.js가 비밀번호를 확인한 뒤에만 불러요.
const S = require('./_store');
const { K, R } = S;

const bodyOf = (req) => { let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } return b || {}; };
const ym = () => new Date().toISOString().slice(0, 7);

// 샵들의 수정 링크를 새로 만들어(예전 링크 끊김) 관리자 이메일로 한 번에 보내고, 링크 목록을 돌려줌
async function linksToAdmin(shops, base) {
  const links = [];
  for (const shop of shops) {
    const { token, hash } = S.newToken();
    const cmds = [['HSET', K.tok, hash, 's:' + shop.id]];
    if (shop.tok) cmds.push(['HDEL', K.tok, shop.tok]);
    shop.tok = hash; cmds.push(['HSET', K.shops, String(shop.id), JSON.stringify(shop)]);
    await R(...cmds);
    links.push({ id: String(shop.id), name: shop.name, url: S.editUrl(base, token) });
  }
  const adminTo = await S.adminEmail();
  if (links.length && adminTo) {
    await S.sendMail(adminTo, `[otemp] 이메일 없는 샵 수정 링크 ${links.length}곳`,
      `<p>샵 이메일이 없어서 관리자에게 보내요. 각 샵에 전달해 주세요.</p>${links.map(l => `<p><b>${S.esc(l.name)}</b><br><a href="${l.url}">${l.url}</a></p>`).join('')}`);
  }
  return links;
}

module.exports = async function admin(req, res) {
  const svc = String(req.query.svc), b = bodyOf(req), base = S.baseOf(req);
  const ok = (o) => res.status(200).json({ ok: true, ...(o || {}) });
  const bad = (e) => res.status(400).json({ ok: false, error: e });

  // [ADD] 관리자 설정: 비밀번호·알림 이메일 바꾸기
  if (svc === 'settings') {
    const c = await S.adminCfg();
    return ok({ email: c.email || process.env.ADMIN_EMAIL || '', emailFrom: c.email ? 'admin' : (process.env.ADMIN_EMAIL ? 'env' : ''), pwFrom: c.pwHash ? 'admin' : 'env',
      pwChanged: c.pwAt || 0, mail: !!process.env.RESEND_API_KEY });
  }
  if (svc === 'setPassword') {
    if (!(await S.checkAdminPw(b.current))) { await new Promise(r => setTimeout(r, 600)); return bad('wrong_current'); }
    const next = String(b.next || '');
    if (next.length < 10) return bad('too_short');
    if (next !== String(b.confirm || '')) return bad('mismatch');
    const c = await S.adminCfg();
    c.pwHash = S.hashPw(next); c.pwAt = Date.now();
    await R(['SET', 'admin:cfg', JSON.stringify(c)]);
    const to = await S.adminEmail();
    if (to) await S.sendMail(to, '[otemp] 관리자 비밀번호가 바뀌었어요', `<p>${new Date().toISOString()} 관리 페이지에서 비밀번호가 바뀌었어요. 본인이 아니면 Upstash에서 admin:cfg 키를 지우고 Vercel의 ADMIN_PASSWORD를 바꿔주세요.</p>`);
    return ok();
  }
  if (svc === 'setEmail') {
    if (!(await S.checkAdminPw(b.current))) { await new Promise(r => setTimeout(r, 600)); return bad('wrong_current'); }
    const mail = b.email ? S.email(b.email) : '';
    if (b.email && !mail) return bad('bad_email');
    const c = await S.adminCfg();
    const old = c.email || process.env.ADMIN_EMAIL || '';
    if (mail) c.email = mail; else delete c.email; // 비우면 ADMIN_EMAIL 환경변수로 돌아감
    await R(['SET', 'admin:cfg', JSON.stringify(c)]);
    if (old && old !== mail) await S.sendMail(old, '[otemp] 관리자 알림 이메일이 바뀌었어요', `<p>알림 이메일이 ${S.esc(mail || '(환경변수 값)')}(으)로 바뀌었어요.</p>`);
    return ok({ email: c.email || process.env.ADMIN_EMAIL || '' });
  }
  if (svc === 'testMail') {
    const to = await S.adminEmail();
    if (!to) return bad('no_email');
    const sent = await S.sendMail(to, '[otemp] 테스트 메일', '<p>관리 페이지에서 보낸 테스트 메일이에요. 잘 받으셨으면 알림 설정이 정상이에요.</p>');
    return ok({ sent, to });
  }

  if (svc === 'list') {
    const [shops, reqs, spots, spotreqs, reports] = await Promise.all([S.hgetallJSON(K.shops), S.hgetallJSON(K.req), S.hgetallJSON(K.spots), S.hgetallJSON(K.spotreq), S.hgetallJSON(K.reports)]);
    const strip = (s) => { const { tok, ...rest } = s; return { ...rest, live: S.isLive(s) }; };
    // [CHANGE] 포인트: 옮긴 뒤엔 전체(숨김 포함), 옮기기 전엔 시트+사용자 등록을 합쳐 보여주고(시트 것은 수정 불가 표시)
    const migrated = await S.spotsMigrated();
    const spotList = migrated ? Object.values(spots) : (await S.allSpots(S.baseOf(req), { hidden: true, fresh: true })).map(s => ({ ...s, ...(spots[s.no] || { sheet: true }) }));
    return ok({ shops: Object.values(shops).map(strip), reqs: Object.values(reqs).map(({ tok, ...r }) => r), spots: spotList, spotsMigrated: migrated, spotreqs: Object.values(spotreqs), reports: Object.values(reports) });
  }
  // [ADD] 구글 시트 정점을 관리 페이지(Redis)로 한 번에 옮기기 - 이미 있는 번호는 그대로 두고 없는 것만 추가
  if (svc === 'spotsMigrate') {
    const list = await S.legacySpots(S.baseOf(req));
    if (list.length < 10) return bad('sheet_empty');
    const have = await S.hgetallJSON(K.spots);
    const cmds = [];
    let added = 0;
    list.forEach(s => { if (have[s.no]) return; cmds.push(['HSET', K.spots, String(s.no), JSON.stringify({ ...s, name: S.cleanName(s.name), label: S.cleanName(s.label), src: 'sheet', created: Date.now() })]); added++; });
    // 예전 사용자 등록 포인트에도 network/depth 칸 채우기
    Object.values(have).forEach(h => { const n = S.normSpot({ ...h, network: h.network || 'Beach/user' }); if (n) cmds.push(['HSET', K.spots, String(n.no), JSON.stringify({ ...h, ...n })]); });
    cmds.push(['SET', S.MIGRATED_KEY, String(Date.now())], ['DEL', 'sp:list']);
    for (let i = 0; i < cmds.length; i += 100) await R(...cmds.slice(i, i + 100));
    S.clearSpotsMemo();
    return ok({ added, total: list.length });
  }
  // [ADD] 관리자가 새 포인트를 바로 추가
  if (svc === 'spotAdd') {
    if (!(await S.spotsMigrated())) return bad('migrate_first');
    const f = S.spotFields(b);
    if (!f.name || f.lat == null || f.lon == null) return bad('need_name_latlon');
    const no = await S.nextSpotNo(S.baseOf(req));
    const spot = { no, ...f, network: S.str(b.network, 40) || 'Beach/local', depth: b.depth !== false, show: b.show !== false, created: Date.now() };
    await R(['HSET', K.spots, String(no), JSON.stringify(spot)], ['DEL', 'sp:list']);
    S.clearSpotsMemo();
    return ok({ no });
  }

  // 샵 요청 승인: 새 등록이면 번호를 주고 게시, 수정이면 기존 샵에 반영(요금제·만료일은 관리자만)
  if (svc === 'shopApprove') {
    const [raw] = await R(['HGET', K.req, String(b.reqId)]);
    if (!raw) return bad('no_request');
    const rq = JSON.parse(raw);
    const data = S.shopFields(Object.assign({}, rq.data, b.data || {})); // 관리자가 승인 화면에서 고친 값 우선
    if (rq.type === 'new') {
      const [n] = await R(['INCR', K.seq]);
      const id = String(n);
      const plan = S.planOf(b.plan);
      // 무료(제한)·유료는 만료일을 비우면 1년 뒤로 자동
      const shop = { id, ...data, email: rq.email, plan, expires: S.dateStr(b.expires) || S.defaultExpires(plan), terms: rq.terms || '', termsAt: rq.termsAt || 0,
        show: true, checked: ym(), created: Date.now(), updated: Date.now(), tok: rq.tok };
      await R(['HSET', K.shops, id, JSON.stringify(shop)], ['HSET', K.tok, rq.tok, 's:' + id], ['HDEL', K.req, rq.id]);
      await S.sendMail(rq.email, '[otemp.app] 샵이 등록됐어요 / Your shop is live',
        `<p>${S.esc(shop.name)} 정보가 사이트에 올라갔어요. 고칠 때는 처음 받은 수정 링크를 쓰거나, ${base}/shop/ 에서 이메일로 새 링크를 받으세요.</p>`);
      return ok({ id });
    }
    const [sraw] = await R(['HGET', K.shops, String(rq.shopId)]);
    if (!sraw) { await R(['HDEL', K.req, rq.id]); return bad('no_shop'); }
    const shop = JSON.parse(sraw);
    Object.assign(shop, data, { email: rq.email || shop.email, checked: ym(), updated: Date.now() });
    if (rq.terms) { shop.terms = rq.terms; shop.termsAt = rq.termsAt; }
    await R(['HSET', K.shops, String(shop.id), JSON.stringify(shop)], ['HDEL', K.req, rq.id]);
    return ok({ id: shop.id });
  }
  if (svc === 'shopReject') {
    const [raw] = await R(['HGET', K.req, String(b.reqId)]);
    if (!raw) return bad('no_request');
    const rq = JSON.parse(raw);
    const cmds = [['HDEL', K.req, rq.id]];
    if (rq.type === 'new' && rq.tok) cmds.push(['HDEL', K.tok, rq.tok]);
    await R(...cmds);
    return ok();
  }
  // 관리자가 직접 고치기(요금제·만료일·보이기 포함). id가 없으면 새로 추가
  if (svc === 'shopSave') {
    const data = S.shopFields(b);
    if (!data.name || !data.spots.length) return bad('need_name_spots');
    let shop, id = b.id ? String(b.id) : '';
    if (id) { const [raw] = await R(['HGET', K.shops, id]); if (!raw) return bad('no_shop'); shop = JSON.parse(raw); }
    else { const [n] = await R(['INCR', K.seq]); id = String(n); shop = { id, created: Date.now() }; }
    const plan = S.planOf(b.plan), isNew = !b.id;
    const expires = S.dateStr(b.expires) || (plan === 'friend' ? '' : (shop.expires || S.defaultExpires(plan)));
    if (expires !== shop.expires) shop.notice = {}; // 기간이 바뀌면 만료 안내를 다시 보낼 수 있게
    Object.assign(shop, data, { email: S.email(b.email), plan, expires,
      show: b.show !== false, checked: S.str(b.checked, 10) || shop.checked || ym(), updated: Date.now() });
    await R(['HSET', K.shops, id, JSON.stringify(shop)]);
    // [ADD] 이메일 없이 새로 넣은 샵은 수정 링크를 관리자에게
    if (isNew && !shop.email) { const links = await linksToAdmin([shop], base); return ok({ id, links }); }
    return ok({ id });
  }
  // 새 수정 링크 만들기(예전 링크는 더 이상 안 됨) → 관리자가 샵에 직접 보내줌. 이메일이 있고 메일 설정이 되어 있으면 메일도 보냄
  if (svc === 'shopLink') {
    const id = String(b.id);
    const [raw] = await R(['HGET', K.shops, id]);
    if (!raw) return bad('no_shop');
    const shop = JSON.parse(raw), { token, hash } = S.newToken();
    const cmds = [['HSET', K.tok, hash, 's:' + id]];
    if (shop.tok) cmds.push(['HDEL', K.tok, shop.tok]);
    shop.tok = hash; cmds.push(['HSET', K.shops, id, JSON.stringify(shop)]);
    await R(...cmds);
    const url = S.editUrl(base, token);
    let mailed = false;
    if (b.mail && shop.email) mailed = await S.sendMail(shop.email, '[otemp.app] 샵 정보 수정 링크 / Your edit link', `<p>${S.esc(shop.name)} 수정 링크: <a href="${url}">${url}</a></p>`);
    // [ADD] 이메일이 없는 샵이면 관리자에게 보냄
    const adminTo = await S.adminEmail();
    if (!shop.email && adminTo) mailed = await S.sendMail(adminTo, `[otemp] ${shop.name} 수정 링크 (샵 이메일 없음)`, `<p>${S.esc(shop.name)} 수정 링크입니다. 샵에 전달해 주세요.</p><p><a href="${url}">${url}</a></p>`);
    return ok({ url, mailed, toAdmin: !shop.email });
  }
  // [ADD] 이메일 없는 샵 전부: 새 수정 링크를 만들어 관리자 메일로(화면에도 보여줌)
  if (svc === 'linksNoEmail') {
    const shops = Object.values(await S.hgetallJSON(K.shops)).filter(s => !s.email);
    return ok({ links: await linksToAdmin(shops, base) });
  }
  // [ADD] 이의 제기 처리
  //  reportDone: 처리 완료(목록에서 지움) · reportHide: 샵 숨기고 완료
  //  reportTransfer: 신고자를 새 담당자로(샵 이메일 변경 + 새 수정 링크를 신고자에게, 예전 링크 끊김)
  if (svc === 'reportDone' || svc === 'reportHide' || svc === 'reportTransfer') {
    const [raw] = await R(['HGET', K.reports, String(b.id)]);
    if (!raw) return bad('no_report');
    const rp = JSON.parse(raw);
    const [sraw] = await R(['HGET', K.shops, String(rp.shopId)]);
    let out = {};
    if (sraw && svc !== 'reportDone') {
      const shop = JSON.parse(sraw);
      if (svc === 'reportHide') { shop.show = false; await R(['HSET', K.shops, String(shop.id), JSON.stringify(shop)]); }
      if (svc === 'reportTransfer') {
        const { token, hash } = S.newToken();
        const cmds = [['HSET', K.tok, hash, 's:' + shop.id], ['HDEL', K.req, 'e' + shop.id]]; // 이전 담당자의 대기 중 수정 요청도 취소
        if (shop.tok) cmds.push(['HDEL', K.tok, shop.tok]);
        Object.assign(shop, { tok: hash, email: rp.email, terms: '', termsAt: 0, updated: Date.now() }); // 새 담당자는 약관 동의부터 다시
        cmds.push(['HSET', K.shops, String(shop.id), JSON.stringify(shop)]);
        await R(...cmds);
        const url = S.editUrl(base, token);
        const mailed = await S.sendMail(rp.email, '[otemp.app] 샵 정보 수정 링크 / Your edit link',
          `<p>${S.esc(shop.name)} 담당자로 등록됐어요. 아래 링크에서 약관 동의 후 정보를 고칠 수 있어요(고친 내용은 확인 후 반영).</p><p><a href="${url}">${url}</a></p><hr><p>You are now the contact for this listing. Use the link above to update it.</p>`);
        out = { url, mailed };
      }
    }
    await R(['HDEL', K.reports, rp.id]);
    return ok(out);
  }
  if (svc === 'shopDelete') {
    const id = String(b.id);
    const [raw] = await R(['HGET', K.shops, id]);
    const cmds = [['HDEL', K.shops, id], ['HDEL', K.req, 'e' + id]];
    if (raw) { const s = JSON.parse(raw); if (s.tok) cmds.push(['HDEL', K.tok, s.tok]); }
    await R(...cmds);
    return ok();
  }
  // 구글 시트(편집 링크도 OK, "링크가 있는 사용자 보기" 공유 필요)에서 샵 가져오기
  if (svc === 'shopImport') {
    let url = S.str(b.url, 400);
    const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
    if (m && !/output=csv|format=csv/.test(url)) { const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1]; url = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? '&gid=' + gid : ''}`; }
    if (!/^https:\/\//.test(url)) return bad('bad_url');
    const rows = S.csvObjects(await S.getText(url, 15000));
    if (!rows.length) return bad('no_rows');
    const existing = await S.hgetallJSON(K.shops);
    const names = new Set(Object.values(existing).map(s => s.name));
    let added = 0, skipped = 0; const newOnes = [];
    for (const r of rows) {
      const data = S.shopFields(r);
      if (!data.name || !data.spots.length || names.has(data.name)) { skipped++; continue; }
      const [n] = await R(['INCR', K.seq]);
      const plan = S.planOf(r.plan);
      const shop = { id: String(n), ...data, email: S.email(r.email), plan,
        expires: S.dateStr(r.expires) || S.defaultExpires(plan), show: !/^n/i.test(r.show || ''), checked: S.str(r.checked, 10) || ym(), created: Date.now(), updated: Date.now() };
      await R(['HSET', K.shops, shop.id, JSON.stringify(shop)]);
      names.add(data.name); added++; newOnes.push(shop);
    }
    // [ADD] 이메일 없이 가져온 샵들의 수정 링크는 관리자에게
    const links = await linksToAdmin(newOnes.filter(s => !s.email), base);
    return ok({ added, skipped, links });
  }

  // 정점 요청 승인: 시트·기존 등록 정점과 겹치지 않는 다음 번호
  if (svc === 'spotApprove') {
    const [raw] = await R(['HGET', K.spotreq, String(b.reqId)]);
    if (!raw) return bad('no_request');
    const rq = JSON.parse(raw);
    const f = S.spotFields(Object.assign({}, rq.data, b.data || {}));
    if (!f.name || f.lat == null || f.lon == null) return bad('need_name_pos');
    const extra = await S.hgetallJSON(K.spots);
    const no = Math.max(await S.nextSpotNo(S.baseOf(req)), 0, ...Object.keys(extra).map(Number).map(n => n + 1));
    const spot = { no, ...f, network: 'Beach/user', depth: true, show: true, email: rq.email || '', created: Date.now() };
    await R(['HSET', K.spots, String(no), JSON.stringify(spot)], ['HDEL', K.spotreq, rq.id], ['DEL', 'sp:list']);
    S.clearSpotsMemo();
    return ok({ no });
  }
  if (svc === 'spotReject') { await R(['HDEL', K.spotreq, String(b.reqId)]); return ok(); }
  if (svc === 'spotSave') {
    const no = String(parseInt(b.no, 10));
    const [raw] = await R(['HGET', K.spots, no]);
    if (!raw) return bad('no_spot');
    const spot = Object.assign(JSON.parse(raw), S.spotFields(Object.assign(JSON.parse(raw), b)), { show: b.show !== false });
    if (b.network !== undefined) spot.network = S.str(b.network, 40) || spot.network || 'Beach/local'; // [ADD]
    if (b.depth !== undefined) spot.depth = b.depth !== false;
    await R(['HSET', K.spots, no, JSON.stringify(spot)], ['DEL', 'sp:list']);
    S.clearSpotsMemo();
    return ok();
  }
  if (svc === 'spotDelete') { await R(['HDEL', K.spots, String(parseInt(b.no, 10))], ['DEL', 'sp:list']); S.clearSpotsMemo(); return ok(); }
  return bad('unknown_svc');
};
