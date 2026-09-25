    // [ADD] "현재+과거 데이터를 실제로 가져와서 그래프 만들 수 있어?" 요청 반영.
    // Open-Meteo Marine API(무료, API 키 불필요, CORS 허용, ERA5-Ocean 기반이라
    // 1940년부터의 실측 해수면온도를 제공)를 브라우저에서 직접 호출합니다.
    // 이 앱이 Claude가 호스팅하는 페이지가 아니라 로컬 HTML 파일이라 가능한
    // 방식이에요 - 그냥 브라우저에서 여는 보통 웹페이지처럼 동작합니다.
    const LIVE_DATA_BASE = 'https://marine-api.open-meteo.com/v1/marine';

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
      const url = `${LIVE_DATA_BASE}?latitude=${lat}&longitude=${lon}&hourly=sea_surface_temperature,sea_level_height_msl&past_days=2&forecast_days=3&timezone=auto`;
      const res = await fetchJSON(url);
      const h = res && res.hourly;
      if (!h || !h.time) throw new Error('no hourly data');

      // API가 돌려준 현지 시각 문자열("2026-09-25T14:00")을 그대로 ms로 바꿔서
      // (UTC로 취급) x축에 씁니다 - 표시할 때도 UTC로 읽어서 현지 시각 유지.
      const offsetSec = res.utc_offset_seconds || 0;
      const nowLocalMs = Date.now() + offsetSec * 1000;
      const from = nowLocalMs - 48 * 3600 * 1000, to = nowLocalMs + 48 * 3600 * 1000;

      const temp = [], tide = [];
      h.time.forEach((ts, i) => {
        const x = Date.parse(ts + ':00Z');
        if (x < from - 3600 * 1000 || x > to + 3600 * 1000) return;
        const tv = h.sea_surface_temperature && h.sea_surface_temperature[i];
        const sv = h.sea_level_height_msl && h.sea_level_height_msl[i];
        if (typeof tv === 'number') temp.push({ x, y: +tv.toFixed(2) });
        if (typeof sv === 'number') tide.push({ x, y: +sv.toFixed(2) });
      });
      if (temp.length < 6 && tide.length < 6) throw new Error('no hourly data');

      // 만조/간조: 앞뒤 값보다 크거나(만조) 작은(간조) 지점
      const extremes = [];
      for (let i = 1; i < tide.length - 1; i++) {
        const a = tide[i - 1].y, b = tide[i].y, c = tide[i + 1].y;
        if (b > a && b >= c) extremes.push({ ...tide[i], type: 'high' });
        else if (b < a && b <= c) extremes.push({ ...tide[i], type: 'low' });
      }

      const result = { temp, tide, extremes, nowLocalMs, from, to };
      station._hourlyCache = result;
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
