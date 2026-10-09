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
    hello: (n) => `${n}님`, linked: '연결된 로그인', link: '다른 계정 연결', myShops: '내 샵·풀장', ownEdit: '정보 수정', ownAsk: (n) => `가입한 이메일이 '${n}' 등록 이메일과 같아요.\n이 곳의 주인(관리자)이신가요?\n\n확인 = 내 계정에 연결 / 취소 = 아니에요`, ownDone: (n) => `${n}을(를) 내 계정에 연결했어요`, claimLogin: '소유권 주장은 로그인하면 할 수 있어요', claimAsk: (n) => `'${n}'의 주인이신가요?\n관리자가 확인할 수 있게 한 줄 남겨 주세요(직책, 연락처 등)`, claimSent: '보냈어요. 관리자가 확인하면 연결돼요', claimMine: '이미 내 샵이에요', claimHas: '이미 주인이 연결된 곳이에요', claimFail: '보내지 못했어요. 잠시 후 다시 해 주세요', recentLogs: '최근 로그북', noLogs: '아직 쓴 기록이 없어요. 포인트를 고르고 아래 로그북 탭에서 써 보세요.', favs: '즐겨찾기 포인트', noFav: '아직 없어요. 포인트를 고르고 아래 ☆를 눌러보세요.',
    logout: '로그아웃', del: '회원 탈퇴', delAsk: '계정과 즐겨찾기를 모두 지울까요? 되돌릴 수 없어요.', close: '닫기',
    favOn: '즐겨찾기에 넣었어요', favOff: '즐겨찾기에서 뺐어요', favNeed: '즐겨찾기는 로그인하면 쓸 수 있어요', favNo: '이 지점은 즐겨찾기할 수 없어요',
    lv: (l) => `Lv.${l}`, toNext: (n) => `다음 레벨까지 ${n} 크레딧`, maxLv: '최고 레벨', credits: '크레딧', last: '마지막', admin: 'Admin', creditHint: '로그인·즐겨찾기 등 활동하면 크레딧이 쌓이고 레벨이 올라가요.',
    nTitle: '📢 회원가입 기능이 추가됐어요', nSub: '간편 로그인(Google·카카오·네이버·Facebook)으로 가입할 수 있어요.',
    nItems: ['정점별 즐겨찾기', '회원 포인트/등급 기능 추가', '로그북 작성 기능 (준비 중)'], nBtn: '로그인하기', nHide: '다시 보지 않기',
    err: { cancelled: '로그인을 취소했어요', state: '로그인 시간이 지났어요. 다시 시도해 주세요', provider: '로그인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요', provider_off: '지금은 이 로그인을 쓸 수 없어요' }
  } : {
    login: 'Log in', title: 'Sign in', sub: 'Save favorite spots and see them on any device.',
    google: 'Continue with Google', kakao: 'Continue with Kakao', naver: 'Continue with Naver', facebook: 'Continue with Facebook',
    none: 'Sign-in is coming soon.', agree: 'By continuing you agree to the <a href="/privacy/?lang=en" target="_blank" rel="noopener">Privacy Policy</a>.',
    hello: (n) => n, linked: 'Linked accounts', link: 'Link another account', myShops: 'My shops', ownEdit: 'Edit info', ownAsk: (n) => `Your sign-in email matches '${n}'.\nAre you the owner or manager?\n\nOK = link to my account / Cancel = no`, ownDone: (n) => `${n} is now linked to your account`, claimLogin: 'Log in to claim ownership', claimAsk: (n) => `Do you own '${n}'?\nLeave a short note for the admin (your role, contact)`, claimSent: 'Sent. It will be linked after admin review', claimMine: 'Already yours', claimHas: 'This place already has an owner', claimFail: 'Could not send. Please try again', recentLogs: 'Recent logbook', noLogs: 'No entries yet. Pick a spot and open the Logbook tab below.', favs: 'Favorite spots', noFav: 'None yet. Pick a spot and tap ☆ below.',
    logout: 'Log out', del: 'Delete account', delAsk: 'Delete your account and favorites? This cannot be undone.', close: 'Close',
    favOn: 'Added to favorites', favOff: 'Removed from favorites', favNeed: 'Log in to save favorites', favNo: 'This point cannot be saved',
    lv: (l) => `Lv.${l}`, toNext: (n) => `${n} credits to next level`, maxLv: 'Max level', credits: 'Credits', last: 'Last', admin: 'Admin', creditHint: 'Earn credits by being active to level up.',
    nTitle: '📢 Member sign-up is here', nSub: 'Sign in with Google, Kakao, Naver or Facebook.',
    nItems: ['Favorites for each spot', 'Member points & levels', 'Logbook (coming soon)'], nBtn: 'Sign in', nHide: "Don't show again",
    err: { cancelled: 'Sign-in cancelled', state: 'Sign-in expired. Please try again', provider: 'Sign-in failed. Please try again later', provider_off: 'This sign-in is not available' }
  };
  const PNAME = { google: 'Google', kakao: 'Kakao', naver: 'Naver', facebook: 'Facebook' };
  const ORDER = KO ? ['kakao', 'naver', 'google', 'facebook'] : ['google', 'facebook', 'kakao', 'naver'];
  const ICON_USER = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let me = { user: null, favs: [], providers: [], prefs: {} }, favSet = new Set(), prefsApplied = false;

  const css = document.createElement('style');
  css.textContent = `
  .acct-av{width:100%;height:100%;border-radius:6px;object-fit:cover}
  #acct-ov{position:fixed;inset:0;z-index:4000;background:none;display:none;pointer-events:none}
  #acct-ov.show{display:block}
  #acct-box{position:absolute;pointer-events:auto;box-shadow:0 10px 30px rgba(0,0,0,.5);width:340px;max-width:calc(100vw - 24px);max-height:calc(100vh - 90px);overflow:auto;background:#0B1120;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:18px 18px 14px;color:#f1f5f9;font-size:14px}
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
  .tab-btn.tab-fav.on{color:#FFB000}
  #btn-admin{position:fixed;top:12px;left:12px;z-index:57;height:30px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,176,0,.6);background:rgba(11,17,32,.85);color:#FFB000;font-size:12.5px;font-weight:700;letter-spacing:.3px;cursor:pointer;text-decoration:none;display:none;align-items:center;backdrop-filter:blur(6px)}
  #btn-admin.show{display:inline-flex}
  #fav-bar{position:fixed;top:50px;left:12px;right:12px;z-index:55;display:none;gap:6px;overflow-x:auto;pointer-events:none;scrollbar-width:none;padding:2px 0}
  #fav-bar::-webkit-scrollbar{display:none} #fav-bar.show{display:flex}
  #fav-bar button{pointer-events:auto;flex:0 0 auto;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;height:28px;padding:0 11px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(11,17,32,.82);color:#e2e8f0;font-size:12px;cursor:pointer;backdrop-filter:blur(6px)}
  #fav-bar button.last{border-color:rgba(125,211,252,.5);color:#7dd3fc}
  body.detail-mode #fav-bar{top:50px}
  #acct-notice{position:fixed;z-index:3900;width:300px;max-width:calc(100vw - 24px);background:#0B1120;border:1px solid rgba(255,176,0,.45);border-radius:14px;padding:14px 16px 12px;color:#f1f5f9;font-size:13.5px;box-shadow:0 10px 30px rgba(0,0,0,.5);display:none}
  #acct-notice.show{display:block}
  #acct-notice h4{margin:0 0 4px;font-size:15px;padding-right:22px} #acct-notice .n-sub{color:#94a3b8;font-size:12px;margin-bottom:8px}
  #acct-notice ul{margin:0 0 10px;padding-left:18px} #acct-notice li{margin:3px 0}
  #acct-notice .n-x{position:absolute;right:8px;top:6px;background:none;border:0;color:#94a3b8;font-size:20px;cursor:pointer}
  #acct-notice .n-row{display:flex;gap:8px} #acct-notice .n-row button{flex:1;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#cbd5e1;cursor:pointer;font-size:12.5px}
  #acct-notice .n-row .n-go{background:#FFB000;border-color:#FFB000;color:#111;font-weight:700}
  .a-ver{margin-top:12px;text-align:center;font-size:11px;color:#64748b;letter-spacing:.4px}
  #sw-ver{position:fixed;bottom:6px;z-index:50;font-size:10.5px;color:rgba(226,232,240,.55);letter-spacing:.4px;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.6)}
  #sw-ver.bl{left:8px} #sw-ver.br{right:8px}
  .a-lv{margin:2px 0 10px;font-size:12px;color:#94a3b8} .a-lv .bar{height:6px;border-radius:99px;background:#1e293b;overflow:hidden;margin:5px 0} .a-lv .bar i{display:block;height:100%;background:linear-gradient(90deg,#38bdf8,#FFB000)}
  .a-lv b{color:#FFB000;font-size:13px}
  .a-adm{display:block;text-align:center;margin-top:12px;height:34px;line-height:34px;border-radius:8px;border:1px solid rgba(255,176,0,.5);color:#FFB000;text-decoration:none;font-weight:700}`;
  document.head.appendChild(css);

  function toast(msg) { let d = document.getElementById('locate-msg'); if (!d) { d = document.createElement('div'); d.id = 'locate-msg'; document.body.appendChild(d); } d.textContent = msg; d.classList.add('show'); clearTimeout(d._t); d._t = setTimeout(() => d.classList.remove('show'), 3000); }
  const here = () => location.pathname + location.search.replace(/([?&])login_(error|why)=[^&]*&?/g, '$1').replace(/([?&])login_(error|why)=[^&]*&?/g, '$1').replace(/[?&]$/, '');
  const startUrl = (p) => `/auth/start/${p}?next=${encodeURIComponent(here())}`;
  async function post(a, body) {
    const r = await fetch(`/api/shops?svc=auth&a=${a}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || r.status); return j;
  }
  async function load() {
    try { const j = await fetch('/api/shops?svc=auth&a=me', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.json()); me = { user: j.user || null, favs: j.favs || [], providers: j.providers || [], prefs: j.prefs || {}, owned: j.owned || [], ownSuggest: j.ownSuggest || [] }; }
    catch (_) {}
    favSet = new Set(me.favs); paintBtn(); paintStar(); paintAdmin(); paintFavBar(); applyPrefs(); await loadSite(); paintVer(); showNotice();
    try { window.dispatchEvent(new Event('otemp:account')); } catch (_) {}
    askOwner();
  }
  // [ADD] 가입 이메일이 샵·풀장 등록 이메일과 같으면 주인인지 물어보고 연결(아니라고 하면 다시 안 물어봐요)
  let asking = false;
  async function askOwner() {
    if (asking || !me.user || !(me.ownSuggest || []).length) return; asking = true;
    for (const s of me.ownSuggest) {
      const yes = confirm(T.ownAsk(s.name));
      try { await post(yes ? 'ownAccept' : 'ownSkip', { id: s.id }); if (yes) toast(T.ownDone(s.name)); } catch (_) {}
    }
    asking = false; if (me.ownSuggest.length) { me.ownSuggest = []; load(); }
  }
  // [ADD] 지도 샵 팝업의 "소유권 주장"
  async function claimShop(id, name) {
    if (!me.user) { toast(T.claimLogin); return open(); }
    const msg = prompt(T.claimAsk(name), ''); if (msg == null) return;
    try { const j = await post('ownClaim', { id, msg }); toast(j.already ? T.claimMine : T.claimSent); }
    catch (e) { toast(String(e.message) === 'has_owner' ? T.claimHas : T.claimFail); }
  }
  // ── 설정 저장: 온도 단위·마지막으로 본 포인트를 계정에 저장하고 다른 기기에서도 이어서 ──
  function applyPrefs() {
    if (prefsApplied || !me.user) return; prefsApplied = true;
    const u = me.prefs && me.prefs.unit;
    try { if ((u === 'C' || u === 'F') && typeof tempUnit !== 'undefined' && tempUnit !== u && typeof _origToggle === 'function') _origToggle(); } catch (_) {}
  }
  let _origToggle = null, _prefT = null;
  function savePrefs(p) { if (!me.user) return; me.prefs = Object.assign({}, me.prefs, p); clearTimeout(_prefT); _prefT = setTimeout(() => { post('prefs', p).catch(() => {}); }, 800); }
  function paintAdmin() {
    let a = document.getElementById('btn-admin');
    if (!a) { a = document.createElement('a'); a.id = 'btn-admin'; a.href = '/admin'; a.textContent = T.admin; document.body.appendChild(a); }
    a.classList.toggle('show', !!(me.user && me.user.role === 'admin'));
  }
  function paintFavBar() {
    let b = document.getElementById('fav-bar');
    if (!b) { b = document.createElement('div'); b.id = 'fav-bar'; document.body.appendChild(b); }
    const chips = [];
    const last = me.prefs && me.prefs.last && stationByNo(me.prefs.last.no);
    if (last && !favSet.has(last.no)) chips.push(`<button class="last" data-no="${last.no}">⟲ ${T.last}: ${esc(last.name)}</button>`);
    me.favs.map(stationByNo).filter(Boolean).forEach(s => chips.push(`<button data-no="${s.no}">★ ${esc(s.name)}</button>`));
    b.innerHTML = me.user ? chips.join('') : '';
    b.classList.toggle('show', !!(me.user && chips.length));
    b.querySelectorAll('button').forEach(x => x.onclick = () => goTo(stationByNo(+x.dataset.no)));
    // [FIX] 로그인 정보가 포인트 목록보다 먼저 오면 즐겨찾기를 못 찾아 바가 안 보였어요 → 포인트 목록이 올 때까지 다시 그리기
    const want = me.user && (me.favs.length || (me.prefs && me.prefs.last));
    const ready = typeof stations !== 'undefined' && stations && stations.length && me.favs.every(n => stationByNo(n)); // 사용자 등록 포인트는 목록에 늦게 붙어서 다 찾을 때까지
    if (want && !ready) { paintFavBar._n = (paintFavBar._n || 0) + 1; if (paintFavBar._n < 120) setTimeout(paintFavBar, 500); } else paintFavBar._n = 0;
  }
  function goTo(s) { if (!s) return; try { selectStation(s); showDetailMap(s.coords[1], s.coords[0], typeof SPOT_ZOOM === 'number' ? SPOT_ZOOM : 16); } catch (_) {} }

  window.otAccount = { user: () => me.user, open: () => open(), reload: () => load(), claim: (id, name) => claimShop(id, name), owns: (id) => (me.owned || []).some(s => s.id === String(id)) }; // 로그북 등 다른 파일이 쓰는 입구

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
    if (!ov) { ov = document.createElement('div'); ov.id = 'acct-ov'; ov.innerHTML = '<div id="acct-box"></div>'; document.body.appendChild(ov); }
    const box = document.getElementById('acct-box'), avail = ORDER.filter(p => me.providers.includes(p));
    let h = `<button class="a-x" aria-label="${T.close}">×</button>`;
    if (!me.user) {
      h += `<h3>${T.title}</h3><div class="a-sub">${T.sub}</div>` + (avail.length ? pbtns(avail) : `<p>${T.none}</p>`) + `<div class="a-agree">${T.agree}</div>`;
    } else {
      const u = me.user, more = avail.filter(p => !u.providers.includes(p));
      h += `<div class="a-me">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : `<div class="a-ph">${ICON_USER}</div>`}<div><h3>${esc(T.hello(u.name))}</h3></div></div>`;
      if (u.level) {
        const span = u.next ? (u.next - u.base) : 1, pct = u.next ? Math.max(0, Math.min(100, Math.round((u.credits - u.base) / span * 100))) : 100;
        h += `<div class="a-lv"><b>${T.lv(u.level)}</b> · ${u.credits} ${T.credits}<div class="bar"><i style="width:${pct}%"></i></div>${u.next ? T.toNext(u.next - u.credits) : T.maxLv}<br>${T.creditHint}</div>`;
      }
      if (u.role === 'admin') h += `<a class="a-adm" href="/admin">${T.admin}</a>`;
      h += `<div class="a-sec">${T.favs}</div>`;
      const favs = me.favs.map(stationByNo).filter(Boolean);
      h += favs.length ? favs.map(s => `<button class="a-fav" data-no="${s.no}">★ ${esc(s.name)}</button>`).join('') : `<div class="a-sub">${T.noFav}</div>`;
      if ((me.owned || []).length) h += `<div class="a-sec">${T.myShops}</div>` + me.owned.map(s => `<button class="a-fav" data-own="${esc(s.id)}">${s.type === 'pool' ? '🏊' : s.type === 'liveaboard' ? '🚢' : '🏪'} ${esc(s.name)} <span style="color:#7dd3fc">· ${T.ownEdit}</span></button>`).join(''); // [ADD] 내 샵·풀장
      h += `<div class="a-sec">${T.recentLogs}</div><div id="a-logs"><div class="a-sub">…</div></div>`; // [ADD] 로그북 최신 3개
      h += `<div class="a-sec">${T.linked}</div><div class="a-tags">${u.providers.map(p => `<span>${PNAME[p] || p}</span>`).join('')}</div>`;
      if (more.length) h += `<div class="a-sec">${T.link}</div><div class="a-small">${pbtns(more)}</div>`;
      h += `<div class="a-row"><button class="a-out">${T.logout}</button><button class="a-del">${T.del}</button></div>`;
    }
    if (verText() && site.ver.pos === 'acct') h += `<div class="a-ver">${esc(verText())}</div>`;
    hideNotice(); box.innerHTML = h; ov.classList.add('show');
    // 사용자 버튼 바로 아래에 드롭다운으로 열기(화면을 어둡게 하지 않음)
    const r = btn ? btn.getBoundingClientRect() : { bottom: 56, right: window.innerWidth - 12 };
    const bw = Math.min(340, window.innerWidth - 24), lx = r.left != null ? r.left : window.innerWidth - bw - 12; // 버튼 왼쪽 끝에 맞춰 오른쪽으로 펼치고, 화면 밖으로 나가면 안으로 당김
    box.style.top = Math.round(r.bottom + 8) + 'px'; box.style.right = 'auto'; box.style.left = Math.max(12, Math.min(Math.round(lx), window.innerWidth - bw - 12)) + 'px';
    if (!open._hooked) { open._hooked = true;
      document.addEventListener('pointerdown', (e) => { const o = document.getElementById('acct-ov'); if (!o || !o.classList.contains('show')) return; if (e.target.closest('#acct-box') || (btn && btn.contains(e.target))) return; close(); }, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }); }
    box.querySelector('.a-x').onclick = close;
    box.querySelectorAll('.a-fav').forEach(b => b.onclick = () => { const s = stationByNo(+b.dataset.no); if (!s) return; close(); goTo(s); });
    box.querySelectorAll('[data-own]').forEach(b => b.onclick = async () => {
      const w = window.open('about:blank', '_blank'); // 팝업 차단 피하려고 먼저 열기
      try { const j = await post('ownEdit', { id: b.dataset.own }); if (w) w.location = j.url; else location.href = j.url; } catch (_) { if (w) w.close(); toast(T.claimFail); } });
    const lb = box.querySelector('#a-logs');
    if (lb) post('logs', { limit: 3 }).then(j => {
      const it = (j.items || []).slice(0, 3);
      lb.innerHTML = it.length ? it.map(e => { const s = stationByNo(e.no);
        return `<button class="a-fav" data-log="${e.no}">📘 ${esc(e.date)}${e.tod ? ' ' + esc(e.tod) : ''} · ${esc(s ? s.name : '#' + e.no)}<span style="color:#94a3b8">${e.depthMax != null ? ' · ' + e.depthMax + 'm' : ''}${e.mins != null ? ' · ' + e.mins + (KO ? '분' : ' min') : ''}${e.temp != null ? ' · ' + e.temp + '°C' : ''}</span></button>`; }).join('') : `<div class="a-sub">${T.noLogs}</div>`;
      lb.querySelectorAll('[data-log]').forEach(b => b.onclick = () => { const s = stationByNo(+b.dataset.log); if (!s) return; close(); goTo(s); setTimeout(() => { try { setMode('log'); } catch (_) {} }, 300); });
    }).catch(() => { lb.innerHTML = ''; });
    const out = box.querySelector('.a-out'); if (out) out.onclick = async () => { try { await post('logout'); } catch (_) {} close(); await load(); };
    const del = box.querySelector('.a-del'); if (del) del.onclick = async () => { if (!confirm(T.delAsk)) return; try { await post('delete'); } catch (_) {} close(); await load(); };
  }
  // ── 공지 + 소프트웨어 버전: 관리 페이지(/admin → 관리 설정)에서 정한 값을 /api/shops?svc=site 로 받아 와요 ──
  const DEFAULT_SITE = { notice: { show: 'guest', title: '', sub: '', items: [], start: 0, end: 0 }, ver: { text: 'V:B1008', pos: 'acct' }, updated: 0 };
  let site = DEFAULT_SITE;
  async function loadSite() {
    try { const j = await fetch('/api/shops?svc=site', { cache: 'default' }).then(r => r.json()); if (j && j.ok) site = { notice: j.notice || DEFAULT_SITE.notice, ver: j.ver || DEFAULT_SITE.ver, updated: j.updated || 0 }; if (j && j.ok) { window.otDepthFix = j.depthFix || []; try { window.dispatchEvent(new Event('otemp:site')); } catch (_) {} } } catch (_) {}
  }
  const verText = () => (site.ver && site.ver.text) || '';
  function paintVer() { // 화면 모서리에 표시하는 경우
    let v = document.getElementById('sw-ver'); const pos = site.ver && site.ver.pos, t = verText();
    if (!t || (pos !== 'bl' && pos !== 'br')) { if (v) v.style.display = 'none'; return; }
    if (!v) { v = document.createElement('div'); v.id = 'sw-ver'; document.body.appendChild(v); }
    v.textContent = t; v.className = pos; v.style.display = '';
  }
  const noticeId = () => 'n-' + (site.updated || 'default');
  const nGet = () => { try { return localStorage.getItem(noticeId()); } catch (_) { return null; } };
  const nSet = (v) => { try { localStorage.setItem(noticeId(), v); } catch (_) {} };
  function placeNotice(n) {
    const r = btn ? btn.getBoundingClientRect() : { bottom: 56, left: window.innerWidth - 312 }, bw = Math.min(300, window.innerWidth - 24);
    n.style.top = Math.round(r.bottom + 8) + 'px'; n.style.left = Math.max(12, Math.min(Math.round(r.left), window.innerWidth - bw - 12)) + 'px';
  }
  function showNotice() {
    const c = site.notice || DEFAULT_SITE.notice, now = Date.now();
    let n = document.getElementById('acct-notice');
    const hideIt = () => { if (n) n.classList.remove('show'); };
    if (c.show === 'off' || (c.show === 'guest' && me.user) || (c.start && now < c.start) || (c.end && now > c.end) || nGet()) return hideIt();
    const title = c.title || T.nTitle, sub = c.title ? c.sub : T.nSub, items = c.title ? c.items : T.nItems;
    if (!n) { n = document.createElement('div'); n.id = 'acct-notice'; document.body.appendChild(n); window.addEventListener('resize', () => placeNotice(n)); }
    n.innerHTML = `<button class="n-x" aria-label="${T.close}">×</button><h4>${esc(title)}</h4>${sub ? `<div class="n-sub">${esc(sub)}</div>` : ''}<ul>${(items || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="n-row"><button class="n-hide">${T.nHide}</button>${me.user ? '' : `<button class="n-go">${T.nBtn}</button>`}</div>`;
    const hide = (perm) => { n.classList.remove('show'); if (perm) nSet('1'); };
    n.querySelector('.n-x').onclick = () => hide(false);
    n.querySelector('.n-hide').onclick = () => hide(true);
    const go = n.querySelector('.n-go'); if (go) go.onclick = () => { hide(true); open(); };
    placeNotice(n); n.classList.add('show');
  }
  function close() { const ov = document.getElementById('acct-ov'); if (ov) ov.classList.remove('show'); }
  function hideNotice() { const n = document.getElementById('acct-notice'); if (n) n.classList.remove('show'); }

  // ── ★ 즐겨찾기 ──
  let star;
  const curNo = () => (typeof selectedStation !== 'undefined' && selectedStation && selectedStation.no) || null;
  function paintStar() { if (!star) return; const no = curNo(); star.style.display = no ? '' : 'none'; const on = !!(no && favSet.has(no)); star.classList.toggle('on', on); star.textContent = on ? '★' : '☆'; }
  async function toggleFav() {
    const no = curNo(); if (!no) return toast(T.favNo);
    if (!me.user) { toast(T.favNeed); return open(); }
    const on = !favSet.has(no);
    on ? favSet.add(no) : favSet.delete(no); paintStar(); // 먼저 바꿔 보이고, 실패하면 되돌림
    try { const j = await post('fav', { no, on }); me.favs = [...favSet]; paintFavBar(); toast(on ? T.favOn : T.favOff); }
    catch (_) { on ? favSet.delete(no) : favSet.add(no); paintStar(); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // [CHANGE] 로그인 버튼 위치: 위쪽 줄 내 위치(나침반 모양) 버튼 왼쪽. 없으면 예전처럼 오른쪽 버튼 줄
    const loc = document.getElementById('btn-locate'), ctr = document.querySelector('.map-controls');
    if (loc || ctr) { btn = document.createElement('button'); btn.className = loc ? 'ctrl-btn top-btn' : 'ctrl-btn'; btn.id = 'btn-account'; btn.type = 'button'; btn.style.overflow = 'hidden'; btn.style.padding = '0'; btn.onclick = () => { const o = document.getElementById('acct-ov'); if (o && o.classList.contains('show')) close(); else open(); };
      if (loc) loc.parentNode.insertBefore(btn, loc);
      else { const before = document.getElementById('btn-spot-add'); before ? ctr.insertBefore(btn, before) : ctr.appendChild(btn); }
      paintBtn(); }
    const bar = document.querySelector('.tab-bar');
    if (bar) { star = document.createElement('button'); star.className = 'tab-btn tab-fav'; star.type = 'button'; star.title = KO ? '이 포인트 즐겨찾기' : 'Favorite this spot'; star.onclick = toggleFav; bar.appendChild(star); paintStar(); }
    // 고른 포인트가 바뀌면 ★ 다시 그리기
    if (typeof selectStation === 'function') { const orig = selectStation; selectStation = function (st, o) { const r = orig.apply(this, arguments); paintStar(); if (st && st.no && me.user) savePrefs({ last: { no: st.no } }); return r; }; }
    if (typeof toggleTempUnit === 'function') { _origToggle = toggleTempUnit; toggleTempUnit = function () { const r = _origToggle.apply(this, arguments); savePrefs({ unit: tempUnit }); return r; }; }
    // 로그인 실패하고 돌아왔으면 안내
    const m = location.search.match(/[?&]login_error=([a-z_]+)/);
    const why = (location.search.match(/[?&]login_why=([A-Za-z0-9_]+)/) || [])[1]; // [ADD] 원인 코드(예: KOE010)
    if (m) { toast((T.err[m[1]] || T.err.provider) + (why ? ` (${why})` : '')); if (why) console.warn('[login] 실패 원인:', why); history.replaceState(null, '', here()); }
    load();
  });
})();
