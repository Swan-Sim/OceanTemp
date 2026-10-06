    // [ADD] 다이빙샵(제휴) - "다이빙샵" 탭(A) + 아래 정보 줄의 한 줄 바로가기(B)
    //  - 샵 목록은 /api/shops (구글 시트 "샵" 탭). 샵의 spots 칸에 적힌 정점 번호(no)마다 보여요.
    //  - 순서: 유료 샵을 섞어서 먼저, 그다음 무료(지인) 샵. 정점을 새로 열 때마다 다시 섞어서 돌아가며 보여줘요.
    //  - 한 줄 바로가기에는 유료 샵 중 한 곳(없으면 무료 샵 중 한 곳)이 나와요.
    //  - 전화·카톡 등 버튼을 누르면 /api/shops?svc=click 으로 숫자만 올려요(개인정보 없음) → /admin 에서 확인.
    let shopList = null, shopLoad = null, footText = '';
    const shopEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const SHOP_ICON = {
      tel: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg>',
      kakao: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.8 5.3 4.6 6.7L5.6 21l4-2.4c.8.1 1.6.2 2.4.2 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>',
      whatsapp: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.2-.8-2.7-1.1-4.4-3.9-4.5-4.1-.1-.2-1.1-1.4-1.1-2.7s.7-1.9.9-2.2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 1.9 1.1.9 2 1.2 2.3 1.4.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.5.3.1.1.1.6-.1 1.2z"/></svg>',
      instagram: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg>',
      web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
    };

    function loadShops() {
      if (shopList) return Promise.resolve(shopList);
      if (!shopLoad) {
        shopLoad = (/^https?:$/.test(location.protocol) ? fetch('/api/shops').then(r => r.json()) : Promise.resolve({ shops: [] }))
          .then(j => { shopList = (j && j.shops) || []; return shopList; })
          .catch(e => { console.warn('[shops] 다이빙샵 목록 실패:', e.message); shopList = []; return shopList; })
          .then(list => { if (selectedStation) { updateShopUI(selectedStation); setFootInfo(footText); } return list; });
      }
      return shopLoad;
    }

    // [ADD] 언어 코드("ko,en") → 그 언어 이름(한국어 · English). 예전 글자 입력은 그대로
    function langLabel(v) {
      if (!/^[a-z]{2,3}(,[a-z]{2,3})*$/.test(v || '')) return v || '';
      return v.split(',').map(c => { try { const n = new Intl.DisplayNames([c], { type: 'language' }).of(c); return n ? n.charAt(0).toUpperCase() + n.slice(1) : c; } catch (_) { return c; } }).join(' · ');
    }
    const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    // 이 정점의 샵(유료 섞어서 먼저 → 무료). 정점마다 한 번 정한 순서를 쓰고, 새로 열면 다시 섞음
    function shopsFor(st) {
      if (!st || !st.isBeach || !st.no || !shopList || !shopList.length) return [];
      if (!st._shopOrder) {
        const mine = shopList.filter(s => s.spots.includes(st.no));
        st._shopOrder = [...shuffle(mine.filter(s => s.paid)), ...shuffle(mine.filter(s => !s.paid))];
      }
      return st._shopOrder;
    }

    // 탭 버튼(샵이 있는 정점에서만 보임) + 샵 탭에 있다가 샵 없는 정점으로 가면 실시간 현황으로
    function updateShopUI(st, reshuffle) {
      if (st && reshuffle) st._shopOrder = null;
      const btn = document.getElementById('btn-shop');
      const n = shopsFor(st).length;
      const beach = !!(st && st.isBeach && st.no);
      if (btn) {
        btn.style.display = beach ? '' : 'none'; // [CHANGE] 해변 정점이면 항상 보임 - 샵이 없으면 "샵 등록" 안내
        btn.innerHTML = `${shopEsc(t.tabShop || '샵')}${n ? `<span class="tab-n">${n}</span>` : ''}`;
      }
      if (!beach && activeMode === 'shop') setMode('now');
    }

    function shopLinks(s) {
      const L = [];
      if (s.phone) L.push(['tel', `tel:${s.phone}`, t.shopCall || '전화']);
      if (s.kakao) L.push(['kakao', s.kakao, t.shopKakao || '카톡']);
      if (s.whatsapp) L.push(['whatsapp', s.whatsapp, 'WhatsApp']);
      if (s.instagram) L.push(['instagram', s.instagram, t.shopInsta || '인스타']);
      if (s.web) L.push(['web', s.web, t.shopWeb || '웹']);
      return L;
    }
    const linkAttrs = (s, k, href) => `href="${shopEsc(href)}" data-shop="${shopEsc(s.id)}" data-shop-k="${k}"${k === 'tel' ? '' : ' target="_blank" rel="noopener"'}`;

    // A. 다이빙샵 탭
    function renderShopTab(box) {
      const list = shopsFor(selectedStation);
      const reg = `<a class="shop-reg" href="/shop/?spot=${encodeURIComponent(selectedStation && selectedStation.no || '')}" target="_blank" rel="noopener">＋ ${shopEsc(t.shopRegister || '샵 등록하기')}</a>`;
      if (!list.length) { box.innerHTML = `<div class="shop-empty"><p>${shopEsc(t.shopEmpty || '아직 이 포인트에 등록된 제휴 샵이 없어요.')}</p>${reg}</div>`; return; }
      sendImps(list);
      box.innerHTML = `<div class="shop-note"><span>${shopEsc(t.shopPartnerOnly || '제휴 샵만 보여요')}</span><i>${shopEsc(t.shopMayChange || '정보가 바뀌었을 수 있어요')}</i></div>` +
        list.map(s => `<div class="shop-card">
          <div class="shop-top"><span class="shop-name">${shopEsc(s.name)}</span><span class="shop-badge">${shopEsc(t.shopPartner || '제휴')}</span>${s.type === 'liveaboard' ? `<span class="shop-lang">${shopEsc(t.shopLiveaboard || 'Liveaboard')}</span>` : ''}${s.lang ? `<span class="shop-lang">${shopEsc(langLabel(s.lang))}</span>` : ''}</div>
          ${s.note ? `<div class="shop-desc">${shopEsc(s.note)}</div>` : ''}
          ${s.address ? `<a class="shop-addr" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}" data-shop="${shopEsc(s.id)}" data-shop-k="map" target="_blank" rel="noopener">${shopEsc(s.address)}</a>` : ''}
          <div class="shop-btns">${shopLinks(s).map(([k, href, label]) => `<a class="shop-btn${k === 'tel' ? ' call' : ''}" ${linkAttrs(s, k, href)}>${SHOP_ICON[k]}<span>${shopEsc(label)}</span></a>`).join('')}</div>
          <div class="shop-chk">${s.checked ? shopEsc((t.shopChecked || ((d) => `확인 ${d}`))(s.checked)) : ''}<a class="shop-report" href="/shop/report/?id=${encodeURIComponent(s.id)}" target="_blank" rel="noopener">${shopEsc(t.shopReport || '이의 제기')}</a></div>
        </div>`).join('') + `<div class="shop-foot">${reg}</div>`;
    }

    // B. 맨 아래 정보 줄: 왼쪽 정점 정보 + 오른쪽 샵 바로가기(샵 탭에선 안 보임)
    // [CHANGE] 아래 정보 줄: 왼쪽에 샵 바로가기(좁은 화면을 위해 "제휴" 표시는 빼고 샵 이름만), 오른쪽에 정점 정보
    // [ADD] 아래 정보 줄 맨 앞에 "수심 ~64m"(포인트 300m 안 최대 수심, api/_depth.js). 포인트(해변 정점)만, 처음 열 때 한 번 받아요
    function depthFootPrefix() {
      const st = selectedStation;
      if (!st || !st.isBeach || /^River/.test(st.network || '') || !/^https?:$/.test(location.protocol)) return '';
      if (st._depthReq === undefined) {
        st._depthReq = fetch(`/api/spotobs?svc=depth&lite=1&lat=${st.coords[1].toFixed(4)}&lon=${st.coords[0].toFixed(4)}`).then(r => r.json())
          .then(j => { st._depth = j && j.ok && (j.max300 != null || j.max1k != null) ? j : null; if (st._depth && selectedStation === st) { setFootInfo(footText); if (typeof activeMode !== 'undefined' && activeMode === 'depth' && typeof updateChart === 'function') updateChart(); } })
          .catch(() => { st._depth = null; });
      }
      const d = st._depth; if (!d || d.max300 == null) return '';
      return (t.depthFoot ? t.depthFoot(d.max300) : `수심 ~${d.max300}m`) + ' · ';
    }
    function setFootInfo(text) {
      footText = text || '';
      const el = document.getElementById('st-info');
      if (!el) return;
      text = depthFootPrefix() + footText;
      const list = activeMode === 'shop' ? [] : shopsFor(selectedStation);
      if (!list.length) { el.classList.remove('has-shop'); el.textContent = text; return; }
      const s = list.find(x => x.paid) || list[0];
      const quick = shopLinks(s).filter(([k]) => k === 'tel' || k === 'kakao' || k === 'whatsapp').slice(0, 2);
      el.classList.add('has-shop');
      el.innerHTML = `<span class="shop-q"><span class="shop-qn">${shopEsc(s.name)}</span>` +
        quick.map(([k, href]) => `<a class="shop-ic${k === 'tel' ? ' call' : ''}" ${linkAttrs(s, k, href)} aria-label="${k}">${SHOP_ICON[k]}</a>`).join('') +
        `<button type="button" class="shop-all" data-shop="${shopEsc(s.id)}" data-shop-k="all">${shopEsc((t.shopAll || ((n) => `전체 ${n}곳 ›`))(list.length))}</button></span>` +
        `<span class="foot-txt">${shopEsc(text)}</span>`;
      sendImps([s]);
    }
    // 노출 수: 정점을 직접 고를 때마다 샵별 한 번(바로가기에 보였든 다이빙샵 탭에서 봤든 한 번만)
    function sendImps(list) {
      const st = selectedStation;
      if (!st || !st._userPicked || !/^https?:$/.test(location.protocol)) return;
      if (st._impFor !== st._shopOrder) { st._impFor = st._shopOrder; st._impSent = new Set(); }
      list.forEach(s => {
        if (st._impSent.has(s.id)) return;
        st._impSent.add(s.id);
        try { navigator.sendBeacon(`/api/shops?svc=imp&id=${encodeURIComponent(s.id)}&no=${st.no}`); } catch (_) {}
      });
    }

    // 버튼 누름: 클릭 수 올리기, "전체 ›"는 샵 탭으로
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('[data-shop-k]');
      if (!a) return;
      const k = a.getAttribute('data-shop-k'), id = a.getAttribute('data-shop');
      if (/^https?:$/.test(location.protocol)) {
        const no = selectedStation && selectedStation.no ? `&no=${selectedStation.no}` : '';
        const u = `/api/shops?svc=click&id=${encodeURIComponent(id)}&k=${k}${no}`;
        try { navigator.sendBeacon ? navigator.sendBeacon(u) : fetch(u, { keepalive: true }); } catch (_) {}
      }
      if (k === 'all') setMode('shop');
    });

    loadShops();
