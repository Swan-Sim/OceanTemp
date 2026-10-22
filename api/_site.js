// [ADD] 사이트 공지(팝업)·소프트웨어 버전 표시 설정. Redis 키 site:cfg (JSON 한 덩어리).
//  - 공개 읽기: /api/shops?svc=site (api/shops.js, 30초 캐시)  - 저장: 관리 페이지 → api/_admin.js(siteSave)
const S = require('./_store');
const { R } = S;
const KEY = 'site:cfg';
const SHOW = ['off', 'guest', 'all'], POS = ['acct', 'bl', 'br', 'off'];

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
    ver: { text: v.text == null ? 'V:B1008' : S.str(v.text, 24), pos: POS.includes(v.pos) ? v.pos : 'acct' },
    // 최소 수심 구역: 공개 수심 자료가 너무 얕게 나오는 곳(예: 샌프란시스코 트레저아일랜드 옆 항로)을 현지 확인 값으로 보정. 원 안 바다는 min m보다 얕지 않게
    depthFix: (Array.isArray(c.depthFix) ? c.depthFix : []).map(f => { f = f || {}; const la = Number(f.la), lo = Number(f.lo), r = Number(f.r), mn = Number(f.min);
      return Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && r >= 50 && r <= 5000 && mn >= 1 && mn <= 100 ? { la: +la.toFixed(5), lo: +lo.toFixed(5), r: Math.round(r), min: Math.round(mn * 10) / 10, name: S.str(f.name, 30) } : null; }).filter(Boolean).slice(0, 40),
    // 수심 보정 끄기(true = 끔): prof 현지 지형(포인트 입력값) · fix 최소 수심 구역 · land 섬·바위 육지(해안선) 표시
    depthOff: { prof: !!(c.depthOff && c.depthOff.prof), fix: !!(c.depthOff && c.depthOff.fix), land: !!(c.depthOff && c.depthOff.land) },
    updated: num(c.updated)
  };
}
async function get() { try { const [v] = await R(['GET', KEY]); return clean(v ? JSON.parse(v) : {}); } catch (_) { return clean({}); } }
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
  try { c.notice.tr = await translateNotice(c.notice, prev.notice); } catch (_) { c.notice.tr = {}; }
  await R(['SET', KEY, JSON.stringify(c)]); return c;
}
module.exports = { get, save, clean };
