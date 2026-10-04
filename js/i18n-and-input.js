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
        tabForecast: "연간 추이",
        prevAvg: (n) => `지난 ${n}년 같은 날 실측 평균`, prevRange: (n) => `지난 ${n}년 범위(최저~최고)`,
        tabDepth: "수심 프로파일", tabShop: "다이빙샵", shopPartner: "제휴", shopPartnerOnly: "제휴 샵만 보여요", shopMayChange: "정보가 바뀌었을 수 있어요", shopCall: "전화", shopKakao: "카톡", shopInsta: "인스타", shopWeb: "웹", shopAll: (n) => n > 1 ? `전체 ${n}곳 ›` : "자세히 ›", shopChecked: (d) => `확인 ${d}`, shopRegister: "샵 등록하기", shopReport: "정보가 틀렸거나 본인이 등록하지 않았나요? 이의 제기", shopEmpty: "아직 이 포인트에 등록된 제휴 샵이 없어요.", spotRegister: "포인트 등록", spotHere: "이 위치로 포인트 등록",
        chartPast: "평년(계절 추정)",
        chartActual: "실측값(과거)",
        chartFuture: "추정값(오늘~연말)",
        chartDepthLabel: "수심별 수온",
        todayBadge: `오늘 (${todayLabel})`,
        months: ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'],
        hotspot: "최고 수온 Hotspot",
        beachTag: "비치 엔트리/물놀이 포인트",
        disclaimer: "본 서비스의 수온 관측치, 과거 통계 및 추정 모델은 참고용 정보이며 시차나 관측 오차가 발생할 수 있습니다. 항해, 조난 구조 및 극한 해양 레저 활동의 안전 판단에 대한 법적 책임을 지지 않습니다.",
        disclaimerLabel: "Disclaimer",
        locateTitle: "내 위치", coordCopy: "좌표 복사", coordCopied: "복사됨 ✓", locateWait: "위치 확인 중...", locateFail: "위치를 가져올 수 없어요", locateDenied: "위치 권한이 꺼져 있어요 (브라우저 설정에서 허용해 주세요)", locateAcc: (a) => `내 위치 (오차 약 ${a}m)`,
        fullscreenTitle: "전체화면",
        donateTitle: "커피 한 잔 후원하기 (Buy Me a Coffee)",
        expandNote: "확대시 전체",
        depthAxisLabel: "수심 (m)",
        tempAxisLabel: "수온 (°C)",
        fsUnsupported: "이 브라우저는 전체화면 API를 지원하지 않아요.\niOS Safari라면 공유 버튼 → \"홈 화면에 추가\"로 실행하면 주소창 없이 열립니다.",
        rotateMsg: "화면을 세로로 돌려주세요 — 가로모드에서는 화면이 너무 좁아 지구본과 그래프를 함께 보기 어려워요.",
        liveDataOn: "실시간 데이터 (Open-Meteo)",
        liveDataObs: (src) => `실측: ${src}`,
        visSrc: "NOAA 위성", visSrcTitle: "시야: NOAA CoastWatch 위성 탁도(Kd490)·엽록소로 추정 (시야 ≈ 1.7 ÷ 탁도)",
        statusObs: "실측", chartPastObs: (y) => `평년(실측 ${y}년 평균)`,
        liveDataLoading: "실시간 데이터 불러오는 중...",
        liveDataFallback: "실제 데이터 연결이 안 되어 추정 알고리즘으로 만든 데이터입니다",
        tabNow: "실시간 현황",
        nowTemp: "수온",
        tideRef: "평균해수면 0m = 20°C 선",
        nowSource: "실시간 모델 (Open-Meteo, 현지 시각)",
        nowLoading: "수온·조석 데이터 불러오는 중...",
        nowFailed: "데이터를 불러오지 못했어요 - 1분쯤 뒤 이 탭을 다시 눌러주세요",
        tapToLoad: "정점을 누르면 실시간 값을 불러와요",
        prevDay: "전날", nextDay: "다음날", retry: "다시 시도",
        statusLive: "Live", statusEst: "추정값", nowLoadingShort: "불러오는 중…", backToNow: "지금 시각으로 돌아가기",
        compass: ['북', '북동', '동', '남동', '남', '남서', '서', '북서'],
        rowTemp: "수온", rowWind: "바람 m/s", rowDir: "방향", rowWave: "파고 m", rowSwell: "너울 주기", rowTide: "조석",
        gust: "돌풍",
        waveHeight: "파고",
        swell: "너울",
        sec: "초",
        nowEstimated: "추정값 - 위성 수온 + 달·태양 위치로 계산한 조석 리듬 (실제 물때 시각·높이와 다를 수 있음)",
        nowDailyLimit: "Open-Meteo 오늘 무료 사용 한도(내 인터넷 주소 기준 하루 1만 건)를 다 써서 막혔어요 - 하루가 지나면 자동으로 풀려요",
        moonTideOn: "달·조석 격자 끄기",
        moonTideOff: "달·조석 격자 켜기",
        tideLevel: "해수면 높이",
        tideHigh: "만조",
        tideLow: "간조",
        tideNow: "지금",
        tideNextHigh: "다음 만조",
        tideNextLow: "다음 간조",
        tideNote: "모델 추정값이라 항구 조위표와 다를 수 있어요 - 항해·안전 판단에 쓰지 마세요",
        // [ADD] 시야(물 투명도) 추정
        fcTempVis: "수온·시야", fcCause: "시야 원인",
        visObserved: "시야 추정 (위성, 7일 평균)", visTrend: "시야 추세 ± 오차 (오른쪽 m)", visBand: "오차 범위",
        visLoading: "시야 불러오는 중…", visFailed: "이 위치는 위성 시야 자료가 없어요",
        visFormula: "시야 = 1.7 ÷ 탁한 정도", visPlankton: "플랑크톤 (엽록소로 계산)", visOther: "기타 탁도 (모래·강물 등)", visWater: "물 자체",
        visTurbidity: "탁한 정도 (빛 감쇠)", visAxis: "시야",
        visLastLine: (d, v, kd) => `${d} 시야 <b class="vis-num">${v}</b> = 1.7 ÷ ${kd}`,
        visCauseLine: (p, o, chl) => `원인(최근 7일): 플랑크톤 ${p}% · 기타 탁도 ${o}% · 엽록소 ${chl} mg/m³`,
        visNoChl: "엽록소 자료가 없어 원인은 나눌 수 없어요",
        visRadius: (km) => `정점 반경 ${km}km 바다 픽셀의 중앙값`,
        visCheck: (v, a, b, ok) => `교차 확인(다른 위성 처리, ${a}~${b} 중앙값): ${v}${ok ? '' : '\n두 위성 자료 차이가 커요 - 해안·얕은 바닥 영향일 수 있어요'}`,
        visCheckShort: "교차 확인(VIIRS 14일)",
        visGround: (name, km, v, q, a, b) => `실측 투명도(부산시 측정, ${name} ${km}km·대략 위치, ${a}~${b}년 ${q}분기 평균): ${v}`,
        visGroundShort: (name) => `실측 투명도(부산시, ${name})`,
        legendTitle: '범례', visFar: (km) => `시야 없음: 정점 좌표가 바다에서 ${km}km 떨어진 육지 안쪽이에요(좌표 확인 필요)`, legendDock: '그래프 아래로 치우기', legendUndock: '그래프 위로 다시 올리기',
        // [ADD] 근처 관측소 실측 (국립해양조사원 / NOAA)
        obsNote: (src, pred) => `<span class="nt-obsdot"></span> 점 = 실측: ${src} · 이후 칸은 예보${pred ? ` (조석은 ${pred === true ? 'NOAA' : pred} 예측)` : ''}`,
        tideJmaShort: '일본 기상청 조위표',
        tideJma: (name, km) => `조석: 일본 기상청 조위표 ${name} (${(+km).toFixed(1)}km, 出典：気象庁ホームページ) · 수온·파도는 모델 추정`,
        obsSource: (src) => `지금까지: 실측 - ${src} · 이후: 예보 모델 (Open-Meteo)`,
        obsSeoul: (name) => `서울시 한강 수질측정소 ${name}`, obsKhoa: (name) => `국립해양조사원 ${name}`, obsKma: (name) => `기상청 ${name}`, obsBuoyWord: '부이', obsCoops: (name) => `NOAA ${name}`, obsNdbc: (id) => `NDBC ${id} 부이`, obsCmems: (name) => `Copernicus 해양관측 ${name}`,
        visGaugeTitle: (now, p10, p90, lastD, lastV) => `시야 추정(오늘): ${now}\n90일 통상 범위: ${p10}–${p90}\n위성 마지막 관측 ${lastD}: ${lastV}\n위성 추정값이라 실제와 다를 수 있어요`
      },
      en: {
        appTitle: "Global Ocean Temp Monitor (3D Satellite Globe)",
        legendBeach: "Tap anywhere to explore",
        reset: "Globe",
        stationCount: (n) => `${n.toLocaleString()} Stations`,
        selectPrompt: "Select a station",
        infoCoord: (net, lat, lon) => `${net} | Lat: ${lat.toFixed(3)}°, Lon: ${lon.toFixed(3)}°`,
        tabForecast: "Yearly trend",
        prevAvg: (n) => `Past ${n}-yr observed avg (same dates)`, prevRange: (n) => `Past ${n}-yr range (min-max)`,
        tabDepth: "Depth profile", tabShop: "Dive shops", shopPartner: "Partner", shopPartnerOnly: "Partner shops only", shopMayChange: "Details may have changed", shopCall: "Call", shopKakao: "KakaoTalk", shopInsta: "Instagram", shopWeb: "Web", shopAll: (n) => n > 1 ? `All ${n} ›` : "More ›", shopChecked: (d) => `Checked ${d}`, shopRegister: "Register your shop", shopReport: "Wrong info or not registered by you? Report", shopEmpty: "No partner shops for this spot yet.", spotRegister: "Suggest a dive spot", spotHere: "Suggest a spot here",
        chartPast: "Seasonal Estimate",
        chartActual: "Actual (past)",
        chartFuture: "Projected (Today–Dec)",
        chartDepthLabel: "Depth Water Temp",
        todayBadge: `Today (${todayObj.toLocaleString('en-US', { month: 'short', day: 'numeric' })})`,
        months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        hotspot: "Max Temp Hotspot",
        beachTag: "Beach Entry / Shore Dive",
        disclaimer: "SST readings, historical stats, and forecast models in this app are illustrative only and may not reflect real-time conditions or measurement error. Not to be relied on for navigation, distress response, or extreme ocean sports safety decisions.",
        disclaimerLabel: "Disclaimer",
        locateTitle: "My location", coordCopy: "Copy", coordCopied: "Copied ✓", locateWait: "Locating...", locateFail: "Could not get your location", locateDenied: "Location permission is off (allow it in browser settings)", locateAcc: (a) => `My location (±${a} m)`,
        fullscreenTitle: "Fullscreen",
        donateTitle: "Buy me a coffee",
        expandNote: "full list on zoom-in",
        depthAxisLabel: "Depth (m)",
        tempAxisLabel: "Temp (°C)",
        fsUnsupported: "This browser doesn't support the Fullscreen API.\nOn iOS Safari, use Share → \"Add to Home Screen\" to open it without an address bar.",
        rotateMsg: "Please rotate your device to portrait — landscape mode is too narrow to show the globe and chart together.",
        liveDataOn: "Live data (Open-Meteo)",
        liveDataObs: (src) => `Observed: ${src}`,
        visSrc: "NOAA satellite", visSrcTitle: "Visibility: estimated from NOAA CoastWatch satellite turbidity (Kd490) & chlorophyll (≈ 1.7 ÷ turbidity)",
        statusObs: "Observed", chartPastObs: (y) => `Normal (${y}-yr observed avg)`,
        liveDataLoading: "Loading live data...",
        liveDataFallback: "Live data unavailable — this is estimated",
        tabNow: "Real-time Monitor",
        nowTemp: "Water temp",
        tideRef: "MSL 0 m aligned with 20°C",
        nowSource: "Live model (Open-Meteo, local time)",
        nowLoading: "Loading temp & tide data...",
        nowFailed: "Couldn't load data - tap this tab again in about a minute",
        tapToLoad: "Tap the station to load live data",
        prevDay: "Prev", nextDay: "Next", retry: "Retry",
        statusLive: "Live", statusEst: "Estimate", nowLoadingShort: "Loading…", backToNow: "Back to now",
        compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
        rowTemp: "Water", rowWind: "Wind m/s", rowDir: "Dir", rowWave: "Waves m", rowSwell: "Swell per.", rowTide: "Tide",
        gust: "gust",
        waveHeight: "Waves",
        swell: "swell",
        sec: "s",
        nowEstimated: "Estimate - satellite SST + tide rhythm from Moon/Sun positions (actual tide times/heights may differ)",
        nowDailyLimit: "Open-Meteo's free daily limit for your IP (10,000 calls) is used up - it resets automatically within a day",
        moonTideOn: "Hide moon & tide grid",
        moonTideOff: "Show moon & tide grid",
        tideLevel: "Sea level",
        tideHigh: "High tide",
        tideLow: "Low tide",
        tideNow: "Now",
        tideNextHigh: "Next high",
        tideNextLow: "Next low",
        tideNote: "Model estimate; may differ from harbor tide tables. Not for navigation or safety decisions.",
        fcTempVis: "Temp·Visibility", fcCause: "Why murky",
        visObserved: "Visibility (satellite, 7-day avg)", visTrend: "Visibility trend ± error (right, m)", visBand: "Error range",
        visLoading: "Loading visibility…", visFailed: "No satellite visibility data here",
        visFormula: "Visibility = 1.7 ÷ turbidity", visPlankton: "Plankton (from chlorophyll)", visOther: "Other (sand, runoff…)", visWater: "Pure water",
        visTurbidity: "Turbidity (light attenuation)", visAxis: "Visibility",
        visLastLine: (d, v, kd) => `${d} visibility <b class="vis-num">${v}</b> = 1.7 ÷ ${kd}`,
        visCauseLine: (p, o, chl) => `Cause (last 7 days): plankton ${p}% · other ${o}% · chl ${chl} mg/m³`,
        visNoChl: "No chlorophyll data - cause can't be split",
        visRadius: (km) => `Median of ocean pixels within ${km} km`,
        visCheck: (v, a, b, ok) => `Cross-check (different satellite processing, ${a}–${b} median): ${v}${ok ? '' : '\nThe two satellite sources disagree - coast or shallow bottom may affect them'}`,
        visCheckShort: "Cross-check (VIIRS 14d)",
        visGround: (name, km, v, q, a, b) => `Measured transparency (Busan city, ${name} ${km} km, approx. location, Q${q} avg ${a}–${b}): ${v}`,
        visGroundShort: (name) => `Measured transparency (Busan, ${name})`,
        legendTitle: 'Legend', visFar: (km) => `No visibility: spot coordinate is on land, ${km} km from the sea (check coordinates)`, legendDock: 'Move below the chart', legendUndock: 'Put back on the chart',
        obsNote: (src, pred) => `<span class="nt-obsdot"></span> dot = observed: ${src} · later columns are forecast${pred ? ` (tide: ${pred === true ? 'NOAA' : pred} prediction)` : ''}`,
        tideJmaShort: 'JMA tide table',
        tideJma: (name, km) => `Tide: Japan Meteorological Agency tide table, ${name} (${(+km).toFixed(1)} km; source: JMA) · temperature and waves are model estimates`,
        obsSource: (src) => `Up to now: observed - ${src} · later: forecast model (Open-Meteo)`,
        obsSeoul: (name) => `Seoul Han River station ${name}`, obsKhoa: (name) => `KHOA ${name}`, obsKma: (name) => `KMA ${name}`, obsBuoyWord: 'buoy', obsCoops: (name) => `NOAA ${name}`, obsNdbc: (id) => `NDBC buoy ${id}`, obsCmems: (name) => `Copernicus Marine ${name}`,
        visGaugeTitle: (now, p10, p90, lastD, lastV) => `Estimated visibility today: ${now}\n90-day typical: ${p10}–${p90}\nLast satellite obs ${lastD}: ${lastV}\nSatellite estimate; may differ from reality`
      }
    };
    const t = i18n[lang] || i18n.en;

    document.getElementById('txt-app-title').innerText = t.appTitle;
    document.getElementById('st-name').innerText = t.selectPrompt;
    document.getElementById('btn-ts').innerText = t.tabForecast;
    document.getElementById('btn-dp').innerText = t.tabDepth;
    document.getElementById('btn-now').innerText = t.tabNow;
    { const b = document.getElementById('btn-spot-add'); if (b) b.title = t.spotRegister; }
    if (typeof updateShopUI === 'function' && typeof selectedStation !== 'undefined' && selectedStation) updateShopUI(selectedStation);
    document.getElementById('btn-locate').title = t.locateTitle;
    document.getElementById('btn-fullscreen').title = t.fullscreenTitle;
    // [ADD] 커피값 후원 버튼 - Buy Me a Coffee 페이지 주소를 넣으면 버튼이 나타나요 (비워 두면 숨김)
    const DONATE_URL = 'https://buymeacoffee.com/suhwan';
    (() => {
      const b = document.getElementById('btn-donate');
      if (!b || !DONATE_URL) return;
      b.href = DONATE_URL; b.title = t.donateTitle; b.style.display = '';
      b.addEventListener('click', () => { try { navigator.sendBeacon && navigator.sendBeacon('/api/track?e=donate'); } catch (_) {} });
    })();
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

