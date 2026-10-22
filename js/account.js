// [ADD] 간편 로그인(구글·카카오·네이버·메타) + 계정 창 + 포인트 즐겨찾기(★)
//  서버: api/_auth.js (주소 /auth/start/:p, /api/shops?svc=auth&a=…)
//  - 오른쪽 버튼 줄에 사람 아이콘(로그인하면 프로필 사진) → 로그인/내 계정 창
//  - 아래 패널 탭 줄 끝에 ★ → 지금 고른 포인트 즐겨찾기(번호 있는 포인트만). 로그인 안 했으면 로그인 창
(function () {
  const KO = typeof lang === 'undefined' || lang === 'ko';
  const L = typeof lang === 'undefined' ? 'ko' : lang; // [ADD] 언어별 문구(ko · es · zh · 그 외 영어)
  const T_ES = {
    login: 'Iniciar sesión', title: 'Iniciar sesión', sub: 'Guarda tus puntos favoritos y velos en cualquier dispositivo.',
    google: 'Continuar con Google', kakao: 'Continuar con Kakao', naver: 'Continuar con Naver', facebook: 'Continuar con Facebook',
    none: 'El inicio de sesión llegará pronto.', agree: 'Al continuar aceptas la <a href="/privacy/?lang=en" target="_blank" rel="noopener">Política de privacidad</a>.',
    hello: (n) => n, linked: 'Cuentas vinculadas', link: 'Vincular otra cuenta', favs: 'Puntos favoritos', favFull: 'Puedes guardar hasta 30 favoritos. Elimina uno con el icono de papelera primero.', favDel: 'Quitar de favoritos', ok: 'OK', mylogs: 'Mis inmersiones (más recientes primero)', noLog: 'Aún no hay entradas.', more: 'Cargando…', noFav: 'Ninguno todavía. Elige un punto y toca ☆ abajo.',
    logout: 'Cerrar sesión', del: 'Eliminar cuenta', delAsk: '¿Eliminar tu cuenta y favoritos? No se puede deshacer.', close: 'Cerrar',
    favOn: 'Añadido a favoritos', favOff: 'Quitado de favoritos', favNeed: 'Inicia sesión para guardar favoritos', favNo: 'Este punto no se puede guardar',
    lv: (l) => `Nv.${l}`, toNext: (n) => `${n} créditos para el siguiente nivel`, maxLv: 'Nivel máximo', credits: 'Créditos', last: 'Último', admin: 'Admin', creditHint: 'Gana créditos con tu actividad para subir de nivel.',
    nTitle: '📢 Ya puedes registrarte', nSub: 'Inicia sesión con Google, Kakao, Naver o Facebook.',
    nItems: ['Favoritos por punto', 'Puntos y niveles de miembro', 'Bitácora'], nBtn: 'Iniciar sesión', nHide: 'No volver a mostrar',
    err: { cancelled: 'Inicio de sesión cancelado', state: 'La sesión caducó. Inténtalo de nuevo', provider: 'No se pudo iniciar sesión. Inténtalo más tarde', provider_off: 'Este inicio de sesión no está disponible' }
  };
  const T_ZH = {
    login: '登入', title: '登入', sub: '儲存喜愛的潛點，任何裝置都能查看。',
    google: '使用 Google 繼續', kakao: '使用 Kakao 繼續', naver: '使用 Naver 繼續', facebook: '使用 Facebook 繼續',
    none: '登入功能即將推出。', agree: '繼續即表示您同意<a href="/privacy/?lang=en" target="_blank" rel="noopener">隱私權政策</a>。',
    hello: (n) => n, linked: '已連結的登入', link: '連結其他帳號', favs: '我的最愛潛點', favFull: '最多可儲存 30 個最愛。請先用垃圾桶圖示刪除一個。', favDel: '從最愛移除', ok: '確定', mylogs: '我的日誌（最新優先）', noLog: '尚無記錄。', more: '載入中…', noFav: '還沒有。請選擇潛點並點下方的 ☆。',
    logout: '登出', del: '刪除帳號', delAsk: '要刪除帳號與最愛嗎？此操作無法復原。', close: '關閉',
    favOn: '已加入最愛', favOff: '已從最愛移除', favNeed: '登入後才能儲存最愛', favNo: '此點無法儲存',
    lv: (l) => `Lv.${l}`, toNext: (n) => `距下一級還需 ${n} 點`, maxLv: '最高等級', credits: '點數', last: '上次', admin: '管理員', creditHint: '持續活動可累積點數並升級。',
    nTitle: '📢 會員功能上線', nSub: '可用 Google、Kakao、Naver 或 Facebook 登入。',
    nItems: ['各潛點的最愛', '會員點數與等級', '潛水日誌'], nBtn: '登入', nHide: '不再顯示',
    err: { cancelled: '已取消登入', state: '登入逾時，請再試一次', provider: '登入失敗，請稍後再試', provider_off: '目前無法使用此登入方式' }
  };
  const T = L === 'es' ? T_ES : L === 'zh' ? T_ZH : KO ? {
    login: '로그인', title: '간편 로그인', sub: '즐겨찾기한 포인트를 어느 기기에서든 볼 수 있어요.',
    google: 'Google로 계속하기', kakao: '카카오로 계속하기', naver: '네이버로 계속하기', facebook: 'Facebook으로 계속하기',
    none: '로그인 준비 중이에요.', agree: '계속하면 <a href="/privacy/" target="_blank" rel="noopener">개인정보처리방침</a>에 동의하는 것으로 봐요.',
    hello: (n) => `${n}님`, linked: '연결된 로그인', link: '다른 계정 연결', favs: '즐겨찾기 포인트', favFull: '즐겨찾기는 최대 30개까지예요. 목록의 휴지통으로 하나를 지운 뒤 추가해 주세요.', favDel: '즐겨찾기에서 지우기', ok: '확인', mylogs: '내 로그 (최근 순)', noLog: '아직 기록이 없어요.', more: '불러오는 중…', noFav: '아직 없어요. 포인트를 고르고 아래 ☆를 눌러보세요.',
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
    hello: (n) => n, linked: 'Linked accounts', link: 'Link another account', favs: 'Favorite spots', favFull: 'You can save up to 30 favorites. Remove one with the trash icon first.', favDel: 'Remove from favorites', ok: 'OK', mylogs: 'My logs (newest first)', noLog: 'No entries yet.', more: 'Loading…', noFav: 'None yet. Pick a spot and tap ☆ below.',
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
  .a-list{max-height:200px;overflow-y:auto;overscroll-behavior:contain;padding-right:2px} .a-list::-webkit-scrollbar{width:5px} .a-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:3px}
  .a-fav{display:flex;align-items:center;gap:8px} .a-fav .hd{cursor:grab;color:#64748b;font-size:14px;line-height:1;touch-action:none;user-select:none;padding:2px 2px 2px 0} .a-fav .hd:active{cursor:grabbing} .a-fav.drag{opacity:.55;background:#1e2a4a;box-shadow:0 2px 8px rgba(0,0,0,.4)} .a-list.dragging{user-select:none;-webkit-user-select:none;touch-action:none} .a-fav .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .a-log{display:flex;gap:8px;align-items:baseline;width:100%;text-align:left;background:#111a30;border:1px solid rgba(255,255,255,.08);color:#e2e8f0;border-radius:8px;padding:6px 10px;margin:4px 0;cursor:pointer;font-size:12.5px} .a-log b{flex:0 0 auto;color:#FFB000;font-weight:600} .a-log .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .a-log .dt{flex:0 0 auto;color:#94a3b8}
  .a-fav{display:flex;width:100%;text-align:left;background:#111a30;border:1px solid rgba(255,255,255,.08);color:#e2e8f0;border-radius:8px;padding:7px 10px;margin:4px 0;cursor:pointer;font-size:13px}
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
  #sw-ver{position:fixed;bottom:6px;z-index:50;font-size:12.5px;color:rgba(226,232,240,.55);letter-spacing:.4px;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.6)}
  #sw-ver.bl{left:8px} #sw-ver.br{right:8px}
  .a-lv{margin:2px 0 10px;font-size:12px;color:#94a3b8} .a-lv .bar{height:6px;border-radius:99px;background:#1e293b;overflow:hidden;margin:5px 0} .a-lv .bar i{display:block;height:100%;background:linear-gradient(90deg,#38bdf8,#FFB000)}
  .a-lv b{color:#FFB000;font-size:13px}
  .a-adm-s{margin-left:auto;height:28px;line-height:26px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,176,0,.5);color:#FFB000;text-decoration:none;font-weight:700;font-size:12.5px}
  .a-fav .tr{flex:0 0 auto;display:inline-flex;align-items:center;padding:3px;border-radius:6px;color:#94a3b8;cursor:pointer} .a-fav .tr:hover{color:#f87171;background:rgba(248,113,113,.12)}
  #a-pop{position:fixed;inset:0;z-index:4000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)} #a-pop div{background:#0B1120;border:1px solid rgba(255,176,0,.5);border-radius:14px;padding:18px 20px 14px;max-width:min(320px,calc(100vw - 40px));color:#f1f5f9;font-size:14px;line-height:1.5;text-align:center} #a-pop button{margin-top:12px;height:32px;padding:0 22px;border-radius:8px;border:1px solid rgba(255,176,0,.6);background:transparent;color:#FFB000;font-weight:700;cursor:pointer}
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
    try { const j = await fetch('/api/shops?svc=auth&a=me', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.json()); me = { user: j.user || null, favs: j.favs || [], providers: j.providers || [], prefs: j.prefs || {} }; }
    catch (_) {}
    favSet = new Set(me.favs); paintBtn(); paintStar(); paintAdmin(); paintFavBar(); applyPrefs(); await loadSite(); paintVer(); showNotice();
    try { window.dispatchEvent(new Event('otemp:account')); } catch (_) {}
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
    sortedFavs().map(stationByNo).filter(Boolean).forEach(s => chips.push(`<button data-no="${s.no}">★ ${esc(s.name)}</button>`));
    b.innerHTML = me.user ? chips.join('') : '';
    b.classList.toggle('show', !!(me.user && chips.length));
    b.querySelectorAll('button').forEach(x => x.onclick = () => goTo(stationByNo(+x.dataset.no)));
  }
  function goTo(s) { if (!s) return; try { selectStation(s); showDetailMap(s.coords[1], s.coords[0], typeof SPOT_ZOOM === 'number' ? SPOT_ZOOM : 16); } catch (_) {} }

  window.otAccount = { prefs: () => me.prefs, setPrefs: (p) => { if (p) me.prefs = p; }, user: () => me.user, open: () => open(), reload: () => load() }; // 로그북 등 다른 파일이 쓰는 입구

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
  // 즐겨찾기 순서: prefs.favOrder 순 → 나머지는 뒤에
  function sortedFavs() { const ord = (me.prefs && me.prefs.favOrder) || [], rank = (n) => { const i = ord.indexOf(n); return i < 0 ? 1e9 : i; }; return me.favs.slice().sort((a, b) => rank(a) - rank(b)); }
  // 즐겨찾기 끌어서 순서 바꾸기(⋮⋮ 손잡이, 마우스·손가락)
  let dragMoved = false;
  function setupFavDrag(list) {
    if (!list) return;
    list.querySelectorAll('.hd').forEach(hd => hd.addEventListener('pointerdown', (e) => {
      const cur = hd.closest('.a-fav'); if (!cur) return;
      const rows0 = [...list.querySelectorAll('.a-fav')]; if (rows0.length < 2) return;
      // 줄 높이는 모두 같아서, 처음 한 번 잰 "한 칸 높이"로 위치를 계산해요(옮기는 중에 줄이 밀려도 흔들리지 않아요)
      const cs = getComputedStyle(cur), pitch = cur.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0), top0 = rows0[0].getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - (parseFloat(cs.marginTop) || 0);
      cur.classList.add('drag'); list.classList.add('dragging'); dragMoved = false; hd.setPointerCapture(e.pointerId); e.preventDefault();
      let y = e.clientY, raf = 0, idx = rows0.indexOf(cur);
      const tick = () => {
        raf = 0; const r = list.getBoundingClientRect();
        if (y < r.top + 22) list.scrollTop -= 8; else if (y > r.bottom - 22) list.scrollTop += 8; // 가장자리에 대면 자동 스크롤
        const n = rows0.length, t = Math.max(0, Math.min(n - 1, Math.floor((y - r.top + list.scrollTop - top0) / pitch)));
        if (t !== idx) { const rows = [...list.querySelectorAll('.a-fav')].filter(x => x !== cur); list.insertBefore(cur, rows[t] || null); idx = t; dragMoved = true; }
        if (y < r.top + 22 || y > r.bottom - 22) raf = requestAnimationFrame(tick);
      };
      const move = (ev) => { y = ev.clientY; dragMoved = true; if (!raf) raf = requestAnimationFrame(tick); };
      const up = () => {
        hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up);
        if (raf) cancelAnimationFrame(raf); cur.classList.remove('drag'); list.classList.remove('dragging');
        const order = [...list.querySelectorAll('.a-fav')].map(b => +b.dataset.no);
        me.prefs = Object.assign({}, me.prefs, { favOrder: order }); post('prefs', { favOrder: order }).catch(() => {}); paintFavBar(); setTimeout(() => { dragMoved = false; }, 50);
      };
      hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
    }));
  }
  // 내 로그 목록: 최근 순, 5개 높이에 스크롤, 끝에 닿으면 더 불러옴(최대 2000개)
  async function loadLogsInto(list) {
    if (!list) return; const PAGE = 40; let off = 0, total = Infinity, busy = false;
    const row = (e) => { const s = stationByNo(e.no); return `<button class="a-log" data-no="${e.no}"><b>${e.seq ? '#' + e.seq + ' · ' : ''}${esc(e.date || '')}</b><span class="nm">${esc(s ? s.name : '#' + e.no)}</span><span class="dt">${e.depthMax != null ? e.depthMax + 'm' : ''}${e.mins != null ? ' · ' + e.mins + (KO ? '분' : L === 'zh' ? '分鐘' : 'm') : ''}</span></button>`; };
    const more = async () => {
      if (busy || off >= total) return; busy = true;
      try { const j = await post('logs', { no: 0, limit: PAGE, offset: off }); total = j.count != null ? j.count : (j.items || []).length; const sub = list.querySelector('.a-sub'); if (sub) sub.remove();
        if (!off && !(j.items || []).length) { list.innerHTML = `<div class="a-sub">${T.noLog}</div>`; return; }
        list.insertAdjacentHTML('beforeend', (j.items || []).map(row).join('')); off += (j.items || []).length;
        list.querySelectorAll('.a-log').forEach(b => { if (b._on) return; b._on = true; b.onclick = () => { const s = stationByNo(+b.dataset.no); if (!s) return; close(); goTo(s); try { if (typeof setMode === 'function') setTimeout(() => setMode('log'), 400); } catch (_) {} }; });
      } catch (_) { const sub = list.querySelector('.a-sub'); if (sub) sub.remove(); } finally { busy = false; }
    };
    list.addEventListener('scroll', () => { if (list.scrollTop + list.clientHeight >= list.scrollHeight - 24) more(); });
    await more();
  }
  function open() {
    let ov = document.getElementById('acct-ov');
    if (!ov) { ov = document.createElement('div'); ov.id = 'acct-ov'; ov.innerHTML = '<div id="acct-box"></div>'; document.body.appendChild(ov); }
    const box = document.getElementById('acct-box'), avail = ORDER.filter(p => me.providers.includes(p));
    let h = `<button class="a-x" aria-label="${T.close}">×</button>`;
    if (!me.user) {
      h += `<h3>${T.title}</h3><div class="a-sub">${T.sub}</div>` + (avail.length ? pbtns(avail) : `<p>${T.none}</p>`) + `<div class="a-agree">${T.agree}</div>`;
    } else {
      const u = me.user, more = avail.filter(p => !u.providers.includes(p));
      h += `<div class="a-me">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : `<div class="a-ph">${ICON_USER}</div>`}<div><h3>${esc(T.hello(u.name))}</h3></div>${u.role === 'admin' ? `<a class="a-adm-s" href="/admin">${T.admin}</a>` : ''}</div>`;
      if (u.level) {
        const span = u.next ? (u.next - u.base) : 1, pct = u.next ? Math.max(0, Math.min(100, Math.round((u.credits - u.base) / span * 100))) : 100;
        h += `<div class="a-lv"><b>${T.lv(u.level)}</b> · ${u.credits} ${T.credits}<div class="bar"><i style="width:${pct}%"></i></div>${u.next ? T.toNext(u.next - u.credits) : T.maxLv}<br>${T.creditHint}</div>`;
      }
      h += `<div class="a-sec">${T.favs}</div>`;
      const favs = sortedFavs().map(stationByNo).filter(Boolean);
      h += favs.length ? `<div class="a-list" id="a-favs">${favs.map(s => `<button class="a-fav" data-no="${s.no}"><span class="hd">⋮⋮</span><span class="nm">★ ${esc(s.name)}</span><span class="tr" role="button" title="${esc(T.favDel)}" aria-label="${esc(T.favDel)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7"/></svg></span></button>`).join('')}</div>` : `<div class="a-sub">${T.noFav}</div>`;
      h += `<div class="a-sec">${T.mylogs}</div><div class="a-list" id="a-logs"><div class="a-sub">${T.more}</div></div>`;
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
    box.querySelectorAll('.a-fav').forEach(b => b.onclick = async (e) => { if (e.target.closest('.hd') || dragMoved) return; if (e.target.closest('.tr')) { const no = +b.dataset.no; try { await post('fav', { no, on: false }); favSet.delete(no); me.favs = [...favSet]; b.remove(); paintStar(); paintFavBar(); } catch (_) {} return; } const s = stationByNo(+b.dataset.no); if (!s) return; close(); goTo(s); });
    setupFavDrag(box.querySelector('#a-favs'));
    loadLogsInto(box.querySelector('#a-logs'));
    const out = box.querySelector('.a-out'); if (out) out.onclick = async () => { try { await post('logout'); } catch (_) {} close(); await load(); };
    const del = box.querySelector('.a-del'); if (del) del.onclick = async () => { if (!confirm(T.delAsk)) return; try { await post('delete'); } catch (_) {} close(); await load(); };
  }
  // ── 공지 + 소프트웨어 버전: 관리 페이지(/admin → 관리 설정)에서 정한 값을 /api/shops?svc=site 로 받아 와요 ──
  const DEFAULT_SITE = { notice: { show: 'guest', title: '', sub: '', items: [], start: 0, end: 0 }, ver: { text: 'V:B1008', pos: 'acct' }, updated: 0 };
  let site = DEFAULT_SITE;
  async function loadSite() {
    try { const j = await fetch('/api/shops?svc=site', { cache: 'default' }).then(r => r.json()); if (j && j.ok) site = { notice: j.notice || DEFAULT_SITE.notice, ver: j.ver || DEFAULT_SITE.ver, updated: j.updated || 0 }; if (j && j.ok) { window.otDepthFix = j.depthFix || []; window.otDepthOff = j.depthOff || {}; try { window.dispatchEvent(new Event('otemp:site')); } catch (_) {} } } catch (_) {}
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
  function popup(msg) { let d = document.getElementById('a-pop'); if (d) d.remove(); d = document.createElement('div'); d.id = 'a-pop'; d.innerHTML = `<div>${esc(msg)}<br><button type="button">${T.ok}</button></div>`; d.onclick = (e) => { if (e.target === d || e.target.tagName === 'BUTTON') d.remove(); }; document.body.appendChild(d); }
  async function toggleFav() {
    const no = curNo(); if (!no) return toast(T.favNo);
    if (!me.user) { toast(T.favNeed); return open(); }
    const on = !favSet.has(no);
    if (on && favSet.size >= 30) return popup(T.favFull);
    on ? favSet.add(no) : favSet.delete(no); paintStar(); // 먼저 바꿔 보이고, 실패하면 되돌림
    try { const j = await post('fav', { no, on }); me.favs = [...favSet]; paintFavBar(); toast(on ? T.favOn : T.favOff); }
    catch (err) { on ? favSet.delete(no) : favSet.add(no); paintStar(); if (on && err && err.message === 'too_many') popup(T.favFull); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // [CHANGE] 로그인 버튼 위치: 위쪽 줄 내 위치(나침반 모양) 버튼 왼쪽. 없으면 예전처럼 오른쪽 버튼 줄
    const loc = document.getElementById('btn-locate'), ctr = document.querySelector('.map-controls');
    if (loc || ctr) { btn = document.createElement('button'); btn.className = loc ? 'ctrl-btn top-btn' : 'ctrl-btn'; btn.id = 'btn-account'; btn.type = 'button'; btn.style.overflow = 'hidden'; btn.style.padding = '0'; btn.onclick = () => { const o = document.getElementById('acct-ov'); if (o && o.classList.contains('show')) close(); else open(); };
      if (loc) loc.parentNode.insertBefore(btn, loc);
      else { const before = document.getElementById('btn-spot-add'); before ? ctr.insertBefore(btn, before) : ctr.appendChild(btn); }
      paintBtn(); }
    const bar = document.querySelector('.tab-bar');
    if (bar) { star = document.createElement('button'); star.className = 'tab-btn tab-fav'; star.type = 'button'; star.title = KO ? '이 포인트 즐겨찾기' : L === 'es' ? 'Añadir a favoritos' : L === 'zh' ? '加入最愛' : 'Favorite this spot'; star.onclick = toggleFav; bar.appendChild(star); paintStar(); }
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
