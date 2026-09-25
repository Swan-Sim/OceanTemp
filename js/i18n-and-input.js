    const userLocale = (navigator.language || 'en').toLowerCase();
    const lang = userLocale.startsWith('ko') ? 'ko' : (userLocale.startsWith('ja') ? 'ja' : 'en');

    const todayObj = new Date();
    const curMonth = todayObj.getMonth();
    const curDate = todayObj.getDate();
    // [ADD] "온도 그래프에 오늘이 중앙에 오게" 요청 반영 - 달력상 1월~12월
    // 고정 대신, 오늘 기준 이동 윈도우(오늘 달의 5달 전부터 6달 후까지,
    // 총 12개월)를 씁니다. 9월이면 4월~내년 3월이 됩니다.
    const windowStartMonth = ((curMonth - 5) % 12 + 12) % 12;
    const todayLabel = `${curMonth + 1}월 ${curDate}일`;

    const i18n = {
      ko: {
        appTitle: "전 세계 해양 수온 모니터링 (3D 위성 지구공)",
        legendBeach: "원하는 곳을 클릭하세요",
        reset: "지구공",
        stationCount: (n) => `총 ${n.toLocaleString()}개 정점`,
        selectPrompt: "정점을 선택하세요",
        infoCoord: (net, lat, lon) => `${net} | 위도: ${lat.toFixed(3)}°, 경도: ${lon.toFixed(3)}°`,
        tabForecast: "계절 추정 vs 최근 90일 실측",
        tabDepth: "수심별 수온 (CTD/Argo)",
        chartPast: "평년(계절 추정)",
        chartActual: "실측값(최근 90일)",
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
        rotateMsg: "화면을 세로로 돌려주세요 — 가로모드에서는 화면이 너무 좁아 지구본과 그래프를 함께 보기 어려워요.",
        liveDataOn: "실시간 데이터 (Open-Meteo)",
        liveDataLoading: "실시간 데이터 불러오는 중...",
        liveDataFallback: "실제 데이터 연결이 안 되어 추정 알고리즘으로 만든 데이터입니다",
        tabNow: "수온·조석 (±2일)",
        nowTemp: "수온",
        tideRef: "평균해수면 0m = 20°C 선",
        nowSource: "실시간 모델 (Open-Meteo, 현지 시각)",
        nowLoading: "수온·조석 데이터 불러오는 중...",
        nowFailed: "데이터를 불러오지 못했어요 - 1분쯤 뒤 이 탭을 다시 눌러주세요",
        tapToLoad: "정점을 누르거나 이 탭을 누르면 실시간 수온·조석을 불러와요",
        nowDailyLimit: "Open-Meteo 오늘 무료 사용 한도(내 인터넷 주소 기준 하루 1만 건)를 다 써서 막혔어요 - 하루가 지나면 자동으로 풀려요",
        moonTideOn: "달·조석 격자 끄기",
        moonTideOff: "달·조석 격자 켜기",
        tideLevel: "해수면 높이",
        tideHigh: "만조",
        tideLow: "간조",
        tideNow: "지금",
        tideNextHigh: "다음 만조",
        tideNextLow: "다음 간조",
        tideNote: "모델 추정값이라 항구 조위표와 다를 수 있어요 - 항해·안전 판단에 쓰지 마세요"
      },
      en: {
        appTitle: "Global Ocean Temp Monitor (3D Satellite Globe)",
        legendBeach: "Tap anywhere to explore",
        reset: "Globe",
        stationCount: (n) => `${n.toLocaleString()} Stations`,
        selectPrompt: "Select a station",
        infoCoord: (net, lat, lon) => `${net} | Lat: ${lat.toFixed(3)}°, Lon: ${lon.toFixed(3)}°`,
        tabForecast: "Seasonal Est. vs Last 90 Days",
        tabDepth: "Depth Profile (CTD/Argo)",
        chartPast: "Seasonal Estimate",
        chartActual: "Actual (Last 90 Days)",
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
        rotateMsg: "Please rotate your device to portrait — landscape mode is too narrow to show the globe and chart together.",
        liveDataOn: "Live data (Open-Meteo)",
        liveDataLoading: "Loading live data...",
        liveDataFallback: "Live data unavailable — this is estimated",
        tabNow: "Temp & Tide (±2 days)",
        nowTemp: "Water temp",
        tideRef: "MSL 0 m aligned with 20°C",
        nowSource: "Live model (Open-Meteo, local time)",
        nowLoading: "Loading temp & tide data...",
        nowFailed: "Couldn't load data - tap this tab again in about a minute",
        tapToLoad: "Tap a station (or this tab) to load live temp & tide",
        nowDailyLimit: "Open-Meteo's free daily limit for your IP (10,000 calls) is used up - it resets automatically within a day",
        moonTideOn: "Hide moon & tide grid",
        moonTideOff: "Show moon & tide grid",
        tideLevel: "Sea level",
        tideHigh: "High tide",
        tideLow: "Low tide",
        tideNow: "Now",
        tideNextHigh: "Next high",
        tideNextLow: "Next low",
        tideNote: "Model estimate; may differ from harbor tide tables. Not for navigation or safety decisions."
      }
    };
    const t = i18n[lang] || i18n.en;

    document.getElementById('txt-app-title').innerText = t.appTitle;
    document.getElementById('st-name').innerText = t.selectPrompt;
    document.getElementById('btn-ts').innerText = t.tabForecast;
    document.getElementById('btn-dp').innerText = t.tabDepth;
    document.getElementById('btn-now').innerText = t.tabNow;
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

