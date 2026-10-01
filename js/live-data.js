    // [ADD] "현재+과거 데이터를 실제로 가져와서 그래프 만들 수 있어?" 요청 반영.
    // Open-Meteo Marine API(무료, API 키 불필요, CORS 허용, ERA5-Ocean 기반이라
    // 1940년부터의 실측 해수면온도를 제공)를 브라우저에서 직접 호출합니다.
    // 이 앱이 Claude가 호스팅하는 페이지가 아니라 로컬 HTML 파일이라 가능한
    // 방식이에요 - 그냥 브라우저에서 여는 보통 웹페이지처럼 동작합니다.
    const LIVE_DATA_BASE = 'https://marine-api.open-meteo.com/v1/marine';
    const WEATHER_API_BASE = 'https://api.open-meteo.com/v1/forecast'; // [ADD] 바람(풍속·풍향·돌풍)
    // [CHANGE] "스크롤로 전날·다음 날로 넘어가게" - 실시간 현황 표 범위.
    // Open-Meteo 해양 예보는 최대 8일(오늘 포함)까지라 앞으로 약 7일, 뒤로 6일을
    // 받아요(총 14일). 2주를 넘기면 Open-Meteo가 요청을 여러 건으로 세서 이 안에 맞췄어요.
    const NOW_PAST_DAYS = 6, NOW_FORECAST_DAYS = 8;

    // [FIX] "API 하나 안되면 전체가 멈추는 게 말이 안돼" 요청 반영 -
    // 스크린샷으로 확인해보니 429(Too Many Requests, 요청 과다)였어요.
    // 짧은 시간에 정점 검증 요청을 너무 많이 한꺼번에 보내서 걸린 거예요.
    // 429를 받으면 잠깐 기다렸다가 자동으로 재시도하도록 여기(모든 API
    // 호출이 거쳐가는 공통 지점)에 넣었습니다.
    async function fetchJSON(url, timeoutMs, maxRetries) {
      const retries = maxRetries != null ? maxRetries : 2;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
        try {
          const res = await fetch(url, { signal: controller.signal });
          // [FIX] "Couldn't load data" - Open-Meteo 무료 한도는 방문자 IP마다
          // 분당 600건 / 하루 1만 건이에요. "하루 한도 초과"는 몇 초 기다려도
          // 풀리지 않아서 재시도하면 요청만 낭비됩니다 - 바로 구분해서 알립니다.
          if (res.status === 429) {
            let reason = '';
            try { reason = (await res.clone().json()).reason || ''; } catch (_) {}
            if (/daily/i.test(reason)) { clearTimeout(timer); const err = new Error('DAILY_LIMIT'); err.code = 'DAILY_LIMIT'; throw err; }
          }
          if (res.status === 429 && attempt < retries) {
            clearTimeout(timer);
            await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
            continue;
          }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return await res.json();
        } finally {
          clearTimeout(timer);
        }
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
        // [CHANGE] "station 빼면 다 진짜야?" 질문 반영 - 검증할 때 이미 받아온
        // 실제 현재 수온을 버리지 않고 그대로 돌려줘서, 마커 색/배경 히트맵/
        // 클릭 직후 표시값까지 전부 이 실제값을 쓰도록 했습니다.
        return stationsChunk.map((st, i) => {
          const entry = list[i];
          const val = entry && entry.current && entry.current.sea_surface_temperature;
          const ok = typeof val === 'number' && !Number.isNaN(val);
          return { ok, temp: ok ? val : null };
        });
      } catch (e) {
        // 네트워크 문제 등으로 검증 자체가 실패하면, 정점을 함부로 지우지 않고
        // 일단 살려둡니다 (오프라인이어도 앱이 완전히 비어버리진 않게).
        console.warn('[live-data] 배치 검증 실패 - 이 배치는 유지합니다:', e);
        return stationsChunk.map(() => ({ ok: true, temp: null }));
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

      // [FIX] "429(요청 과다)로 정점 검증이 실패함" - 원인은 ~28개 배치
      // 요청을 Promise.all로 전부 한꺼번에 쏘고 있었던 거예요. 동시에
      // 나가는 요청 개수를 제한해서(4개씩 묶어 처리) 순간적으로 너무
      // 많은 요청이 한꺼번에 나가지 않도록 했습니다.
      const CONCURRENCY = 4;
      let done = 0;
      const allSurvivors = [];
      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const batch = chunks.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(async (chunk) => {
          const chunkResults = await batchCheckHasData(chunk);
          done += chunk.length;
          if (onProgress) onProgress(Math.min(allStations.length, done), allStations.length);
          const survivors = [];
          chunk.forEach((st, idx) => {
            if (!chunkResults[idx].ok) return;
            // [ADD] 검증 때 받은 실제 현재값을 station.curTemp에 반영 -
            // 이제 마커 색, 배경 히트맵, 클릭 직후 표시값까지 전부 이 실제값을 씁니다.
            if (chunkResults[idx].temp != null) {
              st.curTemp = +chunkResults[idx].temp.toFixed(1);
              st._liveCurrentVerified = true;
            }
            survivors.push(st);
          });
          return survivors;
        }));
        allSurvivors.push(...results.flat());
      }
      return allSurvivors;
    }

    // [CHANGE] "가장 가까운 정점 하나 말고 주변 정점들 평균을 반영해줘"
    // 요청 반영 - 근처 실데이터(_liveCache) 정점 중 하나만 빌려쓰던 것을,
    // 가까운 순서로 여러 개(최대 5개)를 모아 거리 가중 평균한 월별 곡선으로
    // 바꿨습니다. 특정 정점 하나의 특이값에 휘둘리지 않고 더 안정적이에요.
    function getNearbyLiveClimAverage(station, maxCount) {
      const candidates = [];
      stations.forEach(s => {
        if (s === station || !s._liveCache) return;
        const dLat = station.coords[1] - s.coords[1];
        let dLon = station.coords[0] - s.coords[0];
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const d = Math.sqrt(dLat * dLat + dLon * dLon);
        candidates.push({ s, d });
      });
      if (!candidates.length) return null;
      candidates.sort((a, b) => a.d - b.d);
      const top = candidates.slice(0, maxCount || 5);

      const climByMonth = Array(12).fill(0);
      let wSum = 0;
      top.forEach(({ s, d }) => {
        const w = 1 / (d + 1); // 가까울수록 더 큰 가중치
        wSum += w;
        s._liveCache.climByMonth.forEach((v, i) => { climByMonth[i] += v * w; });
      });
      return { climByMonth: climByMonth.map(v => v / wSum), usedCount: top.length };
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
    // [FIX] "정점 어디에도 라이브 데이터가 안 떠, 이게 제일 중요한 문제야"
    // 진짜 원인을 찾았어요. Open-Meteo 해양(Marine) API는 예보용
    // 엔드포인트라 과거 데이터를 최대 약 92일까지만 지원하는데(5년치
    // "평년" 데이터 같은 장기 아카이브는 이 API에 아예 없어요), 저희가
    // 5년 전부터의 데이터를 요청하고 있었어요. 그 요청은 API가 거부해서
    // 항상 실패하는데, Promise.all은 묶은 요청 중 하나라도 실패하면
    // 전체가 실패 처리되기 때문에, current(현재값)는 멀쩡히 성공했어도
    // 5년 요청 하나 때문에 매번 전체가 실패로 끝나서 모든 정점이 항상
    // "추정값"으로만 표시됐던 거예요. 5년 평년 요청은 아예 빼고, 실제로
    // 이 API가 지원하는 "최근 90일 실측"만 가져오도록 고쳤습니다 -
    // 이제 현재값과 최근 90일 추이는 진짜 실데이터입니다. 5~6년 평년
    // 곡선은 이 API로는 구할 수 없는 정보라 계절 공식으로 채우고,
    // 화면에도 그 부분만 별도로 추정치라고 표시합니다.
    // [FIX] "여전히 라이브 데이터를 못 찾았어" - Open-Meteo 공식 문서를
    // 직접 열어서 확인했어요. 해양 API의 "일별(daily) 변수" 목록에는
    // 파도 관련 값들(wave_height_max 등)만 있고, sea_surface_temperature_mean
    // 이라는 일별 변수는 아예 존재하지 않았습니다 - 수온은 시간별(hourly)
    // 또는 현재값(current)으로만 제공돼요. 지난번 수정은 "5년 전 날짜"
    // 문제만 고쳤을 뿐, 있지도 않은 파라미터를 계속 요청하고 있어서
    // 여전히 항상 실패하고 있었던 거예요. 이제 hourly로 시간별 수온을
    // 받아와서 같은 날짜끼리 직접 평균을 내는 방식으로 고쳤습니다 -
    // 이 파라미터(hourly=sea_surface_temperature)는 문서에 실제로 있는
    // 값이라 이번엔 확실합니다.
    async function fetchStationRealData(station) {
      if (station._liveCache) return station._liveCache;

      const lat = station.coords[1], lon = station.coords[0];

      const currentUrl = `${LIVE_DATA_BASE}?latitude=${lat}&longitude=${lon}&current=sea_surface_temperature&timezone=auto`;
      const actualUrl = `${LIVE_DATA_BASE}?latitude=${lat}&longitude=${lon}&hourly=sea_surface_temperature&past_days=90&forecast_days=0&timezone=auto`;

      // [FIX] "API 하나 안되면 전체가 멈추는 건 말이 안돼, 병행 연결하면
      // 하나가 안 나와도 괜찮을 것 같아" 요청 반영 - Promise.all은 묶은
      // 요청 중 하나라도 실패하면 전체가 실패 처리되는데, Promise.allSettled로
      // 바꿔서 각 요청의 성공/실패를 따로 확인합니다. 예를 들어 "최근 90일
      // 실측" 쪽이 429로 실패해도, "현재값"만 성공했으면 그 현재값은
      // 살려서 라이브 데이터로 씁니다(다만 실측 추이 구간만 비어 보여요).
      const [currentSettled, actualSettled] = await Promise.allSettled([
        fetchJSON(currentUrl), fetchJSON(actualUrl)
      ]);
      const currentRes = currentSettled.status === 'fulfilled' ? currentSettled.value : null;
      const actualRes = actualSettled.status === 'fulfilled' ? actualSettled.value : null;

      const currentTemp = currentRes && currentRes.current && typeof currentRes.current.sea_surface_temperature === 'number'
        ? currentRes.current.sea_surface_temperature
        : null;
      if (currentTemp === null) throw new Error('no current SST for this station');

      // 시간별 값을 날짜별로 묶어서 일평균을 직접 계산합니다
      // (x = 월 인덱스 + 그 달 안에서의 날짜 비율). actualRes가 실패했으면
      // (null) 그냥 빈 배열로 - 현재값/평년은 정상 표시되고 실측 구간만 비어요.
      const dailyMap = {};
      if (actualRes && actualRes.hourly && actualRes.hourly.time) {
        actualRes.hourly.time.forEach((dtStr, i) => {
          const v = actualRes.hourly.sea_surface_temperature[i];
          if (typeof v !== 'number') return;
          const dateStr = dtStr.slice(0, 10);
          if (!dailyMap[dateStr]) dailyMap[dateStr] = { sum: 0, count: 0 };
          dailyMap[dateStr].sum += v;
          dailyMap[dateStr].count++;
        });
      }
      const actualLine = Object.keys(dailyMap).sort().map(dateStr => {
        const avg = dailyMap[dateStr].sum / dailyMap[dateStr].count;
        const d = new Date(dateStr + 'T00:00:00Z');
        const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        const x = d.getUTCMonth() + (d.getUTCDate() - 1) / dim;
        return { x, y: +avg.toFixed(2) };
      });

      // [CHANGE] 5~6년 평년 데이터는 이 API가 애초에 제공하지 않는
      // 범위라, 계절 사인파(위도로 위상 보정)로 채웁니다. climIsEstimated로
      // 표시해서 화면에 "이 곡선은 추정"이라고 구분해 보여줄 수 있게 했습니다.
      const phaseShift = lat < 0 ? 6 : 0;
      const climByMonth = Array.from({ length: 12 }, (_, m) =>
        Math.max(0, currentTemp + Math.sin((m - 3 + phaseShift) * (Math.PI / 6)) * 4)
      );

      const result = { currentTemp, climByMonth, actualLine, isLive: true, climIsEstimated: true };
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

    // [CHANGE] "수온 옆에 조석을 같이, 둘 다 ±2일(4일치)로" 요청 반영 - 첫 번째
    // 탭용 데이터. Open-Meteo 해양 API에서 시간별 수온(sea_surface_temperature)과
    // 해수면 높이(sea_level_height_msl, 조석+기압·바람 영향 포함, 평균해수면 기준 m)를
    // "한 번의 요청"으로 같이 받아서 오늘 기준 앞뒤 2일만 씁니다.
    // 해안 가까이에선 모델 해상도(수 km) 한계로 실제 항구 조위표와 차이가
    // 날 수 있어서, 화면에도 "참고용"으로 표시합니다.
    async function fetchStationHourly(station) {
      if (station._hourlyCache) return station._hourlyCache;
      const lat = station.coords[1], lon = station.coords[0];
      // [ADD] "바람·파도도 같이" 요청 반영 - 파고/풍랑/너울은 같은 해양 API
      // 요청에 항목만 더해서(요청 수 그대로), 바람은 Open-Meteo 날씨 API에서
      // 1건 더 받아옵니다. 바람 요청이 실패해도 수온·조석·파도는 그대로 보여요.
      const url = `${LIVE_DATA_BASE}?latitude=${lat}&longitude=${lon}&hourly=sea_surface_temperature,sea_level_height_msl,wave_height,wind_wave_height,swell_wave_height,swell_wave_period,swell_wave_direction&past_days=${NOW_PAST_DAYS}&forecast_days=${NOW_FORECAST_DAYS}&timezone=auto`;
      const windUrl = `${WEATHER_API_BASE}?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms&past_days=${NOW_PAST_DAYS}&forecast_days=${NOW_FORECAST_DAYS}&timezone=auto`;
      const [marineSettled, windSettled] = await Promise.allSettled([fetchJSON(url), fetchJSON(windUrl)]);
      if (marineSettled.status !== 'fulfilled') throw marineSettled.reason;
      const res = marineSettled.value;
      const windRes = windSettled.status === 'fulfilled' ? windSettled.value : null;
      if (!windRes) console.warn('[hourly] 바람 데이터 실패 - 바람 없이 표시:', windSettled.reason);
      const h = res && res.hourly;
      if (!h || !h.time) throw new Error('no hourly data');

      // API가 돌려준 현지 시각 문자열("2026-09-25T14:00")을 그대로 ms로 바꿔서
      // (UTC로 취급) x축에 씁니다 - 표시할 때도 UTC로 읽어서 현지 시각 유지.
      const offsetSec = res.utc_offset_seconds || 0;
      const nowLocalMs = Date.now() + offsetSec * 1000;
      // 오늘 0시 기준으로 과거 NOW_PAST_DAYS일 ~ 예보 끝(오늘 포함 NOW_FORECAST_DAYS일)
      const todayStart = Math.floor(nowLocalMs / 86400000) * 86400000;
      const from = todayStart - NOW_PAST_DAYS * 86400000, to = todayStart + NOW_FORECAST_DAYS * 86400000 - 3600 * 1000;

      const temp = [], tide = [], waves = [], wind = [];
      const num = (arr, i) => (arr && typeof arr[i] === 'number') ? arr[i] : null;
      h.time.forEach((ts, i) => {
        const x = Date.parse(ts + ':00Z');
        if (x < from - 3600 * 1000 || x > to + 3600 * 1000) return;
        const tv = num(h.sea_surface_temperature, i);
        const sv = num(h.sea_level_height_msl, i);
        if (tv != null) temp.push({ x, y: +tv.toFixed(2) });
        if (sv != null) tide.push({ x, y: +sv.toFixed(2) });
        const wh = num(h.wave_height, i);
        if (wh != null) waves.push({
          x, height: wh, windWave: num(h.wind_wave_height, i), swell: num(h.swell_wave_height, i),
          swellPeriod: num(h.swell_wave_period, i), swellDir: num(h.swell_wave_direction, i)
        });
      });
      if (windRes && windRes.hourly && windRes.hourly.time) {
        const wh = windRes.hourly;
        wh.time.forEach((ts, i) => {
          const x = Date.parse(ts + ':00Z');
          if (x < from - 3600 * 1000 || x > to + 3600 * 1000) return;
          const sp = num(wh.wind_speed_10m, i), dir = num(wh.wind_direction_10m, i);
          if (sp != null && dir != null) wind.push({ x, speed: sp, gust: num(wh.wind_gusts_10m, i), dir });
        });
      }
      if (temp.length < 6 && tide.length < 6) throw new Error('no hourly data');

      // 만조/간조: 앞뒤 값보다 크거나(만조) 작은(간조) 지점
      const extremes = [];
      for (let i = 1; i < tide.length - 1; i++) {
        const a = tide[i - 1].y, b = tide[i].y, c = tide[i + 1].y;
        if (b > a && b >= c) extremes.push({ ...tide[i], type: 'high' });
        else if (b < a && b <= c) extremes.push({ ...tide[i], type: 'low' });
      }

      const result = { temp, tide, waves, wind, extremes, nowLocalMs, from, to };
      station._hourlyCache = result;
      // [ADD] 한국·미국 정점이면 근처 관측소 실측을 뒤이어 불러와 지금까지 칸을 실측으로 바꿔요(표는 먼저 그려짐)
      mergeNearbyObs(station).then(ok => {
        if (!ok) return;
        if (selectedStation === station && typeof updateChart === 'function') {
          const el = document.getElementById('st-temp'); if (el) el.innerText = formatTemp(station.curTemp);
          updateChart();
        }
      }).catch(e => console.warn('[obs] 실측 합치기 실패:', e));
      return result;
    }

    // [ADD] 위성 수온 격자(1°, 360×180)를 한 번만 받아서 앱 전체가 같이 씁니다
    // - 지구본 바다 색상 레이어와 정점 색상(검증)이 모두 이 격자를 사용해요.
    // 1순위: 우리 Vercel 서버(/api/sst, 캐시되어 빠르고 가벼움)
    // 2순위: 원본 PacIOOS ERDDAP에서 직접(CORS 허용이라 로컬 파일로 열어도 됨)
    // [FIX] "조석이 계속 로딩" - 진짜 원인은 앱을 켤 때마다 정점 약 1,500개의
    // 현재 수온을 Open-Meteo에 확인하느라, Open-Meteo 무료 한도(분당 600건,
    // 하루 1만 건 - 지점 하나가 1건)를 부팅 몇 초 만에 다 써버린 거였어요.
    // 그래서 뒤이어 요청한 조석 데이터가 429(요청 과다)로 계속 막혔습니다.
    // 이제 정점 색상은 이 위성 격자 한 번(요청 1건)으로 채우고, Open-Meteo는
    // 사용자가 정점을 클릭했을 때만 부릅니다.
    const SST_GRID_DIRECT_URL = 'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km.csv?CRW_SST%5B(last)%5D%5B0:20:3599%5D%5B0:20:7199%5D';
    let sstGridPromise = null;

    function parseSstCsv(text) {
      const W = 360, H = 180, LAT0 = 89.975, LON0 = -179.975;
      const v = new Array(W * H).fill(null);
      let date = null;
      const lines = text.split('\n');
      for (let i = 2; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 4) continue;
        const lat = parseFloat(cols[1]), lon = parseFloat(cols[2]), sst = parseFloat(cols[3]);
        if (!date) date = cols[0].slice(0, 10);
        if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(sst)) continue;
        const row = Math.round(LAT0 - lat), col = Math.round(lon - LON0);
        if (col < 0 || col >= W || row < 0 || row >= H) continue;
        v[row * W + col] = Math.round(sst * 10);
      }
      return { date, w: W, h: H, lat0: LAT0, lon0: LON0, scale: 0.1, v };
    }

    function getSstGrid() {
      if (sstGridPromise) return sstGridPromise;
      sstGridPromise = (async () => {
        try {
          const res = await fetch('/api/sst');
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          if (!data || !Array.isArray(data.v)) throw new Error('bad payload');
          return data;
        } catch (e) {
          console.info('[sst-grid] /api/sst 실패 → 원본 서버에서 직접 받습니다:', e.message);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
          const res = await fetch(SST_GRID_DIRECT_URL, { signal: controller.signal });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return parseSstCsv(await res.text());
        } finally {
          clearTimeout(timer);
        }
      })();
      sstGridPromise.catch(() => { sstGridPromise = null; }); // 실패하면 다음에 다시 시도 가능
      return sstGridPromise;
    }

    // 격자에서 (lat, lon)의 수온(°C). 해안 정점은 1° 칸이 육지로 잡힐 수 있어서
    // 바로 옆 칸(최대 1칸 거리)까지 찾아봅니다. 없으면 null.
    function sstAt(grid, lat, lon) {
      const row0 = Math.round(grid.lat0 - lat);
      const col0 = Math.round(lon - grid.lon0);
      const read = (r, c) => {
        if (r < 0 || r >= grid.h) return null;
        c = ((c % grid.w) + grid.w) % grid.w; // 날짜변경선 넘어가면 반대편으로
        const raw = grid.v[r * grid.w + c];
        return raw == null ? null : raw * grid.scale;
      };
      const center = read(row0, col0);
      if (center != null) return center;
      let sum = 0, n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const val = read(row0 + dr, col0 + dc);
        if (val != null) { sum += val; n++; }
      }
      return n ? sum / n : null;
    }

    // ───────────────────────── [ADD] 시야(물 투명도) 추정 ─────────────────────────
    // 자료: /api/visibility (NOAA 위성 Kd490 + 엽록소, 구름 빈칸 채운 2km 일별, 최근 90일)
    // 계산 순서(사이트에서 그대로 보여주는 것과 같아요):
    //  1) 시야(Secchi) ≈ 1.7 ÷ Kd490        - Kd490 = 빛이 물속에서 약해지는 정도(탁한 정도)
    //  2) 플랑크톤 몫 = 0.0773 × 엽록소^0.6715 - 엽록소만으로 생기는 탁도(Morel 외 2007)
    //     물 자체 몫 = 0.0166                  - 아주 깨끗한 바닷물의 기본값
    //     기타 탁도  = 나머지                  - 모래·강물·녹아있는 유기물 등
    //  3) 앞으로의 추세: 최근 7일 평균에서 90일 중앙값 쪽으로 서서히 돌아간다고 보고,
    //     날이 갈수록 커지는 오차 범위(90일 동안의 변동폭 기준)를 같이 그립니다.
    const VIS_MAX = 30, VIS_MIN = 0.5, KD_WATER = 0.0166, DAY_MS = 864e5;
    function kdFromChl(chl) { return 0.0773 * Math.pow(chl, 0.6715); }

    function computeVisibility(json) {
      const days = (json.days || []).filter(r => r.kd != null).map(r => {
        const vis = Math.max(VIS_MIN, Math.min(VIS_MAX, 1.7 / r.kd));
        const kw = Math.min(KD_WATER, r.kd);
        let kc = null, ko = null;
        if (r.chl != null) {
          kc = Math.min(kdFromChl(r.chl), Math.max(0, r.kd - kw));
          ko = Math.max(0, r.kd - kw - kc);
        }
        return { d: r.d, t: Date.parse(r.d + 'T12:00:00Z'), kd: r.kd, chl: r.chl, vis, kw, kc, ko };
      });
      if (days.length < 5) return null;
      days.forEach(x => {
        const w = days.filter(y => Math.abs(y.t - x.t) <= 3.5 * DAY_MS);
        x.vis7 = Math.exp(w.reduce((a, y) => a + Math.log(y.vis), 0) / w.length);
      });
      const sorted = days.map(x => x.vis).sort((a, b) => a - b);
      const q = (p) => sorted[Math.round(p * (sorted.length - 1))];
      const median = q(0.5), p10 = q(0.1), p90 = q(0.9);
      const logs = days.map(x => Math.log(x.vis));
      const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
      const sd = Math.max(0.12, Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length));

      const last = days[days.length - 1];
      const startLog = Math.log(last.vis7), medLog = Math.log(median);
      const projection = [];
      const end = Date.now() + 30 * DAY_MS;
      for (let tt = last.t; tt <= end; tt += DAY_MS) {
        const k = (tt - last.t) / DAY_MS;
        const L = medLog + (startLog - medLog) * Math.exp(-k / 12);
        const e = sd * Math.min(1.3, Math.sqrt(k / 10));
        projection.push({ t: tt, vis: Math.exp(L), lo: Math.max(VIS_MIN, Math.exp(L - e)), hi: Math.min(VIS_MAX, Math.exp(L + e)) });
      }
      const nowP = projection.reduce((b, p) => Math.abs(p.t - Date.now()) < Math.abs(b.t - Date.now()) ? p : b, projection[0]);
      // 최근 7일 원인 비율
      const recent = days.filter(x => x.t > last.t - 7 * DAY_MS && x.kc != null);
      let share = null;
      if (recent.length) {
        const s = recent.reduce((a, x) => ({ kd: a.kd + x.kd, kc: a.kc + x.kc, ko: a.ko + x.ko, chl: a.chl + x.chl }), { kd: 0, kc: 0, ko: 0, chl: 0 });
        share = { plankton: s.kc / s.kd, other: s.ko / s.kd, chl: s.chl / recent.length };
      }
      return { days, median, p10, p90, sd, last, projection, now: nowP, share, hasChl: !!json.hasChl, pixel: json.pixel };
    }

    // 시야 숫자 표기: 10m 미만은 소수 한 자리, 30m 이상은 "30m+"
    function fmtVis(v) {
      if (v == null) return '–';
      if (v >= VIS_MAX - 0.05) return VIS_MAX + 'm+';
      return (v < 10 ? v.toFixed(1) : Math.round(v)) + 'm';
    }

    async function fetchStationVisibility(st) {
      const lat = st.coords[1], lon = st.coords[0];
      const j = await fetchJSON(`/api/visibility?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`, 40000, 0);
      if (!j || !j.ok) { const err = new Error(j && j.reason || 'NO_DATA'); err.code = j && j.reason; throw err; }
      const v = computeVisibility(j);
      if (!v) throw new Error('NO_DATA');
      st._visCache = v;
      return v;
    }

    // ───────── [ADD] 근처 관측소 실측으로 실시간 현황표의 "지금까지" 칸 채우기 ─────────
    // 정점은 그대로 두고, 가까운 공식 관측소가 있으면 그 실측을 1시간 단위로 묶어 과거~지금 칸에 넣어요.
    //  - 한국: 국립해양조사원(KHOA) 조위관측소 - 수온·바람·조위 (반경 25km)
    //  - 미국: NOAA CO-OPS 조위관측소 - 수온·바람·조위 + 앞으로의 조석 예측 (반경 25km)
    //          NOAA NDBC 부이 - 파고·주기 (+ CO-OPS 수온이 없으면 수온) (반경 60km)
    // 앞으로의 칸은 모델 예보 그대로(미국 조석만 NOAA 예측으로). 실측 칸은 숫자 아래 점으로 표시돼요.
    const OBS_RADIUS_KM = 25, BUOY_RADIUS_KM = 60, HOUR_MS = 3600e3;

    function haversineKm(lat1, lon1, lat2, lon2) {
      const R = 6371, rad = Math.PI / 180;
      const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    }
    function nearestOf(list, lat, lon, maxKm, filter) {
      let best = null;
      (list || []).forEach(k => {
        if (filter && !filter(k)) return;
        const dist = haversineKm(lat, lon, k.lat, k.lon);
        if (dist <= maxKm && (!best || dist < best.dist)) best = { ...k, dist };
      });
      return best;
    }
    const inKoreaWaters = (lat, lon) => lat > 32 && lat < 39.5 && lon > 124 && lon < 132.5;
    // 미국 본토·알래스카·하와이·카리브(푸에르토리코)·괌/사이판
    const inUsWaters = (lat, lon) => (lon > -180 && lon < -60 && lat > 10 && lat < 72) || (lon > 140 && lon < 150 && lat > 10 && lat < 22);
    const localStrToX = (s) => Date.parse(String(s).replace(' ', 'T') + ':00Z'); // "YYYY-MM-DD HH:MM"(현지 시각) → 표의 x
    const memo = {};
    const once = (key, fn) => (memo[key] = memo[key] || fn().catch(e => { delete memo[key]; throw e; }));

    // 같은 시간(정시 ±30분)끼리 묶기
    function groupHourly(points) {
      const by = new Map();
      points.forEach(p => { const h = Math.round(p.x / HOUR_MS) * HOUR_MS; if (!by.has(h)) by.set(h, []); by.get(h).push(p); });
      return [...by.keys()].sort((a, b) => a - b).map(h => ({ x: h, g: by.get(h) }));
    }
    const avgOf = (g, k) => { const v = g.map(r => r[k]).filter(x => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const maxOf = (g, k) => { const v = g.map(r => r[k]).filter(x => x != null && Number.isFinite(x)); return v.length ? Math.max(...v) : null; };
    function circMean(g, k) {
      const v = g.map(r => r[k]).filter(x => x != null && Number.isFinite(x));
      if (!v.length) return null;
      const s = v.reduce((a, d) => a + Math.sin(d * Math.PI / 180), 0), c = v.reduce((a, d) => a + Math.cos(d * Math.PI / 180), 0);
      return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360;
    }
    // 원시 측정(x, wt, ws, wd, gust, tide, wv, per) → 1시간 시계열
    function toHourly(raw) {
      const temp = [], wind = [], tide = [], waves = [];
      groupHourly(raw).forEach(({ x, g }) => {
        const wt = avgOf(g, 'wt'); if (wt != null && wt > -3 && wt < 40) temp.push({ x, y: +wt.toFixed(2), obs: true });
        const ws = avgOf(g, 'ws'), wd = circMean(g, 'wd'); if (ws != null && wd != null) wind.push({ x, speed: ws, dir: wd, gust: maxOf(g, 'gust'), obs: true });
        const td = avgOf(g, 'tide'); if (td != null) tide.push({ x, y: td });
        const wv = avgOf(g, 'wv'); if (wv != null) waves.push({ x, height: wv, swellPeriod: avgOf(g, 'per'), obs: true });
      });
      return { temp, wind, tide, waves };
    }
    // 모델 시계열에서 실측이 있는 시간까지는 실측으로 교체
    function splice(modelArr, obsArr) {
      if (!obsArr.length) return modelArr;
      const last = obsArr[obsArr.length - 1].x;
      return [...obsArr, ...modelArr.filter(o => o.x > last)];
    }
    function recomputeExtremes(tide) {
      const ex = [];
      for (let i = 1; i < tide.length - 1; i++) {
        const a = tide[i - 1].y, b = tide[i].y, c = tide[i + 1].y;
        if (b > a && b >= c) ex.push({ ...tide[i], type: 'high' });
        else if (b < a && b <= c) ex.push({ ...tide[i], type: 'low' });
      }
      return ex;
    }
    // 실측 조위(기준면이 달라도 됨)를 모델과 같은 평균해면 기준으로 맞추고, 이후 모델 곡선을 끊김 없이 이어 붙임
    function spliceTideRelative(d, obsTide) {
      if (obsTide.length < 12) return;
      const first = obsTide[0].x, last = obsTide[obsTide.length - 1].x;
      const obsMean = obsTide.reduce((a, o) => a + o.y, 0) / obsTide.length;
      const modelIn = d.tide.filter(o => o.x >= first && o.x <= last);
      const modelMean = modelIn.length ? modelIn.reduce((a, o) => a + o.y, 0) / modelIn.length : 0;
      const obs = obsTide.map(o => ({ x: o.x, y: +(o.y - obsMean + modelMean).toFixed(2), obs: true }));
      const modelAt = interpAt(d.tide, last);
      const delta = modelAt != null ? obs[obs.length - 1].y - modelAt : 0;
      const future = d.tide.filter(o => o.x > last).map(o => ({ x: o.x, y: +(o.y + delta * Math.exp(-(o.x - last) / (6 * HOUR_MS))).toFixed(2) }));
      d.tide = [...obs, ...future];
      d.extremes = recomputeExtremes(d.tide);
    }

    // ── 한국: KHOA ──
    async function khoaObs(lat, lon) {
      const j = await once('khoa-st', () => fetchJSON('/api/khoa?svc=stations', 45000, 0));
      const p = nearestOf(j && j.ok ? j.stations : [], lat, lon, OBS_RADIUS_KM);
      if (!p) return null;
      const o = await fetchJSON(`/api/khoa?svc=obs&obs=${p.code}&days=${Math.min(7, NOW_PAST_DAYS + 1)}`, 25000, 0);
      const raw = ((o && o.ok && o.rows) || []).map(r => ({ x: localStrToX(r.t), wt: r.wt, ws: r.ws, wd: r.wd, gust: r.gust, tide: r.tide != null ? r.tide / 100 : null }));
      if (raw.length < 6) return null;
      return { hourly: toHourly(raw), sources: [{ kind: 'khoa', name: p.name, dist: p.dist }] };
    }

    // ── 미국: NOAA CO-OPS + NDBC ──
    const COOPS = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
    async function coopsGet(id, product, extra) {
      const url = `${COOPS}?station=${id}&product=${product}&units=metric&time_zone=lst_ldt&format=json&application=OceanTemp${extra || ''}`;
      const j = await fetchJSON(url, 15000, 0).catch(() => null);
      return j && !j.error ? j : null;
    }
    const ymdLocal = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
    async function noaaObs(lat, lon, d) {
      const st = await once('noaa-st', () => fetchJSON('/api/noaa?svc=stations', 45000, 0));
      if (!st || !st.ok) return null;
      const wlSt = nearestOf(st.coops, lat, lon, OBS_RADIUS_KM, s => s.wl);
      const wtSt = nearestOf(st.coops, lat, lon, OBS_RADIUS_KM, s => s.wt);
      const buoy = nearestOf(st.ndbc, lat, lon, BUOY_RADIUS_KM);
      if (!wlSt && !wtSt && !buoy) return null;
      const hours = (NOW_PAST_DAYS + 1) * 24;
      const futureFrom = ymdLocal(d.nowLocalMs);
      const futureHours = Math.max(24, Math.round((d.to - d.nowLocalMs) / HOUR_MS) + 24);
      const [lev, tmp, wnd, pred, hilo, nd] = await Promise.all([
        wlSt ? coopsGet(wlSt.id, 'water_level', `&datum=MSL&range=${hours}`) : null,
        wtSt ? coopsGet(wtSt.id, 'water_temperature', `&range=${hours}`) : null,
        (wlSt || wtSt) ? coopsGet((wlSt || wtSt).id, 'wind', `&range=${hours}`) : null,
        wlSt ? coopsGet(wlSt.id, 'predictions', `&datum=MSL&interval=h&begin_date=${futureFrom}&range=${futureHours}`) : null,
        wlSt ? coopsGet(wlSt.id, 'predictions', `&datum=MSL&interval=hilo&begin_date=${futureFrom}&range=${futureHours}`) : null,
        buoy ? fetchJSON(`/api/noaa?svc=ndbc&id=${buoy.id}`, 20000, 0).catch(() => null) : null
      ]);
      const raw = [];
      (lev && lev.data || []).forEach(r => raw.push({ x: localStrToX(r.t), tide: +r.v }));
      (tmp && tmp.data || []).forEach(r => raw.push({ x: localStrToX(r.t), wt: +r.v }));
      (wnd && wnd.data || []).forEach(r => raw.push({ x: localStrToX(r.t), ws: +r.s, wd: +r.d, gust: +r.g }));
      // NDBC 시각은 UTC → 이 정점의 현지 시각으로 (표와 같은 기준)
      const offset = Math.round((d.nowLocalMs - Date.now()) / 900e3) * 900e3;
      const hasCoopsTemp = !!(tmp && tmp.data && tmp.data.length);
      (nd && nd.ok && nd.rows || []).forEach(r => raw.push({
        x: r.t + offset, wv: r.wvht, per: r.dpd, ...(hasCoopsTemp ? {} : { wt: r.wtmp })
      }));
      const hourly = toHourly(raw);
      const sources = [];
      if (wlSt && lev) sources.push({ kind: 'coops', name: wlSt.name, dist: wlSt.dist });
      if (wtSt && hasCoopsTemp && (!wlSt || wtSt.id !== wlSt.id)) sources.push({ kind: 'coops', name: wtSt.name, dist: wtSt.dist });
      if (buoy && nd && nd.ok && nd.rows.length) sources.push({ kind: 'ndbc', name: buoy.id, dist: buoy.dist });
      if (!sources.length) return null;
      // 조석 예측(NOAA 공식, 평균해면 기준) → 앞으로의 조위도 모델 대신 이걸로
      const predSeries = (pred && pred.predictions || []).map(p => ({ x: localStrToX(p.t), y: +(+p.v).toFixed(2) }));
      const hiloList = (hilo && hilo.predictions || []).map(p => ({ x: localStrToX(p.t), y: +(+p.v).toFixed(2), type: p.type === 'H' ? 'high' : 'low' }));
      return { hourly, sources, tideIsMsl: true, predSeries, hiloList };
    }

    async function mergeNearbyObs(st) {
      const d = st._hourlyCache;
      if (!d || d._obs || !/^https?:$/.test(location.protocol)) return false;
      const lat = st.coords[1], lon = st.coords[0];
      let r = null;
      if (inKoreaWaters(lat, lon)) r = await khoaObs(lat, lon);
      else if (inUsWaters(lat, lon)) r = await noaaObs(lat, lon, d);
      if (!r) { d._obs = { sources: [] }; return false; }
      const h = r.hourly;
      d.temp = splice(d.temp, h.temp);
      d.wind = splice(d.wind, h.wind);
      d.waves = splice(d.waves, h.waves);
      if (r.tideIsMsl && (h.tide.length || r.predSeries.length)) {
        // 미국: 실측(평균해면 기준) + 그 뒤로 NOAA 조석 예측
        const obs = h.tide.map(o => ({ x: o.x, y: +o.y.toFixed(2), obs: true }));
        const last = obs.length ? obs[obs.length - 1].x : -Infinity;
        const future = r.predSeries.filter(p => p.x > last);
        const rest = d.tide.filter(o => o.x > Math.max(last, future.length ? future[future.length - 1].x : -Infinity));
        d.tide = [...obs, ...future, ...rest];
        const hiloFuture = r.hiloList.filter(e => e.x > last);
        d.extremes = [...recomputeExtremes(obs).filter(e => e.x < last - 2 * HOUR_MS), ...hiloFuture];
        d._tidePred = r.predSeries.length > 0;
      } else if (h.tide.length) {
        spliceTideRelative(d, h.tide); // 한국: 관측소 기준면 → 평균해면 기준으로 맞춤
      }
      d._obs = { sources: r.sources };
      if (h.temp.length) st.curTemp = +h.temp[h.temp.length - 1].y.toFixed(1);
      return true;
    }

    // 표 아래 출처 문구용: "국립해양조사원 서귀포 관측소(1.1km) · NDBC 46026 부이(28km)"
    function obsSourceText(sources) {
      return sources.map(s => (s.kind === 'khoa' ? t.obsKhoa(s.name) : s.kind === 'ndbc' ? t.obsNdbc(s.name) : t.obsCoops(s.name)) + ` (${s.dist.toFixed(1)}km)`).join(' · ');
    }
