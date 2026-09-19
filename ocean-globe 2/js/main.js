    function toggleFullscreen() {
      const el = document.documentElement;
      const isFs = document.fullscreenElement || document.webkitFullscreenElement;
      if (!isFs) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) {
          req.call(el).catch(() => { alert(t.fsUnsupported); });
        } else {
          alert(t.fsUnsupported);
        }
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }
    }

    // [ADD] 모바일 주소창이 화면을 가리는 문제 - 100dvh로 대부분 해결되지만,
    // 일부 브라우저는 "스크롤을 한 번 해야" 주소창을 접어줍니다. 실제 스크롤할
    // 내용은 없지만 잠깐 스크롤을 허용했다가 1px 내려서 접게 유도한 뒤 원상복구합니다.
    // (가장 확실한 방법은 우측 상단 ⛶ 전체화면 버튼이에요 - 안드로이드 크롬 등에서
    //  주소창까지 완전히 사라집니다.)
    function tryHideAddressBar() {
      const html = document.documentElement;
      const prevOverflow = html.style.overflow;
      html.style.overflow = 'auto';
      window.scrollTo(0, 1);
      setTimeout(() => {
        window.scrollTo(0, 0);
        html.style.overflow = prevOverflow || 'hidden';
      }, 350);
    }
    window.addEventListener('load', () => setTimeout(tryHideAddressBar, 250));
    window.addEventListener('orientationchange', () => setTimeout(tryHideAddressBar, 450));

    window.addEventListener('DOMContentLoaded', () => {
      // [ADD] 지원하는 브라우저(주로 풀스크린 상태의 안드로이드 크롬)에서는
      // 세로 방향으로 잠가봅니다. 실패해도 조용히 무시 - 가로모드 차단의
      // 실질적인 방어선은 CSS의 .rotate-overlay 쪽입니다 (모든 브라우저에서 동작).
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(() => {});
      }
      try {
        initThreeGlobe();
      } catch (err) {
        // [FIX] 초기화 중 에러가 나면 "로딩 중..."에서 그대로 멈춰버렸던 문제.
        // 화면에 에러를 보여주고 콘솔에도 남겨서 원인을 바로 알 수 있게 합니다.
        console.error('[initThreeGlobe] 초기화 실패:', err);
        const counter = document.getElementById('point-counter');
        if (counter) { counter.innerText = '로딩 실패 (콘솔 확인)'; counter.style.background = '#dc2626'; }
      }
    });
    window.addEventListener('resize', () => {
      if (renderer && camera) {
        const container = document.getElementById('viewport-container');
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });