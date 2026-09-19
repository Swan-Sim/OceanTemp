    // [ADD] "현재+과거 데이터를 실제로 가져와서 그래프 만들 수 있어?" 요청 반영.
    // Open-Meteo Marine API(무료, API 키 불필요, CORS 허용, ERA5-Ocean 기반이라
    // 1940년부터의 실측 해수면온도를 제공)를 브라우저에서 직접 호출합니다.
    // 이 앱이 Claude가 호스팅하는 페이지가 아니라 로컬 HTML 파일이라 가능한
    // 방식이에요 - 그냥 브라우저에서 여는 보통 웹페이지처럼 동작합니다.
    const LIVE_DATA_BASE = 'https://marine-api.open-meteo.com/v1/marine';

    async function fetchJSON(url, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    }

    // 정점 묶음(최대 ~90개)을 한 번의 요청으로 검증합니다 - Open-Meteo는
    // 위도/경도를 콤마로 여러 개 넘기면 한 번에 여러 지점을 조회할 수 있어요.
    async function batchCheckHasData(stationsChunk) {
      const lats = stationsChunk.map(s => s.coords[1]).join(',');
      const lons = stationsChunk.map(s => s.coords[0]).join(',');
      const url = `${LIVE_DATA_BASE}?latitude=${lats}&longitude=${lons}&current=sea_surface_temperature&timezone=auto`;
      try {
        const data = await fetchJSON(url);
        const list = Array.isArray(data) ? data : [data];
        return stationsChunk.map((st, i) => {
          const entry = list[i];
          const val = entry && entry.current && entry.current.sea_surface_temperature;
          return typeof val === 'number' && !Number.isNaN(val);
        });
      } catch (e) {
        // 네트워크 문제 등으로 검증 자체가 실패하면, 정점을 함부로 지우지 않고
        // 일단 살려둡니다 (오프라인이어도 앱이 완전히 비어버리진 않게).
        console.warn('[live-data] 배치 검증 실패 - 이 배치는 유지합니다:', e);
        return stationsChunk.map(() => true);
      }
    }

    // [ADD] "데이터가 전혀 없는 정점은 지워" 요청 - 전체 정점을 배치로 실제
    // 조회해서, 실시간 해수면온도가 아예 안 잡히는(육지에 너무 가깝거나
    // 모델 격자가 없는) 정점을 목록에서 제거합니다. 배치들을 병렬로 보내서
    // (브라우저가 알아서 동시 연결 수만큼 파이프라인) 순차 대기보다 훨씬 빠릅니다.
    async function removeStationsWithNoData(allStations, onProgress) {
      const CHUNK = 90;
      const chunks = [];
      for (let i = 0; i < allStations.length; i += CHUNK) chunks.push(allStations.slice(i, i + CHUNK));

      let done = 0;
      const kept = await Promise.all(chunks.map(async (chunk) => {
        const flags = await batchCheckHasData(chunk);
        done += chunk.length;
        if (onProgress) onProgress(Math.min(allStations.length, done), allStations.length);
        return chunk.filter((st, idx) => flags[idx]);
      }));
      return kept.flat();
    }

    function isoDate(d) { return d.toISOString().slice(0, 10); }

    // 결측이 있는 월은 앞/뒤 값으로 채워서 보간이 끊기지 않게 합니다.
    function fillMonthlyGaps(monthly) {
      const out = monthly.slice();
      for (let i = 0; i < 12; i++) {
        if (out[i] != null) continue;
        let prev = null, next = null;
        for (let k = 1; k <= 12; k++) { if (out[(i - k + 12) % 12] != null) { prev = out[(i - k + 12) % 12]; break; } }
        for (let k = 1; k <= 12; k++) { if (out[(i + k) % 12] != null) { next = out[(i + k) % 12]; break; } }
        out[i] = (prev != null && next != null) ? (prev + next) / 2 : (prev != null ? prev : (next != null ? next : 15));
      }
      return out;
    }

    // 정점 하나의 실데이터(현재값 + 최근 5년 월별 평균 + 올해 연초~오늘 실측)를
    // 가져옵니다. 한 번 가져온 정점은 세션 동안 캐시해서 재선택 시 다시 안 부릅니다.
    async function fetchStationRealData(station) {
      if (station._liveCache) return station._liveCache;

      const lat = station.coords[1], lon = station.coords[0];
      const now = new Date();
      const thisYear = now.getFullYear();
      const todayStr = isoDate(now);
      const janFirst = `${thisYear}-01-01`;
      const fiveYearsAgoStart = `${thisYear - 5}-01-01`;
      const lastFullYearEnd = `${thisYear - 1}-12-31`;

      const currentUrl = `${LIVE_DATA_BASE}?latitude=${lat}&longitude=${lon}&current=sea_surface_temperature&timezone=auto`;
      const histUrl = `${LIVE_DATA_BASE}?latitude=${lat}&longitude=${lon}&start_date=${fiveYearsAgoStart}&end_date=${lastFullYearEnd}&daily=sea_surface_temperature_mean&timezone=auto`;
      const actualUrl = `${LIVE_DATA_BASE}?latitude=${lat}&longitude=${lon}&start_date=${janFirst}&end_date=${todayStr}&daily=sea_surface_temperature_mean&timezone=auto`;

      const [currentRes, histRes, actualRes] = await Promise.all([
        fetchJSON(currentUrl), fetchJSON(histUrl), fetchJSON(actualUrl)
      ]);

      const currentTemp = currentRes.current && typeof currentRes.current.sea_surface_temperature === 'number'
        ? currentRes.current.sea_surface_temperature
        : null;
      if (currentTemp === null) throw new Error('no current SST for this station');

      // 최근 5년(올해 제외) 일별 데이터를 월별 평균으로 묶습니다 - 이게 진짜 "5년 평균"입니다.
      const monthlySums = Array(12).fill(0);
      const monthlyCounts = Array(12).fill(0);
      if (histRes.daily && histRes.daily.time) {
        histRes.daily.time.forEach((dateStr, i) => {
          const v = histRes.daily.sea_surface_temperature_mean[i];
          if (typeof v === 'number') {
            const m = new Date(dateStr + 'T00:00:00Z').getUTCMonth();
            monthlySums[m] += v;
            monthlyCounts[m]++;
          }
        });
      }
      const climByMonthRaw = monthlySums.map((sum, i) => monthlyCounts[i] > 0 ? sum / monthlyCounts[i] : null);
      const climByMonth = fillMonthlyGaps(climByMonthRaw);

      // 올해 연초~오늘 실측값 (x = 월 인덱스 + 그 달 안에서의 날짜 비율)
      const actualLine = [];
      if (actualRes.daily && actualRes.daily.time) {
        actualRes.daily.time.forEach((dateStr, i) => {
          const v = actualRes.daily.sea_surface_temperature_mean[i];
          if (typeof v === 'number') {
            const d = new Date(dateStr + 'T00:00:00Z');
            const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
            const x = d.getUTCMonth() + (d.getUTCDate() - 1) / dim;
            actualLine.push({ x, y: +v.toFixed(2) });
          }
        });
      }

      const result = { currentTemp, climByMonth, actualLine, isLive: true };
      station._liveCache = result;
      return result;
    }

    // climByMonth(12개 월별 평균)에서 임의의 소수 x(0~11) 지점 값을 부드럽게 보간
    function climAtFromMonthly(climByMonth, x) {
      const i0 = ((Math.floor(x) % 12) + 12) % 12;
      const i1 = (i0 + 1) % 12;
      const frac = x - Math.floor(x);
      return climByMonth[i0] + (climByMonth[i1] - climByMonth[i0]) * frac;
    }
