// [ADD] 간편 로그인(구글·카카오·네이버·메타) + 계정 창 + 포인트 즐겨찾기(★)
//  서버: api/_auth.js (주소 /auth/start/:p, /api/shops?svc=auth&a=…)
//  - 오른쪽 버튼 줄에 사람 아이콘(로그인하면 프로필 사진) → 로그인/내 계정 창
//  - 아래 패널 탭 줄 끝에 ★ → 지금 고른 포인트 즐겨찾기(번호 있는 포인트만). 로그인 안 했으면 로그인 창
(function () {
  const KO = typeof lang === 'undefined' || lang === 'ko';
  const T = KO ? {
    login: '로그인', title: '간편 로그인', sub: '즐겨찾기한 포인트를 어느 기기에서든 볼 수 있어요.',
    google: 'Google로 계속하기', kakao: '카카오로 계속하기', naver: '네이버로 계속하기', facebook: 'Facebook으로 계속하기',
    none: '로그인 준비 중이에요.', agree: '계속하면 <a href="/privacy/" target="_blank" rel="noopener">개인정보처리방침</a>에 동의하는 것으로 봐요.',
    hello: (n) => `${n}님`, linked: '연결된 로그인', link: '다른 계정 연결', favs: '즐겨찾기 포인트', noFav: '아직 없어요. 포인트를 고르고 아래 ☆를 눌러보세요.',
    logout: '로그아웃', del: '회원 탈퇴', delAsk: '계정과 즐겨찾기를 모두 지울까요? 되돌릴 수 없어요.', close: '닫기',
    favOn: '즐겨찾기에 넣었어요', favOff: '즐겨찾기에서 뺐어요', favNeed: '즐겨찾기는 로그인하면 쓸 수 있어요', favNo: '이 지점은 즐겨찾기할 수 없어요',
    err: { cancelled: '로그인을 취소했어요', state: '로그인 시간이 지났어요. 다시 시도해 주세요', provider: '로그인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요', provider_off: '지금은 이 로그인을 쓸 수 없어요' }
  } : {
    login: 'Log in', title: 'Sign in', sub: 'Save favorite spots and see them on any device.',
    google: 'Continue with Google', kakao: 'Continue with Kakao', naver: 'Continue with Naver', facebook: 'Continue with Facebook',
    none: 'Sign-in is coming soon.', agree: 'By continuing you agree to the <a href="/privacy/?lang=en" target="_blank" rel="noopener">Privacy Policy</a>.',
    hello: (n) => n, linked: 'Linked accounts', link: 'Link another account', favs: 'Favorite spots', noFav: 'None yet. Pick a spot and tap ☆ below.',
    logout: 'Log out', del: 'Delete account', delAsk: 'Delete your account and favorites? This cannot be undone.', close: 'Close',
    favOn: 'Added to favorites', favOff: 'Removed from favorites', favNeed: 'Log in to save favorites', favNo: 'This point cannot be saved',
    err: { cancelled: 'Sign-in cancelled', state: 'Sign-in expired. Please try again', provider: 'Sign-in failed. Please try again later', provider_off: 'This sign-in is not available' }
  };
  const PNAME = { google: 'Google', kakao: 'Kakao', naver: 'Naver', facebook: 'Facebook' };
  const ORDER = KO ? ['kakao', 'naver', 'google', 'facebook'] : ['google', 'facebook', 'kakao', 'naver'];
  const ICON_USER = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let me = { user: null, favs: [], providers: [] }, favSet = new Set();

  const css = document.createElement('style');
  css.textContent = `
  .acct-av{width:100%;height:100%;border-radius:6px;object-fit:cover}
  #acct-ov{position:fixed;inset:0;z-index:4000;background:rgba(2,6,16,.6);display:none;align-items:center;justify-content:center;padding:16px}
  #acct-ov.show{display:flex}
  #acct-box{width:100%;max-width:360px;max-height:86vh;overflow:auto;background:#0B1120;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:18px 18px 14px;color:#f1f5f9;font-size:14px;position:relative}
  #acct-box h3{margin:0 0 4px;font-size:17px} #acct-box .a-sub{color:#94a3b8;font-size:12.5px;margin-bottom:14px}
  #acct-box .a-x{position:absolute;right:10px;top:8px;background:none;border:0;color:#94a3b8;font-size:20px;cursor:pointer}
  .a-pbtn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;border-radius:10px;border:0;margin:8px 0;font-size:14.5px;font-weight:600;cursor:pointer;text-decoration:none}
  .a-pbtn b{font-size:15px} .a-google{background:#fff;color:#1f1f1f} .a-kakao{background:#FEE500;color:rgba(0,0,0,.85)} .a-naver{background:#03C75A;color:#fff} .a-facebook{background:#1877F2;color:#fff}
  .a-small .a-pbtn{height:34px;font-size:12.5px;margin:5px 0}
  #acct-box .a-agree{color:#64748b;font-size:11.5px;margin-top:10px} #acct-box .a-agree a{color:#94a3b8}
  .a-me{display:flex;align-items:center;gap:10px;margin-bottom:12px} .a-me img{width:42px;height:42px;border-radius:50%;object-fit:cover} .a-me .a-ph{width:42px;height:42px;border-radius:50%;background:#1e293b;display:flex;align-items:center;justify-content:center}
  .a-sec{font-size:12px;color:#ffd27a;margin:12px 0 4px} .a-tags span{display:inline-block;font-size:11.5px;border:1px solid rgba(255,255,255,.15);border-radius:999px;padding:1px 8px;margin:0 4px 4px 0;color:#cbd5e1}
  .a-fav{display:block;width:100%;text-align:left;background:#111a30;border:1px solid rgba(255,255,255,.08);color:#e2e8f0;border-radius:8px;padding:7px 10px;margin:4px 0;cursor:pointer;font-size:13px}
  .a-row{display:flex;gap:8px;margin-top:14px} .a-row button{flex:1;height:34px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#e2e8f0;cursor:pointer}
  .a-row .a-del{color:#f87171;border-color:rgba(248,113,113,.35)}
  .tab-btn.tab-fav{flex:0 0 auto;min-width:38px;padding:0 10px;font-size:16px;line-height:1}
  .tab-btn.tab-fav.on{color:#FFB000}`;
  document.head.appendChild(css);

  function toast(msg) { let d = document.getElementById('locate-msg'); if (!d) { d = document.createElement('div'); d.id = 'locate-msg'; document.body.appendChild(d); } d.textContent = msg; d.classList.add('show'); clearTimeout(d._t); d._t = setTimeout(() => d.classList.remove('show'), 3000); }
  const here = () => location.pathname + location.search.replace(/([?&])login_(error|why)=[^&]*&?/g, '$1').replace(/([?&])login_(error|why)=[^&]*&?/g, '$1').replace(/[?&]$/, '');
  const startUrl = (p) => `/auth/start/${p}?next=${encodeURIComponent(here())}`;
  async function post(a, body) {
    const r = await fetch(`/api/shops?svc=auth&a=${a}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || r.status); return j;
  }
  async function load() {
    try { const j = await fetch('/api/shops?svc=auth&a=me', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.json()); me = { user: j.user || null, favs: j.favs || [], providers: j.providers || [] }; }
    catch (_) {}
    favSet = new Set(me.favs); paintBtn(); paintStar();
  }

  // ── 오른쪽 버튼 ──
  let btn;
  function paintBtn() {
    if (!btn) return;
    btn.title = me.user ? me.user.name : T.login;
    btn.innerHTML = me.user && me.user.avatar ? `<img class="acct-av" src="${esc(me.user.avatar)}" alt="" referrerpolicy="no-referrer">` : ICON_USER;
    btn.style.color = me.user ? '#FFB000' : '';
  }

  // ── 창 ──
  const pbtns = (list) => list.map(p => `<a class="a-pbtn a-${p}" href="${startUrl(p)}"><b>${p === 'google' ? 'G' : p === 'kakao' ? '●' : p === 'naver' ? 'N' : 'f'}</b>${T[p]}</a>`).join('');
  function stationByNo(no) { return (typeof stations !== 'undefined' ? stations : []).find(s => s.no === no); }
  function open() {
    let ov = document.getElementById('acct-ov');
    if (!ov) { ov = document.createElement('div'); ov.id = 'acct-ov'; ov.innerHTML = '<div id="acct-box"></div>'; document.body.appendChild(ov); ov.addEventListener('click', (e) => { if (e.target === ov) close(); }); }
    const box = document.getElementById('acct-box'), avail = ORDER.filter(p => me.providers.includes(p));
    let h = `<button class="a-x" aria-label="${T.close}">×</button>`;
    if (!me.user) {
      h += `<h3>${T.title}</h3><div class="a-sub">${T.sub}</div>` + (avail.length ? pbtns(avail) : `<p>${T.none}</p>`) + `<div class="a-agree">${T.agree}</div>`;
    } else {
      const u = me.user, more = avail.filter(p => !u.providers.includes(p));
      h += `<div class="a-me">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : `<div class="a-ph">${ICON_USER}</div>`}<div><h3>${esc(T.hello(u.name))}</h3></div></div>`;
      h += `<div class="a-sec">${T.favs}</div>`;
      const favs = me.favs.map(stationByNo).filter(Boolean);
      h += favs.length ? favs.map(s => `<button class="a-fav" data-no="${s.no}">★ ${esc(s.name)}</button>`).join('') : `<div class="a-sub">${T.noFav}</div>`;
      h += `<div class="a-sec">${T.linked}</div><div class="a-tags">${u.providers.map(p => `<span>${PNAME[p] || p}</span>`).join('')}</div>`;
      if (more.length) h += `<div class="a-sec">${T.link}</div><div class="a-small">${pbtns(more)}</div>`;
      h += `<div class="a-row"><button class="a-out">${T.logout}</button><button class="a-del">${T.del}</button></div>`;
    }
    box.innerHTML = h; ov.classList.add('show');
    box.querySelector('.a-x').onclick = close;
    box.querySelectorAll('.a-fav').forEach(b => b.onclick = () => { const s = stationByNo(+b.dataset.no); if (!s) return; close(); try { selectStation(s); showDetailMap(s.coords[1], s.coords[0], typeof SPOT_ZOOM === 'number' ? SPOT_ZOOM : 16); } catch (_) {} });
    const out = box.querySelector('.a-out'); if (out) out.onclick = async () => { try { await post('logout'); } catch (_) {} close(); await load(); };
    const del = box.querySelector('.a-del'); if (del) del.onclick = async () => { if (!confirm(T.delAsk)) return; try { await post('delete'); } catch (_) {} close(); await load(); };
  }
  function close() { const ov = document.getElementById('acct-ov'); if (ov) ov.classList.remove('show'); }

  // ── ★ 즐겨찾기 ──
  let star;
  const curNo = () => (typeof selectedStation !== 'undefined' && selectedStation && selectedStation.no) || null;
  function paintStar() { if (!star) return; const no = curNo(); star.style.display = no ? '' : 'none'; const on = !!(no && favSet.has(no)); star.classList.toggle('on', on); star.textContent = on ? '★' : '☆'; }
  async function toggleFav() {
    const no = curNo(); if (!no) return toast(T.favNo);
    if (!me.user) { toast(T.favNeed); return open(); }
    const on = !favSet.has(no);
    on ? favSet.add(no) : favSet.delete(no); paintStar(); // 먼저 바꿔 보이고, 실패하면 되돌림
    try { await post('fav', { no, on }); me.favs = [...favSet]; toast(on ? T.favOn : T.favOff); }
    catch (_) { on ? favSet.delete(no) : favSet.add(no); paintStar(); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // [CHANGE] 로그인 버튼 위치: 위쪽 줄 내 위치(나침반 모양) 버튼 왼쪽. 없으면 예전처럼 오른쪽 버튼 줄
    const loc = document.getElementById('btn-locate'), ctr = document.querySelector('.map-controls');
    if (loc || ctr) { btn = document.createElement('button'); btn.className = loc ? 'ctrl-btn top-btn' : 'ctrl-btn'; btn.id = 'btn-account'; btn.type = 'button'; btn.style.overflow = 'hidden'; btn.style.padding = '0'; btn.onclick = open;
      if (loc) loc.parentNode.insertBefore(btn, loc);
      else { const before = document.getElementById('btn-spot-add'); before ? ctr.insertBefore(btn, before) : ctr.appendChild(btn); }
      paintBtn(); }
    const bar = document.querySelector('.tab-bar');
    if (bar) { star = document.createElement('button'); star.className = 'tab-btn tab-fav'; star.type = 'button'; star.title = KO ? '이 포인트 즐겨찾기' : 'Favorite this spot'; star.onclick = toggleFav; bar.appendChild(star); paintStar(); }
    // 고른 포인트가 바뀌면 ★ 다시 그리기
    if (typeof selectStation === 'function') { const orig = selectStation; selectStation = function (st, o) { const r = orig.apply(this, arguments); paintStar(); return r; }; }
    // 로그인 실패하고 돌아왔으면 안내
    const m = location.search.match(/[?&]login_error=([a-z_]+)/);
    const why = (location.search.match(/[?&]login_why=([A-Za-z0-9_]+)/) || [])[1]; // [ADD] 원인 코드(예: KOE010)
    if (m) { toast((T.err[m[1]] || T.err.provider) + (why ? ` (${why})` : '')); if (why) console.warn('[login] 실패 원인:', why); history.replaceState(null, '', here()); }
    load();
  });
})();
