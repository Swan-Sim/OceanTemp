    const userLocale = (navigator.language || 'en').toLowerCase();
    const lang = userLocale.startsWith('ko') ? 'ko' : (userLocale.startsWith('ja') ? 'ja' : 'en');

    const todayObj = new Date();
    const curMonth = todayObj.getMonth();
    const curDate = todayObj.getDate();
    const todayLabel = `${curMonth + 1}월 ${curDate}일`;

    const i18n = {
      ko: {
        appTitle: "전 세계 해양 수온 모니터링 (3D 위성 지구공)",
        legendBeach: "원하는 곳을 클릭하세요",
        reset: "지구공",
        stationCount: (n) => `총 ${n.toLocaleString()}개 정점`,
        selectPrompt: "정점을 선택하세요",
        infoCoord: (net, lat, lon) => `${net} | 위도: ${lat.toFixed(3)}°, 경도: ${lon.toFixed(3)}°`,
        tabForecast: "과거 5~6년 평균 vs 1년 추정",
        tabDepth: "수심별 수온 (CTD/Argo)",
        chartPast: "평년(5~6년 평균)",
        chartActual: "실측값(연초~오늘)",
        chartFuture: "추정값(오늘~연말)",
        chartDepthLabel: "수심별 수온",
        todayBadge: `오늘 (${todayLabel})`,
        months: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
        hotspot: "최고 수온 Hotspot",
        beachTag: "비치 엔트리/물놀이 포인트",
        disclaimer: "본 서비스의 수온 관측치, 과거 통계 및 추정 모델은 참고용 정보이며 시차나 관측 오차가 발생할 수 있습니다. 항해, 조난 구조 및 극한 해양 레저 활동의 안전 판단에 대한 법적 책임을 지지 않습니다.",
        disclaimerLabel: "Disclaimer",
        locateTitle: "내 위치",
        fullscreenTitle: "전체화면",
        expandNote: "확대시 전체",
        depthAxisLabel: "수심 (m)",
        tempAxisLabel: "수온 (°C)",
        fsUnsupported: "이 브라우저는 전체화면 API를 지원하지 않아요.\niOS Safari라면 공유 버튼 → \"홈 화면에 추가\"로 실행하면 주소창 없이 열립니다.",
        rotateMsg: "화면을 세로로 돌려주세요 — 가로모드에서는 화면이 너무 좁아 지구본과 그래프를 함께 보기 어려워요."
      },
      en: {
        appTitle: "Global Ocean Temp Monitor (3D Satellite Globe)",
        legendBeach: "Tap anywhere to explore",
        reset: "Globe",
        stationCount: (n) => `${n.toLocaleString()} Stations`,
        selectPrompt: "Select a station",
        infoCoord: (net, lat, lon) => `${net} | Lat: ${lat.toFixed(3)}°, Lon: ${lon.toFixed(3)}°`,
        tabForecast: "Past 5-6Y Avg vs 1Y Forecast",
        tabDepth: "Depth Profile (CTD/Argo)",
        chartPast: "5-6Y Average",
        chartActual: "Actual (Jan–Today)",
        chartFuture: "Projected (Today–Dec)",
        chartDepthLabel: "Depth Water Temp",
        todayBadge: `Today (${todayObj.toLocaleString('en-US', { month: 'short', day: 'numeric' })})`,
        months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        hotspot: "Max Temp Hotspot",
        beachTag: "Beach Entry / Shore Dive",
        disclaimer: "SST readings, historical stats, and forecast models in this app are illustrative only and may not reflect real-time conditions or measurement error. Not to be relied on for navigation, distress response, or extreme ocean sports safety decisions.",
        disclaimerLabel: "Disclaimer",
        locateTitle: "My location",
        fullscreenTitle: "Fullscreen",
        expandNote: "full list on zoom-in",
        depthAxisLabel: "Depth (m)",
        tempAxisLabel: "Temp (°C)",
        fsUnsupported: "This browser doesn't support the Fullscreen API.\nOn iOS Safari, use Share → \"Add to Home Screen\" to open it without an address bar.",
        rotateMsg: "Please rotate your device to portrait — landscape mode is too narrow to show the globe and chart together."
      }
    };
    const t = i18n[lang] || i18n.en;

    document.getElementById('txt-app-title').innerText = t.appTitle;
    document.getElementById('st-name').innerText = t.selectPrompt;
    document.getElementById('btn-ts').innerText = t.tabForecast;
    document.getElementById('btn-dp').innerText = t.tabDepth;
    document.getElementById('btn-locate').title = t.locateTitle;
    document.getElementById('btn-fullscreen').title = t.fullscreenTitle;
    document.getElementById('txt-disclaimer-label').innerText = t.disclaimerLabel + ':';
    document.getElementById('txt-disclaimer-body').innerText = t.disclaimer;
    document.getElementById('txt-rotate-msg').innerText = t.rotateMsg;

    // [FIX] 모바일 핀치줌으로 브라우저 자체가 확대되면서 레이아웃 비율이 틀어지는 문제 방지.
    // viewport 메타(user-scalable=no)만으로는 iOS Safari 등에서 완전히 막히지 않아서
    // 제스처 이벤트와 멀티터치 이동을 직접 막아줍니다. Leaflet 지도 자체의 확대/축소
    // 기능(핀치/더블탭)은 Leaflet이 내부적으로 처리하는 별도 로직이라 영향 없습니다.
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(evt => {
      document.addEventListener(evt, e => e.preventDefault());
    });
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    let __lastTapTime = 0;
    document.addEventListener('touchend', (e) => {
      if (e.target.closest('#leafletMap')) return; // Leaflet 자체 더블탭 줌은 유지
      const now = Date.now();
      if (now - __lastTapTime <= 300) e.preventDefault();
      __lastTapTime = now;
    }, { passive: false });

