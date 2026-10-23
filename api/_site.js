// [ADD] 사이트 공지(팝업)·소프트웨어 버전 표시 설정. Redis 키 site:cfg (JSON 한 덩어리).
//  - 공개 읽기: /api/shops?svc=site (api/shops.js, 30초 캐시)  - 저장: 관리 페이지 → api/_admin.js(siteSave)
const S = require('./_store');
const { R } = S;
const KEY = 'site:cfg';
const SHOW = ['off', 'guest', 'all'], POS = ['acct', 'bl', 'br', 'off'];

const numMs = (x) => { x = Number(x); return Number.isFinite(x) && x > 0 ? Math.round(x) : 0; };
function cleanNotice(n) {
  n = n && typeof n === 'object' ? n : {};
  return { id: S.str(n.id, 24) || ('n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    show: SHOW.includes(n.show) ? n.show : 'all', title: S.str(n.title, 60), sub: S.str(n.sub, 140),
    items: (Array.isArray(n.items) ? n.items : []).map(x => S.str(x, 80)).filter(Boolean).slice(0, 8),
    start: numMs(n.start), end: numMs(n.end), created: numMs(n.created), rev: numMs(n.rev),
    tr: n.tr && typeof n.tr === 'object' ? n.tr : {} };
}
// 지금 보여줄 공지: 노출 기간 안이고 꺼져 있지 않은 것 중 가장 최근에 만든 것
function activeNotice(list, now) {
  const act = list.filter(n => n.show !== 'off' && (!n.start || now >= n.start) && (!n.end || now <= n.end));
  return act.sort((a, b) => (b.start || b.created) - (a.start || a.created))[0] || null;
}
function clean(c) {
  c = c && typeof c === 'object' ? c : {};
  const n = c.notice || {}, v = c.ver || {};
  const num = (x) => { x = Number(x); return Number.isFinite(x) && x > 0 ? Math.round(x) : 0; };
  return {
    notice: {
      show: SHOW.includes(n.show) ? n.show : 'guest',               // off 안 보임 · guest 로그인 안 한 사람만 · all 모두
      title: S.str(n.title, 60), sub: S.str(n.sub, 140),
      items: (Array.isArray(n.items) ? n.items : []).map(x => S.str(x, 80)).filter(Boolean).slice(0, 8),
      start: num(n.start), end: num(n.end),                          // 노출 기간(밀리초, 0이면 제한 없음)
      tr: n.tr && typeof n.tr === 'object' ? n.tr : {}                // [ADD] 자동 번역본 { en|ko|es|zh|ja: { title, sub, items } } (저장할 때 DeepL 로 채움)
    },
    // [ADD] 공지 게시판: 여러 공지를 저장해 두고 각자 노출 기간·대상에 따라 보여줘요(최대 30개). notice(위)는 예전 클라이언트용으로 "지금 보여줄 공지"를 get()에서 채워요
    notices: (Array.isArray(c.notices) ? c.notices : []).map(n => cleanNotice(n)).filter(n => n && n.title).slice(0, 30),
    ver: { text: v.text == null ? 'V:B1008' : S.str(v.text, 24), pos: POS.includes(v.pos) ? v.pos : 'acct' },
    // 최소 수심 구역: 공개 수심 자료가 너무 얕게 나오는 곳(예: 샌프란시스코 트레저아일랜드 옆 항로)을 현지 확인 값으로 보정. 원 안 바다는 min m보다 얕지 않게
    depthFix: (Array.isArray(c.depthFix) ? c.depthFix : []).map(f => { f = f || {}; const la = Number(f.la), lo = Number(f.lo), r = Number(f.r), mn = Number(f.min);
      return Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && r >= 50 && r <= 5000 && mn >= 1 && mn <= 100 ? { la: +la.toFixed(5), lo: +lo.toFixed(5), r: Math.round(r), min: Math.round(mn * 10) / 10, name: S.str(f.name, 30) } : null; }).filter(Boolean).slice(0, 40),
    // 수심 보정 끄기(true = 끔): prof 현지 지형(포인트 입력값) · fix 최소 수심 구역 · land 섬·바위 육지(해안선) 표시
    depthOff: { prof: !!(c.depthOff && c.depthOff.prof), fix: !!(c.depthOff && c.depthOff.fix), land: !!(c.depthOff && c.depthOff.land) },
    updated: num(c.updated)
  };
}
async function get() { let c; try { const [v] = await R(['GET', KEY]); c = clean(v ? JSON.parse(v) : {}); } catch (_) { c = clean({}); }
  // 예전 방식(공지 하나)으로 저장돼 있으면 게시판 목록으로 옮겨서 보여줘요(저장은 다음 관리 저장 때)
  if (!c.notices.length && c.notice.title) c.notices = [cleanNotice({ ...c.notice, id: 'legacy', created: c.updated || Date.now(), rev: c.updated || 0 })];
  const a = activeNotice(c.notices, Date.now());
  c.notice = a ? { show: a.show, title: a.title, sub: a.sub, items: a.items, start: a.start, end: a.end, tr: a.tr, id: a.id, rev: a.rev } : { ...c.notice, show: 'off', title: '', sub: '', items: [], tr: {} };
  return c; }
// [ADD] 공지 자동 번역: 제목·부제·항목이 지난번과 같으면 이전 번역을 그대로, 바뀌었으면 DeepL 로 5개 언어를 다시 채워요(키가 없으면 비움)
async function translateNotice(n, prev) {
  const key = JSON.stringify([n.title, n.sub, n.items]);
  if (prev && prev.tr && prev.tr._key === key) return prev.tr;
  const T = require('./_translate'); const tr = { _key: key };
  if (!n.title || !T.hasKey()) return tr;
  const src = T.srcOf(n.title), texts = [n.title, n.sub || '', ...n.items];
  for (const l of T.LANGS) {
    if (l === src) { tr[l] = { title: n.title, sub: n.sub, items: n.items }; continue; }
    const out = await T.translate(texts, l, src, 8000); if (!out || out.length !== texts.length) continue;
    tr[l] = { title: out[0].slice(0, 60), sub: out[1].slice(0, 140), items: out.slice(2).map(x => x.slice(0, 80)) };
  }
  return tr;
}
async function save(input) {
  const prev = await get(); const c = clean(input); c.updated = Date.now();
  if (!Array.isArray(input.notices)) c.notices = prev.notices; // 공지 목록을 안 보낸 저장(버전·수심 설정만)은 목록 유지
  const prevBy = {}; prev.notices.forEach(n => { prevBy[n.id] = n; });
  for (const n of c.notices) { const p = prevBy[n.id]; if (!n.created) n.created = c.updated;
    const changed = !p || JSON.stringify([p.title, p.sub, p.items]) !== JSON.stringify([n.title, n.sub, n.items]); if (changed) n.rev = c.updated; else if (!n.rev) n.rev = p.rev || p.created || c.updated;
    try { n.tr = await translateNotice(n, p); } catch (_) { n.tr = {}; } }
  c.notice = { show: 'off', title: '', sub: '', items: [], start: 0, end: 0, tr: {} }; // 예전 칸은 비워 두고(get()에서 목록으로 채움)
  await R(['SET', KEY, JSON.stringify(c)]); return await get();
}
module.exports = { get, save, clean };
