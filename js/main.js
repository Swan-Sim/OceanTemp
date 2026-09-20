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

      // [CHANGE] "로딩 중 위치 공유 안 한 사용자에게 내 위치/검색/대륙 선택
      // 위젯 제공" 요청 반영 - 위치 선택(자동 감지 또는 위젯 조작)을 정점
      // 로딩과 동시에 진행합니다. 대부분 정점 로딩이 끝날 때쯤엔 이미
      // 결과가 나와 있어서 따로 기다릴 필요가 거의 없어요.
      setupBootLocationWidget();

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
      await addStationLayers();
      finishBootTextSequence();

      // 3) 위치 선택 결과 대기 (이미 끝나있을 가능성이 높음) 후 그 방향으로 줌인 전환
      await waitForBootSearchIdle(6000);
      const targetView = getFinalBootLocation();
      const locationWidget = document.getElementById('boot-location-widget');
      if (locationWidget) locationWidget.classList.add('hide');

      animateBootZoomIn(targetView.x, targetView.y, () => {
        const bootScreen = document.getElementById('boot-screen');
        if (bootScreen) bootScreen.classList.add('boot-done');
        document.body.classList.remove('booting');
        // [FIX] 하단 차트 패널이 다시 나타나면서 지구본 영역 높이가 줄어드는데,
        // window resize 이벤트가 안 뜨는 CSS 레이아웃 변화라 명시적으로 동기화합니다.
        syncRendererSize();
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
        syncRendererSize();
        const counter = document.getElementById('point-counter');
        if (counter) { counter.innerText = '로딩 실패 (콘솔 확인)'; counter.style.background = '#dc2626'; }
      });
    });
    // [FIX] "그래프창이 다시 생기면서 지구 남반구가 아래로 잘려 들어갔다" -
    // 원인은 로딩 중 하단 차트 패널을 CSS로 숨겼다가 다시 보이면 지구본
    // 영역의 실제 크기가 바뀌는데, 이건 브라우저의 window resize 이벤트가
    // 아니라서(창 크기 자체는 안 바뀜) 기존 resize 핸들러가 전혀 발동하지
    // 않았던 거예요. 렌더러/카메라 크기 동기화를 함수로 빼서, 레이아웃이
    // 바뀌는 모든 경우(윈도우 리사이즈 + 로딩 완료로 패널이 다시 나타날 때)
    // 둘 다에서 호출합니다.
    function syncRendererSize() {
      if (!renderer || !camera) return;
      const container = document.getElementById('viewport-container');
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    // [FIX] "핸드폰에서 가로세로로 여러 번 돌리니까 버그가 생김(비율이 이상해지고
    // 버튼 뒤에 검은 레이어가 생김)" - 진짜 원인을 찾았어요. resize 이벤트와
    // orientationchange(matchMedia) 핸들러가 각각 따로, 디바운스 없이
    // syncRendererSize()를 호출하고 있었어요. 회전을 빠르게 여러 번 하면
    // 이 호출들이 순서 없이 겹쳐서 실행되면서, 레이아웃이 아직 다 자리잡지
    // 않은 "중간 상태"의 크기를 읽어다 렌더러에 적용해버리는 경우가
    // 있었습니다(그게 비율이 어긋나고 캔버스가 컨테이너를 다 못 채워서
    // 뒤에 검은 배경이 비치는 원인이었을 거예요). 디바운스로 겹치는 호출을
    // 하나로 정리하고, 방향 전환 직후엔 한 번 더 안전하게 재확인합니다.
    let resizeDebounceTimer = null;
    function scheduleResize(delay) {
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(() => {
        resizeDebounceTimer = null;
        syncRendererSize();
      }, delay || 150);
    }

    window.addEventListener('resize', () => scheduleResize(150));

    // [ADD] "화면 비율 바뀌면 중앙 다시 정렬해줘, 줌은 유지" 요청 반영.
    // matchMedia로 세로↔가로 전환을 정확히 감지해서(작은 리사이즈마다 매번
    // 재정렬하면 산만하니, 방향이 실제로 뒤집힐 때만), 레이아웃이 완전히
    // 자리잡을 시간을 살짝 준 뒤 렌더러 크기 동기화 + 세로 기울기 재정렬을
    // 같이 실행합니다. cameraDistance(줌)는 건드리지 않습니다.
    if (window.matchMedia) {
      const orientationQuery = window.matchMedia('(orientation: landscape)');
      const onOrientationFlip = () => {
        scheduleResize(300);
        // 안전망: 일부 기기는 방향 전환 직후 첫 측정이 아직 최종 크기가
        // 아닐 수 있어서, 조금 더 지난 뒤 한 번 더 확실하게 재확인합니다.
        setTimeout(() => {
          syncRendererSize();
          recenterGlobeVertical();
        }, 600);
      };
      if (orientationQuery.addEventListener) orientationQuery.addEventListener('change', onOrientationFlip);
      else if (orientationQuery.addListener) orientationQuery.addListener(onOrientationFlip); // 구형 Safari 폴백
    }