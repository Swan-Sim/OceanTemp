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

    window.addEventListener('DOMContentLoaded', () => {
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