    // [ADD] 홈 화면에 추가(휴대폰) / 즐겨찾기(컴퓨터) 버튼
    //  - 안드로이드 Chrome 등: 브라우저가 주는 설치 창(beforeinstallprompt)을 바로 띄워요
    //  - 아이폰: 브라우저가 대신 해줄 수 없어서 "공유 → 홈 화면에 추가" 안내 말풍선
    //  - 컴퓨터: 즐겨찾기는 사이트가 대신 못 넣어서 Ctrl+D / ⌘+D 안내 (+ 설치 가능하면 "앱으로 설치" 버튼)
    //  - 이미 앱으로 열었으면(홈 화면 아이콘) 버튼을 숨겨요
    (function () {
      const btn = document.getElementById('btn-save');
      if (!btn) return;
      const ko = typeof lang === 'undefined' || lang === 'ko';
      const ua = navigator.userAgent || '';
      const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
      const isMobile = isIOS || /Android|Mobile/i.test(ua);
      const isMac = /Mac/.test(navigator.platform || ua);
      const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
      if (standalone) { btn.style.display = 'none'; return; }
      let deferred = null;
      window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
      window.addEventListener('appinstalled', () => { btn.style.display = 'none'; hideTip(); });

      const ICON_HOME = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 9v6M9 12h6"/></svg>';
      const ICON_STAR = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
      // [CHANGE] 컴퓨터에서도 별 대신 "설치" 아이콘 - 별(☆)은 포인트 즐겨찾기(로그인) 버튼과 헷갈려서
      const ICON_INSTALL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11M7.5 9.5 12 14l4.5-4.5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';
      btn.innerHTML = isMobile ? ICON_HOME : ICON_INSTALL;
      btn.title = isMobile ? (ko ? '홈 화면에 추가' : 'Add to Home Screen') : (ko ? '앱으로 설치 · 브라우저 북마크' : 'Install app · Bookmark site');
      btn.style.display = '';

      const SHARE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#7dd3fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
      let tip = null;
      function hideTip() { if (tip) { tip.remove(); tip = null; } }
      function showTip(html) {
        hideTip();
        tip = document.createElement('div');
        tip.id = 'save-tip';
        tip.innerHTML = `<button class="st-x" aria-label="close">×</button>${html}`;
        document.body.appendChild(tip);
        tip.querySelector('.st-x').onclick = hideTip;
        const inst = tip.querySelector('[data-install]');
        if (inst) inst.onclick = async () => { hideTip(); if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch (_) {} deferred = null; } };
        setTimeout(() => document.addEventListener('click', function off(e) { if (tip && !tip.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { hideTip(); document.removeEventListener('click', off); } }), 0);
      }
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (tip) { hideTip(); return; }
        if (deferred && isMobile) {                       // 안드로이드: 설치 창 바로
          deferred.prompt(); try { await deferred.userChoice; } catch (_) {} deferred = null; return;
        }
        if (isIOS) {
          showTip(ko ? `<b>홈 화면에 추가</b><div>${SHARE} <b>공유</b> 버튼을 누르고<br><b>"홈 화면에 추가"</b>를 고르세요.</div><div class="st-s">Safari는 아래쪽, iPad·Chrome은 위쪽에 공유 버튼이 있어요.</div>`
            : `<b>Add to Home Screen</b><div>Tap ${SHARE} <b>Share</b>, then<br><b>"Add to Home Screen"</b>.</div>`);
        } else if (isMobile) {
          showTip(ko ? `<b>홈 화면에 추가</b><div>브라우저 메뉴(<b>⋮</b>)에서<br><b>"홈 화면에 추가"</b> 또는 <b>"앱 설치"</b>를 고르세요.</div>`
            : `<b>Add to Home Screen</b><div>Open the browser menu (<b>⋮</b>) and choose<br><b>"Add to Home screen"</b> or <b>"Install app"</b>.</div>`);
        } else {
          const key = isMac ? '⌘ + D' : 'Ctrl + D';
          showTip((ko ? `<b>즐겨찾기에 추가</b><div>키보드에서 <kbd>${key}</kbd> 를 누르면<br>otemp가 즐겨찾기에 저장돼요.</div>`
            : `<b>Bookmark otemp</b><div>Press <kbd>${key}</kbd> to add<br>otemp to your bookmarks.</div>`) +
            (deferred ? `<button class="st-install" data-install>${ko ? '컴퓨터에 앱으로 설치' : 'Install as an app'}</button>` : ''));
        }
      });
    })();
