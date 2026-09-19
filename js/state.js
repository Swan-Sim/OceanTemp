    let stations = [];
    let stationIdCounter = 1;
    let fullGridLoaded = false;
    let selectedStation = null;
    let maxTempStation = null;
    let activeMode = 'forecast';
    let chartInstance = null;
    let tempUnit = 'C'; // [ADD] 섭씨 기본값, 버튼으로 화씨와 전환

    function refreshMaxTempStation() {
      maxTempStation = stations.reduce((max, cur) => cur.curTemp > max.curTemp ? cur : max, stations[0]);
    }

    let scene, camera, renderer, globeGroup, globeMesh;
    let beachSprites = []; // [ADD] 줌 반응형 마커 크기 조절을 위해 참조 보관
    let selectionRing = null; // [ADD] 선택된 정점 표시용 링
    let gridStationsRef = []; // [ADD] NOAA 격자 정점 클릭 선택용
    let instancedDotsRef = null;
    let isDetailMode = false;
    let leafletMap = null;
    let leafletMarkersByStationId = {}; // [ADD] 선택 하이라이트용 마커 참조

    const GLOBE_RADIUS = 100;
    let cameraDistance = 270;
    const MIN_DIST = 135;
    const MAX_DIST = 380;

    // Natural Earth 공개 지리 데이터(1:110m, world-atlas 배포본, ISC 라이선스) - 육지 윤곽
