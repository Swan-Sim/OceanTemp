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
      start: num(n.start), end: num(n.end)                           // 노출 기간(밀리초, 0이면 제한 없음)
    },
    ver: { text: v.text == null ? 'V:B1008' : S.str(v.text, 24), pos: POS.includes(v.pos) ? v.pos : 'acct' },
    updated: num(c.updated)
  };
}
async function get() { try { const [v] = await R(['GET', KEY]); return clean(v ? JSON.parse(v) : {}); } catch (_) { return clean({}); } }
async function save(input) { const c = clean(input); c.updated = Date.now(); await R(['SET', KEY, JSON.stringify(c)]); return c; }
module.exports = { get, save, clean };
