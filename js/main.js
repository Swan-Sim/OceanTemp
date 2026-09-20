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

    // [CHANGE] "로딩 화면 만들어서 조바심 줄여주자" 요청 반영. 순서:
    // 1) 정점 데이터 없이도 그릴 수 있는 장면(별/행성/실제 태양·달/작은 지구)을
    //    즉시 그리고, 동시에 CRT 부팅 텍스트 + 지구 위 로딩바를 보여줍니다.
    // 2) 그 사이 백그라운드에서 정점 생성 + 실데이터 검증을 진행합니다.
    // 3) 검증이 끝나면 정점 레이어(히트필드/마커)를 추가하고,
    //    카메라를 줌인하면서 최종 방향(가능하면 내 위치)으로 회전시킵니다.
    async function bootApp() {
      const counter = document.getElementById('point-counter');
      document.body.classList.add('booting');
      startBootTextSequence();

      // 1) 즉시 그릴 수 있는 장면 먼저 (작은 지구 + 우주 배경)
      initEarlyScene();

      // 2) 정점 생성 + 실데이터 검증 (백그라운드)
      stations = generateBeachStations();
      const gridStations = generateOceanGridStations();
      stations = stations.concat(gridStations);
      fullGridLoaded = true;

      if (counter) counter.innerText = '해양 데이터 확인 중...';
      try {
        stations = await removeStationsWithNoData(stations, (done, total) => {
          if (counter) counter.innerText = `해양 데이터 확인 중... (${done}/${total})`;
          updateBootProgress(done, total);
        });
      } catch (e) {
        console.warn('[bootApp] 정점 검증 중 오류, 전체 목록 유지:', e);
      }

      refreshMaxTempStation();
      addStationLayers();
      finishBootTextSequence();

      // 3) 가능하면 내 위치 방향을 목표로, 아니면 기본(태평양) 방향으로 줌인 전환.
      // 위치 요청은 최대 3초만 기다리고 그 안에 응답이 없으면 기본 방향으로 진행합니다.
      let targetX = 0.35, targetY = -2.1;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000, maximumAge: 600000 });
          });
          const r = computeRotationForLatLon(pos.coords.latitude, pos.coords.longitude);
          targetX = r.x; targetY = r.y;
        } catch (e) {
          console.warn('[geo] 위치 기반 초기 방향 설정 실패 - 기본 방향 사용:', e && e.message);
        }
      }

      animateBootZoomIn(targetX, targetY, () => {
        const bootScreen = document.getElementById('boot-screen');
        if (bootScreen) bootScreen.classList.add('boot-done');
        document.body.classList.remove('booting');
      });
    }

    window.addEventListener('DOMContentLoaded', () => {
      // [ADD] 지원하는 브라우저(주로 풀스크린 상태의 안드로이드 크롬)에서는
      // 세로 방향으로 잠가봅니다. 실패해도 조용히 무시 - 가로모드 차단의
      // 실질적인 방어선은 CSS의 .rotate-overlay 쪽입니다 (모든 브라우저에서 동작).
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(() => {});
      }
      bootApp().catch(err => {
        // [FIX] 초기화 중 에러가 나면 "로딩 중..."에서 그대로 멈춰버렸던 문제.
        // 화면에 에러를 보여주고 콘솔에도 남겨서 원인을 바로 알 수 있게 합니다.
        console.error('[bootApp] 초기화 실패:', err);
        document.body.classList.remove('booting');
        const bootScreen = document.getElementById('boot-screen');
        if (bootScreen) bootScreen.classList.add('boot-done');
        const counter = document.getElementById('point-counter');
        if (counter) { counter.innerText = '로딩 실패 (콘솔 확인)'; counter.style.background = '#dc2626'; }
      });
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