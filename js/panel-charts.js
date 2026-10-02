    // [ADD] 실제로 가져온 데이터(station._liveCache)로 그래프용 시계열을
    // 구성합니다. 아래 computeTimeSeriesData()와 같은 모양({climLine, actualLine,
    // projectedLine, todayPoint})을 반환해서 updateChart()가 그대로 재사용해요.
    // "미래"는 실측이 존재할 수 없으니, 실제 현재 편차를 평년으로 서서히
    // 수렴시키는 추정 방식은 그대로 유지합니다 - 다만 이제 그 출발점(현재값,
    // 평년값)이 진짜 데이터예요.
    function computeTimeSeriesDataFromLive(station) {
      const live = station._liveCache;
      const baseTemp = live.currentTemp;
      const daysInCurMonth = new Date(todayObj.getFullYear(), curMonth + 1, 0).getDate();
      // [CHANGE] "오늘이 중앙에 오게" 요청 반영 - 달력 1월~12월 고정 대신
      // windowStartMonth(오늘 달의 5달 전)부터 시작하는 이동 윈도우를 씁니다.
      const todayX = 5 + (curDate - 1) / daysInCurMonth;
      const STEPS = 48;
      const gridSpacing = 12 / STEPS;

      function calendarMonthOf(windowX) {
        return ((windowStartMonth + windowX) % 12 + 12) % 12;
      }

      function nearestActual(windowX) {
        if (!live.actualLine.length) return null;
        const calX = calendarMonthOf(windowX);
        let best = null, bestDiff = Infinity;
        for (const p of live.actualLine) {
          const diff = Math.abs(p.x - calX);
          if (diff < bestDiff) { bestDiff = diff; best = p; }
        }
        return best && bestDiff < gridSpacing * 1.5 ? best.y : null;
      }

      const baseAnomaly = baseTemp - climAtFromMonthly(live.climByMonth, calendarMonthOf(todayX));
      const climLine = [], actualLine = [], projectedLine = [], todayLine = [];
      const todayIdx = Math.round((todayX / 12) * STEPS);

      for (let s = 0; s <= STEPS; s++) {
        const x = (12 * s) / STEPS;
        const clim = climAtFromMonthly(live.climByMonth, calendarMonthOf(x));
        climLine.push({ x, y: +clim.toFixed(1) });

        if (x <= todayX) {
          const av = nearestActual(x);
          actualLine.push({ x, y: av != null ? +av.toFixed(1) : null });
        } else {
          actualLine.push({ x, y: null });
        }

        if (x >= todayX) {
          const decay = Math.exp(-(x - todayX) / 3.2);
          projectedLine.push({ x, y: +(clim + baseAnomaly * decay).toFixed(1) });
        } else {
          projectedLine.push({ x, y: null });
        }

        todayLine.push({ x, y: s === todayIdx ? +baseTemp.toFixed(1) : null });
      }

      // [ADD] 지난 해 같은 날짜 실측: 그래프 1년 범위를 하루씩, 1~3년 전 같은 날(±3일 평균)을 모아 평균·최저·최고
      const prev = live.prevDays ? prevYearsLines(live.prevDays) : null;
      if (prev && prev.nYears) {
        // 앞으로의 추정: 지난 해 평균선 + 오늘의 편차가 서서히 줄어드는 모양 (평균선이 없는 날은 월별 평년)
        const avgAt = (x) => {
          let best = null, bd = Infinity;
          for (const p of prev.avg) { if (p.y == null) continue; const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = p.y; } }
          return bd <= 0.25 ? best : null;
        };
        const a0 = avgAt(todayX);
        if (a0 != null) {
          const anomaly = baseTemp - a0;
          projectedLine.forEach(p => {
            if (p.y == null) return;
            const a = avgAt(p.x);
            if (a != null) p.y = +(a + anomaly * Math.exp(-(p.x - todayX) / 3.2)).toFixed(1);
          });
        }
      }
      return { climLine, actualLine, projectedLine, todayPoint: todayLine, prev };
    }

    // 정리된 일평균(YYYYMMDD → °C) → 그래프 x(이동 윈도우)별 지난 1~3년 같은 날짜 평균선·범위
    function prevYearsLines(days) {
      const key = (dt) => `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
      const around = (dt) => { // ±3일 평균(3일 이상 있을 때)
        let s = 0, n = 0;
        for (let o = -3; o <= 3; o++) { const v = days[key(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + o))]; if (v != null) { s += v; n++; } }
        return n >= 3 ? s / n : null;
      };
      const start = new Date(todayObj.getFullYear(), curMonth - 5, 1), end = new Date(todayObj.getFullYear(), curMonth + 7, 1);
      const avg = [], lo = [], hi = [];
      const yearsUsed = new Set();
      for (let dt = new Date(start); dt < end; dt.setDate(dt.getDate() + 1)) {
        const x = dateToWindowX(dt.getTime() + 12 * 3600e3);
        const vals = [];
        for (let k = 1; k <= 3; k++) {
          const p = new Date(dt.getFullYear() - k, dt.getMonth(), dt.getDate());
          if (p.getTime() > Date.now() - 86400e3) continue; // 아직 오지 않은 날은 제외(오늘 이후는 1년 전부터)
          const v = around(p);
          if (v != null) { vals.push(v); yearsUsed.add(k); }
        }
        avg.push({ x, y: vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null });
        lo.push({ x, y: vals.length >= 2 ? +Math.min(...vals).toFixed(2) : null });
        hi.push({ x, y: vals.length >= 2 ? +Math.max(...vals).toFixed(2) : null });
      }
      const covered = avg.filter(p => p.y != null).length;
      return covered >= 60 ? { avg, lo, hi, nYears: yearsUsed.size } : null;
    }

    function computeTimeSeriesData(station) {
      // [FIX] "오늘 데이터가 이상하다" - '오늘' 표시가 점 하나짜리 데이터셋이라
      // Chart.js의 index 매칭 모드에서 항상 "0번째 인덱스"로 잡혀서, 1월을
      // 가리켜도 계속 툴팁에 같이 떠버렸어요. 다른 선들과 똑같은 공유 x그리드
      // 위에 올리고, 진짜 오늘 위치가 아닌 칸은 전부 null로 비웠습니다.
      const baseTemp = station.curTemp;
      const lat = station.coords[1];
      const daysInCurMonth = new Date(todayObj.getFullYear(), curMonth + 1, 0).getDate();
      // [CHANGE] "오늘이 중앙에 오게" - 이동 윈도우 기준 오늘 위치
      const todayX = 5 + (curDate - 1) / daysInCurMonth;

      function calendarMonthOf(windowX) {
        return ((windowStartMonth + windowX) % 12 + 12) % 12;
      }

      // [CHANGE] "가장 가까운 정점 하나 말고 주변 정점들 평균 반영해줘" -
      // 이 정점 자체는 실데이터를 못 가져왔어도, 근처 실데이터 정점 여러 개의
      // 거리 가중 평균 곡선을 가져다가 이 정점의 실제 현재값에 맞춰
      // 눈금만 평행이동해서 씁니다.
      const nearbyAvg = getNearbyLiveClimAverage(station, 5);
      let climAt;
      if (nearbyAvg) {
        const shift = baseTemp - climAtFromMonthly(nearbyAvg.climByMonth, calendarMonthOf(todayX));
        climAt = (x) => Math.max(0, climAtFromMonthly(nearbyAvg.climByMonth, calendarMonthOf(x)) + shift);
      } else {
        // [FIX] 남반구는 계절이 반대(7월이 겨울, 1월이 여름)인데 모든 정점이
        // 같은 사인파를 썼어요. 위도가 음수면 위상을 6개월 밀었습니다.
        const phaseShift = lat < 0 ? 6 : 0;
        climAt = (x) => {
          const calX = calendarMonthOf(x);
          return Math.max(0, baseTemp + Math.sin((calX - 3 + phaseShift) * (Math.PI / 6)) * 6.5);
        };
      }

      // [FIX] "정점마다 다 올해가 평년보다 낮게 나온다" - 실제 원인은 모든
      // 정점이 "오늘 날짜" 하나로만 정해지는 같은 계절곡선 위상을 공유해서,
      // 오늘(달력상 위치)이 마침 그 곡선에서 "평년보다 살짝 낮아지는 지점"에
      // 걸려 있었기 때문에 전 지점이 똑같이 마이너스로 나왔던 거예요 - 실제
      // 지역별 편차가 아니라 모델이 우연히 만든 착시였습니다. 정점 ID로
      // 정해지는(정점마다 다르지만 매번 안 바뀌는) 편차를 더해서 정점별로
      // 따뜻한 쪽/차가운 쪽이 섞이도록 했습니다.
      const seed = ((station.id * 9301 + 49297) % 233280) / 233280; // 0~1, 정점 ID로 고정
      const stationAnomalySeed = nearbyAvg ? 0 : (seed - 0.5) * 3.2; // 주변 실데이터 평균이 있으면 이 임의 편차는 안 더함
      const baseAnomaly = (baseTemp - climAt(todayX)) * 0.3 + stationAnomalySeed;

      const STEPS = 48; // 이동 윈도우(0~12, 12개월)를 모든 선이 공유하는 촘촘한 그리드
      const climLine = [], actualLine = [], projectedLine = [], todayLine = [];
      const todayIdx = Math.round((todayX / 12) * STEPS);
      for (let s = 0; s <= STEPS; s++) {
        const x = (12 * s) / STEPS;
        climLine.push({ x, y: +climAt(x).toFixed(1) });

        // 실측값: 윈도우 시작부터 오늘까지 - 편차가 0에서 시작해 오늘 시점엔 실제 편차만큼
        if (x <= todayX) {
          const frac = todayX > 0 ? x / todayX : 1;
          actualLine.push({ x, y: +(climAt(x) + baseAnomaly * frac).toFixed(1) });
        } else {
          actualLine.push({ x, y: null });
        }

        // 추정값: 오늘부터 윈도우 끝까지 - 편차가 서서히 평년으로 수렴
        if (x >= todayX) {
          const decay = Math.exp(-(x - todayX) / 3.2);
          projectedLine.push({ x, y: +(climAt(x) + baseAnomaly * decay).toFixed(1) });
        } else {
          projectedLine.push({ x, y: null });
        }

        todayLine.push({ x, y: s === todayIdx ? +baseTemp.toFixed(1) : null });
      }

      return { climLine, actualLine, projectedLine, todayPoint: todayLine };
    }

    function getDepthProfile(surfaceTemp, isBeach) {
      // [FIX] 해변(연안)에서 500m 수심 수온이 나오는 건 비현실적이라는 지적 반영.
      // 해변은 최대 30m 안팎의 얕은 프로파일, 대양 정점은 기존처럼 깊은 프로파일을 씁니다.
      if (isBeach) {
        const depths = [0, 3, 6, 10, 15, 20, 25, 30];
        const bottomTemp = surfaceTemp - 4;
        const profile = depths.map(d => {
          if (d === 0) return surfaceTemp;
          const ratio = 1 - Math.exp(-d / 12);
          return +(surfaceTemp - (surfaceTemp - bottomTemp) * ratio).toFixed(1);
        });
        return { depths, profile };
      }
      const depths = [0, 5, 10, 20, 30, 50, 100, 200, 500];
      const deepWaterTemp = 2.0;
      const profile = depths.map(d => {
        if (d === 0) return surfaceTemp;
        const ratio = 1 - Math.exp(-d / 90);
        return +(surfaceTemp - (surfaceTemp - deepWaterTemp) * ratio).toFixed(1);
      });
      return { depths, profile };
    }

    // [CHANGE] "수온과 조석 두 그래프를 같이, 20°C = 조석 0m로 맞춰서 오른쪽
    // 끝에 m로 표시" 요청 반영 - 첫 번째 탭(±2일) 차트. 왼쪽 축은 수온(절대값),
    // 오른쪽 축은 해수면 높이(m)이고, 두 축을 같은 비율로 잡아서 왼쪽 20°C
    // 눈금과 오른쪽 0m 눈금이 항상 같은 높이에 오도록 했습니다.
    // 데이터가 없으면 "불러오는 중"을 먼저 보여주고, 실패하면 무한 재시도
    // 대신 탭을 다시 눌렀을 때만 재시도합니다.
    async function ensureHourlyData(st) {
      if (st._hourlyCache || st._hourlyState === 'loading') return;
      st._hourlyState = 'loading';
      try {
        const d = await fetchStationHourly(st);
        st._hourlyState = 'ok';
        // 헤더 수온도 이 지점의 "지금" 시간별 값으로 맞춰서 그래프와 일치시킵니다
        const nowT = interpAt(d.temp, d.nowLocalMs);
        if (nowT != null) {
          st.curTemp = +nowT.toFixed(1);
          if (selectedStation === st) document.getElementById('st-temp').innerText = formatTemp(st.curTemp);
        }
      } catch (e) {
        console.warn('[hourly] 수온·조석 데이터 가져오기 실패:', e);
        st._hourlyState = 'failed';
        st._hourlyError = e && e.code;
      }
      if (selectedStation === st) updateChart();
    }

    function interpAt(pts, x) {
      for (let i = 0; i < pts.length - 1; i++) {
        if (pts[i].x <= x && x <= pts[i + 1].x) {
          const k = (x - pts[i].x) / (pts[i + 1].x - pts[i].x);
          return pts[i].y + (pts[i + 1].y - pts[i].y) * k;
        }
      }
      return null;
    }

    function fmtLocalTime(ms, withDate) {
      const d = new Date(ms);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      return withDate ? `${t.months[d.getUTCMonth()]} ${d.getUTCDate()} ${hh}:${mm}` : `${hh}:${mm}`;
    }

    // [ADD] "Temp & Tide도 가상 값이라도 넣어줘 - 기본 화면이 비어 있으면 사이트가
    // 먹통 같아" 요청 반영. 실데이터가 없을 때(클릭 전 / 불러오는 중 / 실패)
    // 네트워크 요청 없이 바로 그릴 수 있는 추정 그래프를 만듭니다.
    // - 수온: 이 정점의 현재 위성 수온(curTemp)에 오후 3시쯤 살짝 올라가는
    //   하루 변화(±0.2°C)만 얹었어요.
    // - 조석: 지구본 조석 격자와 같은 원리(실제 달·태양 위치로 계산한 평형 조석)로
    //   만조·간조 "리듬"(하루 두 번, 사리/조금)은 실제와 맞지만, 해안 지형 때문에
    //   생기는 시간차·높이는 반영하지 못해서 진폭은 ±0.5m로 가정했습니다.
    // 화면에는 "추정값"이라고 분명히 표시하고, 실데이터가 오면 바로 바꿔 그립니다.
    function getEstimatedHourly(st) {
      const HOUR = 3600 * 1000;
      const lat = st.coords[1], lon = st.coords[0];
      const offsetMs = Math.round(lon / 15) * HOUR; // 시간대 근사 (경도 15°당 1시간)
      const nowUtc = Date.now();
      // 실데이터와 같은 범위(과거 NOW_PAST_DAYS일 ~ 앞으로 약 7일)로 계산
      const nowLocal = nowUtc + offsetMs;
      const todayStart = Math.floor(nowLocal / 86400000) * 86400000;
      const fromLocal = todayStart - NOW_PAST_DAYS * 86400000;
      const toLocal = todayStart + NOW_FORECAST_DAYS * 86400000 - HOUR;
      const startUtc = Math.floor((fromLocal - offsetMs - HOUR) / HOUR) * HOUR;
      const here = latLonToSpherePos(lat, lon, 1).normalize();
      const p2 = (c) => 0.5 * (3 * c * c - 1);
      const raw = [];
      for (let u = startUtc; u <= toLocal - offsetMs + HOUR; u += HOUR) {
        const date = new Date(u);
        const m = computeSublunarPoint(date), s = computeSubsolarPoint(date);
        const cm = here.dot(latLonToSpherePos(m.lat, m.lon, 1).normalize());
        const cs = here.dot(latLonToSpherePos(s.lat, s.lon, 1).normalize());
        raw.push({ x: u + offsetMs, h: p2(cm) + 0.46 * p2(cs) });
      }
      const mean = raw.reduce((a, r) => a + r.h, 0) / raw.length;
      const maxDev = Math.max(...raw.map(r => Math.abs(r.h - mean))) || 1;
      const base = typeof st.curTemp === 'number' ? st.curTemp : 20;
      const tide = raw.map(r => ({ x: r.x, y: +(0.5 * (r.h - mean) / maxDev).toFixed(2) }));
      const temp = raw.map(r => {
        const localHour = new Date(r.x).getUTCHours();
        return { x: r.x, y: +(base + 0.2 * Math.sin(2 * Math.PI * (localHour - 9) / 24)).toFixed(2) };
      });
      const extremes = [];
      for (let i = 1; i < tide.length - 1; i++) {
        const a = tide[i - 1].y, b = tide[i].y, c = tide[i + 1].y;
        if (b > a && b >= c) extremes.push({ ...tide[i], type: 'high' });
        else if (b < a && b <= c) extremes.push({ ...tide[i], type: 'low' });
      }
      return { temp, tide, extremes, nowLocalMs: nowLocal, from: fromLocal, to: toLocal, isEstimate: true };
    }

    // [CHANGE] 색 단순화 - 평소엔 흰/회색, "주의"일 때만 빨강 계열.
    // 9m/s 이상 연한 빨강, 한국 기상청 풍랑주의보 기준 14m/s 이상 빨강.
    function windColor(speed) {
      if (speed >= 14) return '#EF4444';
      if (speed >= 9) return '#FB7185';
      return '#CBD5E1';
    }

    // [ADD] "파고가 일정 기준 이상이면 빨간색" - 한국 기상청 풍랑주의보 기준
    // 유의파고 3m(파도 꼭대기~골 전체 높이, ±1.5m가 아니에요). 3m 미만은
    // 높을수록 진한 파랑, 3m 이상은 빨강.
    const WAVE_WARN_M = 3;
    function waveCellStyle(h) {
      if (h >= WAVE_WARN_M) return 'background:rgba(239,68,68,0.18);color:#EF4444;font-weight:700;';
      return 'color:#CBD5E1;font-weight:600;';
    }

    // 풍향(바람이 불어오는 방향, 0°=북)을 8방위 글자로
    function compass8(deg) {
      return t.compass[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
    }

    function nearestByX(arr, x) {
      if (!arr || !arr.length) return null;
      let best = arr[0], bd = Math.abs(arr[0].x - x);
      for (const p of arr) { const dd = Math.abs(p.x - x); if (dd < bd) { bd = dd; best = p; } }
      return bd <= 90 * 60 * 1000 ? best : null; // 1시간 반 이내의 값만
    }


    // [CHANGE] "Windy처럼 복잡한 그래프 대신 숫자로 단순하게" 요청 반영 -
    // 실시간 현황 탭을 3시간 간격 표(±2일, 32칸)로 바꿨습니다. 각 칸은
    // 수온·바람(풍속/방향/돌풍)·파고(너울 주기)를 숫자로 보여주고, 맨 아래에는
    // 조석 곡선을 깔아 만조▲/간조▼ 시각과 높이를 적어요. 좌우로 밀어서 보고,
    // 처음엔 "지금" 선이 보이도록 자동 스크롤됩니다.
    // 실데이터가 없을 땐(클릭 전/불러오는 중/실패) 추정값으로 같은 표를 그리고,
    // 맨 위 상태 줄로 실시간 데이터인지 아닌지만 알려줍니다.
    const NOW_STEP_H = 3, NOW_COL_W = 34;

    // [ADD] "정점명 앞 이모티콘 빼줘" - 이름 앞의 이모지(🤿 등)를 떼고 보여줍니다.
    function stationDisplayName(st) {
      return String(st.name).replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '').trim();
    }

    // ───────── [ADD] 시야(물 투명도) - 게이지, 데이터 불러오기, 그래프 공통 ─────────
    const EYE_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    // [FIX] 만(灣) 안처럼 1m보다 탁한 곳(Crissy Field 등)은 선이 축 아래로 잘려서 0.5m부터 보여줌
    const VIS_TICKS = [0.5, 1, 2, 5, 10, 20, 30];
    // 게이지 위치: 0.5m~30m 로그 눈금(탁한 곳 차이도 잘 보이게)
    function visPos(v) { return Math.max(0, Math.min(1, Math.log(Math.max(0.5, v) / 0.5) / Math.log(60))) * 100; }
    const mmdd = (iso) => iso.slice(5).replace(/^0/, '').replace('-0', '/').replace('-', '/');

    // 정점명 옆 작은 게이지: 숫자 = 오늘 추정 시야, 옅은 띠 = 90일 통상 범위(하위~상위 10%), 흰 눈금 = 오늘
    function visGaugeHTML(st) {
      const v = st._visCache;
      if (!v) return st._visState === 'loading' ? `<span class="nt-vis nt-vis-wait" title="${t.visLoading}">${EYE_SVG}…</span>` : '';
      const a = visPos(v.p10), b = visPos(v.p90);
      let title = t.visGaugeTitle(fmtVis(v.now.vis), fmtVis(v.p10), fmtVis(v.p90), mmdd(v.last.d), fmtVis(v.last.vis));
      if (v.radiusKm) title = t.visRadius(v.radiusKm) + '\n' + title;
      if (v.check) title += '\n' + t.visCheck(fmtVis(v.check.vis), mmdd(v.check.from), mmdd(v.check.to), v.check.agree);
      if (v.ground && v.ground.now != null) title += '\n' + t.visGround(v.ground.name, v.ground.dist.toFixed(1), fmtVis(v.ground.now), v.ground.qi + 1, v.ground.from, v.ground.to);
      // 두 위성 자료가 크게 다르면 숫자 옆에 작은 "≠" 표시(마우스를 올리면 설명)
      const warn = v.check && !v.check.agree ? `<span class="nt-vis-warn">≠${fmtVis(v.check.vis)}</span>` : '';
      return `<span class="nt-vis" title="${title}">${EYE_SVG}<b>${fmtVis(v.now.vis)}</b>${warn}` +
        `<span class="nt-vis-track"><span class="nt-vis-band" style="left:${a}%;width:${Math.max(3, b - a)}%"></span>` +
        `<span class="nt-vis-mark" style="left:${visPos(v.now.vis)}%"></span></span></span>`;
    }

    // 시야 자료는 우리 서버(/api/visibility, 12시간 CDN 캐시)에서 오니 Open-Meteo 한도와 무관 -
    // 정점을 고르면 바로 불러옵니다. 실패하면 1분 동안은 다시 시도하지 않아요.
    async function ensureVisData(st) {
      if (!st || st._visCache || st._visState === 'loading') return;
      if (!/^https?:$/.test(location.protocol)) return;
      if (st._visState === 'failed' && Date.now() - (st._visFailAt || 0) < 60000) return;
      st._visState = 'loading';
      if (selectedStation === st) updateChart();
      try {
        await fetchStationVisibility(st);
        st._visState = 'ok';
      } catch (e) {
        console.warn('[visibility] 시야 자료 실패:', e);
        st._visState = 'failed'; st._visFailAt = Date.now();
      }
      if (selectedStation === st) updateChart();
    }

    // 날짜(ms) → 90일 추이 그래프의 x(오늘 달의 5달 전 1일 = 0, 한 달 = 1)
    function dateToWindowX(ms) {
      const d = new Date(ms);
      const m = (d.getFullYear() * 12 + d.getMonth()) - (todayObj.getFullYear() * 12 + curMonth - 5);
      const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return m + (d.getDate() - 1 + d.getHours() / 24) / dim;
    }

    // 90일 추이 탭 위쪽: [수온·시야 | 시야 원인] 전환 칩 + (원인 화면일 때) 계산식 요약
    let forecastView = 'temp';
    function renderForecastTop(v) {
      const box = document.querySelector('.chart-box');
      let top = document.getElementById('fc-top');
      if (!top) {
        top = document.createElement('div'); top.id = 'fc-top'; top.className = 'fc-top';
        box.appendChild(top);
        top.addEventListener('click', (e) => {
          const b = e.target.closest('[data-view]');
          if (!b || b.dataset.view === forecastView) return;
          forecastView = b.dataset.view; updateChart();
        });
      }
      top.style.display = activeMode === 'forecast' ? '' : 'none';
      if (activeMode !== 'forecast') return;
      if (!v) { top.innerHTML = ''; forecastView = 'temp'; return; } // 시야 자료가 없으면 전환 칩도 숨김
      const chip = (view, label) => `<button type="button" class="fc-chip${forecastView === view ? ' on' : ''}" data-view="${view}">${label}</button>`;
      let html = `<div class="fc-row"><span class="fc-chips">${chip('temp', t.fcTempVis)}${chip('cause', t.fcCause)}</span>`;
      if (forecastView === 'cause' && v) {
        html += `<span class="fc-line">${t.visLastLine(mmdd(v.last.d), fmtVis(v.last.vis), v.last.kd.toFixed(2))}</span></div>`;
        html += `<div class="fc-sub">${v.share ? t.visCauseLine(Math.round(v.share.plankton * 100), Math.round(v.share.other * 100), v.share.chl.toFixed(1)) : t.visNoChl}</div>`;
      } else {
        html += '</div>';
      }
      top.innerHTML = html;
    }

    // 90일 추이 - "시야 원인" 화면: 날짜별 탁한 정도를 원인별로 쌓은 막대 + 시야 선(= 1.7 ÷ 막대 높이)
    function renderVisCause(chartCanvas, legendBox, v) {
      const days = v.days;
      const hasChl = v.hasChl && days.some(x => x.kc != null);
      const bar = (label, key, color) => ({ label, data: days.map(x => x[key] != null ? +x[key].toFixed(3) : null), yAxisID: 'yk', backgroundColor: color, stack: 'k', barPercentage: 1, categoryPercentage: 0.9, order: 3, _unit: 'kd' });
      const datasets = [
        { type: 'line', label: t.visAxis, data: days.map(x => +x.vis.toFixed(1)), yAxisID: 'yv', borderColor: '#38BDF8', borderWidth: 2, pointRadius: 0, pointHitRadius: 8, tension: 0.3, order: 0, _unit: 'vis' }
      ];
      if (hasChl) {
        datasets.push(bar(t.visWater, 'kw', 'rgba(148,163,184,0.35)'), bar(t.visPlankton, 'kc', 'rgba(74,222,128,0.55)'), bar(t.visOther, 'ko', 'rgba(180,140,90,0.55)'));
      } else {
        datasets.push(bar(t.visTurbidity, 'kd', 'rgba(148,163,184,0.45)'));
      }
      const maxVis = Math.max(...days.map(x => x.vis));
      const maxKd = Math.max(...days.map(x => x.kd));
      chartInstance = new Chart(chartCanvas, {
        type: 'bar',
        data: { labels: days.map(x => mmdd(x.d)), datasets },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          layout: { padding: { top: 70 } },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => ctx.dataset._unit === 'vis'
                  ? `${ctx.dataset.label}: ${fmtVis(ctx.parsed.y)}`
                  : `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}`,
                afterBody: (items) => {
                  const x = days[items[0].dataIndex];
                  return x.chl != null ? [`엽록소 ${x.chl.toFixed(2)} mg/m³`] : [];
                }
              }
            }
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
            yk: { stacked: true, position: 'left', min: 0, suggestedMax: Math.ceil(maxKd * 12) / 10, grid: { color: 'rgba(255,255,255,0.05)' },
                  ticks: { color: '#8A94A6', font: { size: 9 } }, title: { display: true, text: t.visTurbidity, color: '#8A94A6', font: { size: 9 } } },
            yv: { position: 'right', min: 0, suggestedMax: Math.max(5, Math.ceil(maxVis * 1.25)), grid: { drawOnChartArea: false },
                  ticks: { color: '#38BDF8', font: { size: 9 }, callback: (val) => val + 'm' }, title: { display: true, text: t.visAxis, color: '#38BDF8', font: { size: 9 } } }
          }
        }
      });
      const sq = (c) => `<span class="swatch sq" style="background:${c}"></span>`;
      legendBox.innerHTML = `<div class="item"><span class="swatch" style="background:#38BDF8"></span>${t.visFormula}</div>` +
        (hasChl ? `<div class="item">${sq('rgba(74,222,128,.8)')}${t.visPlankton}</div><div class="item">${sq('rgba(180,140,90,.8)')}${t.visOther}</div><div class="item">${sq('rgba(148,163,184,.6)')}${t.visWater}</div>`
                : `<div class="item">${sq('rgba(148,163,184,.7)')}${t.visTurbidity}</div>`);
    }

    // [ADD] "Live 출처 병행 표기" - 정점명 옆 상태에 데이터 출처를 짧게 같이 적어요(KHOA / NOAA / Open-Meteo)
    function srcShort(sources) {
      const kinds = [...new Set((sources || []).map(s => s.kind === 'khoa' ? 'KHOA' : s.kind === 'kma' ? 'KMA' : s.kind === 'cmems' ? 'Copernicus' : 'NOAA'))];
      return kinds.length ? kinds.join('·') : 'Open-Meteo';
    }
    function statusHTML(label, title, src, st) {
      // [ADD] 시야 출처도 같이: 시야 값과 같은 하늘색으로 "NOAA 위성"
      const vis = st && st._visCache ? ` · <span class="nt-src-vis" title="${t.visSrcTitle}">${t.visSrc}</span>` : '';
      return `<span class="nt-live" title="${title}">● ${label}</span><span class="nt-src" title="${title}">${src}${vis}</span>`;
    }
    // [ADD] "90일·수심 탭에도 정점명" - 그래프 탭 맨 위에 실시간 현황과 같은 머리줄(정점명 + 시야 + 상태)
    function renderModeHead(show) {
      const box = document.querySelector('.chart-box');
      let head = document.getElementById('mode-head');
      if (!head) { head = document.createElement('div'); head.id = 'mode-head'; head.className = 'nt-head mode-head'; box.appendChild(head); }
      box.classList.toggle('with-head', !!show);
      head.style.display = show ? '' : 'none';
      if (!show || !selectedStation) return;
      const st = selectedStation, live = st._liveCache;
      let status;
      if (activeMode === 'depth') status = `<span class="nt-est">${t.statusEst}</span>`;
      else if (live && live.obsSource) status = statusHTML(t.statusObs, t.liveDataObs(obsSourceText([live.obsSource])), srcShort([live.obsSource]), st);
      else if (live) status = statusHTML(t.statusLive, t.liveDataOn, 'Open-Meteo', st);
      else status = `<span class="nt-est">${st._liveState === 'loading' ? t.nowLoadingShort : t.statusEst}</span>`;
      head.innerHTML = `<span class="nt-title" title="${st.name}">${stationDisplayName(st)}</span><span class="nt-status">${visGaugeHTML(st)}${status}</span>`;
    }

    // [FIX] 모바일(iOS 등)에서 ◀ ▶ ⬆ 문자가 컬러 이모지로 바뀌어 보여서,
    // 웹과 똑같이 보이도록 SVG 아이콘으로 그립니다(색은 글자색을 따라감).
    const ARROW_UP_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10.5V1.8M6 1.5 2.6 4.9M6 1.5l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const CHEVRON_SVG = (dir) => `<svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true"><path d="${dir < 0 ? 'M6 1.5 1.8 6 6 10.5' : 'M2 1.5 6.2 6 2 10.5'}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    function renderNowTable(box) {
      const st = selectedStation;
      let d = st._hourlyCache;
      const hasObs = d && d._obs && d._obs.sources.length;
      let status = statusHTML(t.statusLive, hasObs ? t.obsSource(obsSourceText(d._obs.sources)) : t.nowSource, hasObs ? srcShort(d._obs.sources) + ' · Open-Meteo' : 'Open-Meteo', st);
      if (!d) {
        if (st._userRequested && !st._hourlyState) ensureHourlyData(st);
        d = getEstimatedHourly(st);
        const why = !st._userRequested
          ? `👆 ${t.tapToLoad}`
          : st._hourlyState === 'failed'
            ? (st._hourlyError === 'DAILY_LIMIT' ? t.nowDailyLimit : t.nowFailed)
            : `⏳ ${t.nowLoading}`;
        const loading = st._userRequested && st._hourlyState === 'loading';
        status = `<span class="nt-est" title="${t.nowEstimated} · ${why.replace(/<[^>]+>/g, '')}">${loading ? t.nowLoadingShort : t.statusEst}</span>`;
      }
      const canRetry = !st._hourlyCache && st._hourlyState === 'failed' && st._hourlyError !== 'DAILY_LIMIT';
      if (canRetry) status += ` <a href="#" class="nt-retry">${t.retry}</a>`;

      const HOUR = 3600 * 1000, STEP = NOW_STEP_H * HOUR, COLW = NOW_COL_W;
      const cols = [];
      for (let x = Math.ceil(d.from / STEP) * STEP; x <= d.to; x += STEP) cols.push(x);
      const W = cols.length * COLW;
      const nowX = (d.nowLocalMs - cols[0]) / STEP * COLW + COLW / 2;
      const xp = (x) => (x - cols[0]) / STEP * COLW + COLW / 2;
      const hhmm = (ms) => { const dt = new Date(ms); return String(dt.getUTCHours()).padStart(2, '0') + ':' + String(dt.getUTCMinutes()).padStart(2, '0'); };
      const tempVal = (c) => tempUnit === 'F' ? cToF(c).toFixed(0) : c.toFixed(1);

      // 조석 곡선 (이 정점 범위에 맞춰 그리고, 정확한 높이는 ▲▼ 숫자로 표시)
      const TH = 50;
      const tideIn = d.tide.filter(p => p.x >= cols[0] - HOUR && p.x <= cols[cols.length - 1] + HOUR);
      let tideSvg = '';
      if (tideIn.length > 1) {
        const tMin = Math.min(...tideIn.map(p => p.y)), tMax = Math.max(...tideIn.map(p => p.y));
        const yp = (y) => 12 + (1 - (y - tMin) / ((tMax - tMin) || 1)) * (TH - 26);
        const line = tideIn.map((p, i) => (i ? 'L' : 'M') + xp(p.x).toFixed(1) + ',' + yp(p.y).toFixed(1)).join(' ');
        const area = `${line} L${xp(tideIn[tideIn.length - 1].x).toFixed(1)},${TH} L${xp(tideIn[0].x).toFixed(1)},${TH} Z`;
        const marks = d.extremes.filter(e => e.x >= cols[0] && e.x <= cols[cols.length - 1]).map(e => {
          const up = e.type === 'high';
          const x = Math.max(34, Math.min(W - 34, xp(e.x))); // 양 끝에서 글자가 잘리지 않게
          return `<text x="${x.toFixed(1)}" y="${(up ? yp(e.y) - 3 : yp(e.y) + 10).toFixed(1)}" fill="${up ? '#BAE6FD' : '#7DA3C0'}" font-size="8" text-anchor="middle">${up ? '▲' : '▼'}${hhmm(e.x)} ${e.y.toFixed(1)}m</text>`;
        }).join('');
        tideSvg = `<svg width="${W}" height="${TH}" style="display:block"><path d="${area}" fill="rgba(56,189,248,0.12)"/><path d="${line}" fill="none" stroke="#38BDF8" stroke-width="1.5"/>${marks}</svg>`;
      }

      // [CHANGE] "지금" 칸은 좌우로 넘겨도 화면 밖으로 안 나가고 가장자리에 붙어
      // 있어요(sticky). 그 칸 맨 위(날짜 줄)에 "Now"를 표시합니다.
      const nowCol = Math.max(0, Math.min(cols.length - 1, Math.floor((d.nowLocalMs - cols[0] + STEP / 2) / STEP)));
      let colIdx = 0;
      const cell = (html, style) => `<div class="nt-cell${colIdx === nowCol ? ' nt-nowcell' : ''}" style="${style || ''}">${html}</div>`;
      const rows = { date: '', time: '', temp: '', wind: '', dir: '', gust: '', wave: '', swell: '' };
      let lastDay = null;
      cols.forEach((x, i) => {
        colIdx = i;
        const dt = new Date(x), hh = dt.getUTCHours(), day = dt.getUTCDate();
        const dayEdge = hh === 0 ? 'border-left:1px solid rgba(255,255,255,0.10);' : '';
        rows.date += i === nowCol
          ? cell(`<button class="nt-nowbtn" title="${t.backToNow}">${t.tideNow}</button>`, '')
          : cell(day !== lastDay ? `${dt.getUTCMonth() + 1}/${day}` : '', 'color:rgba(255,255,255,0.9);font-weight:700;' + dayEdge);
        lastDay = day;
        rows.time += cell(String(hh).padStart(2, '0'), 'color:#8A94A6;' + dayEdge);

        const tp = nearestByX(d.temp, x);
        rows.temp += cell(tp ? (tp.obs ? `<span class="nt-obs">${tempVal(tp.y)}</span>` : tempVal(tp.y)) : '–', tp ? 'color:rgba(255,255,255,0.9);font-weight:700;' : 'color:#4B5565;');

        const w = nearestByX(d.wind, x);
        rows.wind += cell(w ? (w.obs ? `<span class="nt-obs">${Math.round(w.speed)}</span>` : Math.round(w.speed)) : '–', w ? `color:${windColor(w.speed)};font-weight:600;` : 'color:#4B5565;');
        rows.dir += cell(w ? `<span class="nt-dir" style="display:inline-block;transform:rotate(${(w.dir + 180) % 360}deg);color:${w.speed >= 9 ? windColor(w.speed) : '#8A94A6'}">${ARROW_UP_SVG}</span>` : '');
        rows.gust += cell(w && w.gust != null ? Math.round(w.gust) : '', 'color:#5B6474;');

        const wv = nearestByX(d.waves, x);
        rows.wave += cell(wv ? (wv.obs ? `<span class="nt-obs">${wv.height.toFixed(1)}</span>` : wv.height.toFixed(1)) : '–', wv ? waveCellStyle(wv.height) : 'color:#4B5565;');
        rows.swell += cell(wv && wv.swellPeriod != null ? Math.round(wv.swellPeriod) + t.sec : '', 'color:#5B6474;');
      });

      const ROWS = [
        ['date', '', 18], ['time', '', 14],
        ['temp', `${t.rowTemp} °${tempUnit}`, 22], ['wind', t.rowWind, 20], ['dir', t.rowDir, 16], ['gust', t.gust, 14],
        ['wave', t.rowWave, 20], ['swell', t.rowSwell, 14]
      ];
      const labelCol = `<div class="nt-labels">` +
        ROWS.map(([, l, h]) => `<div style="height:${h}px">${l}</div>`).join('') +
        `<div style="height:${TH}px">${t.rowTide}</div></div>`;
      // 조석 줄: 곡선은 뒤에 깔고, "지금" 칸 자리에는 현재 해수면 높이와
      // 오르는 중(↑)/내리는 중(↓)을 적은 칸을 sticky로 얹어요.
      const tNow = typeof interpAt === 'function' ? interpAt(d.tide, d.nowLocalMs) : null;
      const tNext = typeof interpAt === 'function' ? interpAt(d.tide, d.nowLocalMs + HOUR) : null;
      const tideNowTxt = tNow != null ? `${tNow.toFixed(1)}m<br>${tNext != null && tNext >= tNow ? '↑' : '↓'}` : '';
      const tideRow = `<div class="nt-row nt-tiderow" style="height:${TH}px">` +
        `<div class="nt-tidesvg">${tideSvg}</div>` +
        `<div style="flex:0 0 ${nowCol * COLW}px"></div>` +
        `<div class="nt-cell nt-nowcell nt-tidenow">${tideNowTxt}</div></div>`;
      const grid = `<div class="nt-grid" style="width:${W}px">` +
        ROWS.map(([k, , h]) => `<div class="nt-row" style="height:${h}px">${rows[k]}</div>`).join('') +
        tideRow + `</div>`;

      // [ADD] "스크롤로 전날·다음 날로" - 좌우 스크롤 + ◀ ▶ 버튼(하루씩) +
      // 마우스 휠(세로 휠을 가로 이동으로)
      // [CHANGE] 첨부 디자인 반영 - 정점명 옆에 Live, 전날/다음날은 표 양옆 화살표
      box.innerHTML = `<div class="nt-head"><span class="nt-title" title="${st.name}">${stationDisplayName(st)}</span>` +
          `<span class="nt-status">${visGaugeHTML(st)}${status}</span></div>` +
        `<div class="nt-frame">` +
          `<button class="nt-arrow" data-dir="-1" aria-label="${t.prevDay}">${CHEVRON_SVG(-1)}</button>` +
          `<div class="nt-scroll"><div class="nt-inner">${labelCol}${grid}</div></div>` +
          `<button class="nt-arrow" data-dir="1" aria-label="${t.nextDay}">${CHEVRON_SVG(1)}</button>` +
        `</div>` +
        `<div class="nt-note">${d._obs && d._obs.sources.length ? t.obsNote(obsSourceText(d._obs.sources), !!d._tidePred) : t.tideNote}</div>`;
      const sc = box.querySelector('.nt-scroll');
      const toNow = () => Math.max(0, nowX - (sc.clientWidth - 58) / 2);
      // 같은 정점을 다시 그릴 땐(데이터 도착 등) 보던 위치 유지, 새 정점이면 "지금"으로
      const keep = box._lastStationId === st.id && typeof box._lastScroll === 'number';
      sc.scrollLeft = keep ? box._lastScroll : toNow();
      box._lastStationId = st.id;
      sc.addEventListener('scroll', () => { box._lastScroll = sc.scrollLeft; }, { passive: true });
      let pending = null, pendingTimer = null; // 빠르게 여러 번 눌러도 하루씩 누적되게
      box.querySelectorAll('.nt-arrow').forEach(btn => btn.addEventListener('click', () => {
        const dir = +btn.dataset.dir;
        const base = pending != null ? pending : sc.scrollLeft;
        const maxLeft = sc.scrollWidth - sc.clientWidth;
        const target = Math.max(0, Math.min(maxLeft, dir === 0 ? toNow() : base + dir * (24 / NOW_STEP_H) * COLW));
        pending = target;
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => { pending = null; }, 600);
        sc.scrollTo({ left: target, behavior: 'smooth' });
      }));
      sc.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { sc.scrollLeft += e.deltaY; e.preventDefault(); }
      }, { passive: false });
      // [ADD] "지금" 글자를 누르면 현재 시각 칸이 가운데로 오게
      const nowBtn = box.querySelector('.nt-nowbtn');
      if (nowBtn) nowBtn.addEventListener('click', () => sc.scrollTo({ left: toNow(), behavior: 'smooth' }));
      const retry = box.querySelector('.nt-retry');
      if (retry) retry.addEventListener('click', (e) => { e.preventDefault(); st._hourlyState = undefined; updateChart(); });
    }

    function updateChart() {
      const chartCanvas = document.getElementById('detailChart').getContext('2d');
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      const legendBox = document.getElementById('chart-legend');
      const tableBox = document.getElementById('now-table');

      // [CHANGE] 버튼 3개가 같은 자리를 번갈아 씀: 실시간 현황이면 표, 아니면 그래프
      const isNow = activeMode === 'now';
      tableBox.style.display = isNow ? '' : 'none';
      // 맨 아래 정점 정보: 표에선 "지금" 칸 위에 이름이 있으니 정보만, 그래프 탭에선 이름도 같이
      if (selectedStation) {
        const s0 = selectedStation;
        const info = t.infoCoord(s0.network, s0.coords[1], s0.coords[0]) + (s0.isBeach ? ` [${t.beachTag}]` : '');
        document.getElementById('st-info').innerText = info;
      }
      document.getElementById('detailChart').style.display = isNow ? 'none' : '';
      legendBox.style.display = isNow ? 'none' : '';
      const fcTop = document.getElementById('fc-top');
      if (fcTop) fcTop.style.display = activeMode === 'forecast' ? '' : 'none';
      renderModeHead(!isNow && !!selectedStation);
      if (!selectedStation) return;
      if (isNow) { renderNowTable(tableBox); return; }

      // [FIX] 시야 쪽에서 무슨 오류가 나도 수온/수심 그래프는 항상 그려지게
      try { renderForecastTop(selectedStation._visCache); } catch (e) { console.warn('[visibility] 상단 칩 오류:', e); }
      legendBox.style.top = '';
      if (activeMode === 'forecast' && forecastView === 'cause' && selectedStation._visCache) {
        legendBox.style.top = '68px';
        try { renderVisCause(chartCanvas, legendBox, selectedStation._visCache); }
        catch (e) { console.warn('[visibility] 원인 그래프 오류:', e); forecastView = 'temp'; return updateChart(); }
      } else if (activeMode === 'forecast') {
        const usingLive = !!selectedStation._liveCache;
        const data = usingLive ? computeTimeSeriesDataFromLive(selectedStation) : computeTimeSeriesData(selectedStation);
        let vis = selectedStation._visCache;
        const prev = data.prev && data.prev.nYears ? data.prev : null;
        const datasets = [
          { label: (selectedStation._liveCache && selectedStation._liveCache.climYears) ? t.chartPastObs(selectedStation._liveCache.climYears) : t.chartPast, data: data.climLine, borderColor: '#5B6474', borderDash: [4, 4], tension: 0.3, pointRadius: 0, pointHitRadius: 20, hidden: !!prev },
          { label: t.chartActual, data: data.actualLine, borderColor: '#FFB000', backgroundColor: 'rgba(255, 176, 0, 0.10)', fill: true, tension: 0.25, pointRadius: 0, pointHitRadius: 20, borderWidth: 2.2 },
          { label: t.chartFuture, data: data.projectedLine, borderColor: 'rgba(255, 176, 0, 0.55)', borderDash: [5, 4], tension: 0.25, pointRadius: 0, pointHitRadius: 20, borderWidth: 2 },
          { label: t.todayBadge, data: data.todayPoint, borderColor: '#FFB000', backgroundColor: '#ffffff', borderWidth: 3, pointRadius: 5, pointHitRadius: 16, pointHoverRadius: 7, showLine: false }
        ];
        // [ADD] 지난 해 같은 날짜 실측: 옅은 띠(최저~최고) + 흰 평균선. 수온 선들 뒤에 깔리게 앞쪽에 넣어요
        if (prev) {
          datasets.splice(1, 0,
            { label: t.prevRange(prev.nYears), data: prev.lo, borderWidth: 0, pointRadius: 0, fill: false, tension: 0.3, _noTip: true },
            { label: t.prevRange(prev.nYears), data: prev.hi, borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(203,213,225,0.14)', tension: 0.3, _noTip: true },
            { label: t.prevAvg(prev.nYears), data: prev.avg, borderColor: 'rgba(226,232,240,0.85)', borderWidth: 1.6, pointRadius: 0, pointHitRadius: 10, tension: 0.3 }
          );
        }
        // [ADD] 시야: 실측(위성 7일 평균) 실선 + 일별 점, 앞으로의 추세 점선 + 두꺼운 반투명 오차 범위
        if (vis) try {
          const P = vis.projection.map(p => ({ x: dateToWindowX(p.t), p }));
          datasets.push(
            { label: t.visBand, data: P.map(o => ({ x: o.x, y: +o.p.lo.toFixed(2) })), yAxisID: 'yv', borderWidth: 0, pointRadius: 0, fill: false, tension: 0.3, _noTip: true },
            { label: t.visBand, data: P.map(o => ({ x: o.x, y: +o.p.hi.toFixed(2) })), yAxisID: 'yv', borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(56,189,248,0.16)', tension: 0.3, _noTip: true },
            { label: t.visTrend, data: P.map(o => ({ x: o.x, y: +o.p.vis.toFixed(2) })), yAxisID: 'yv', borderColor: 'rgba(56,189,248,0.9)', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, pointHitRadius: 10, tension: 0.3, _unit: 'vis' },
            { label: t.visObserved, data: vis.days.map(x => ({ x: dateToWindowX(x.t), y: +x.vis7.toFixed(2) })), yAxisID: 'yv', borderColor: '#38BDF8', borderWidth: 2, pointRadius: 0, pointHitRadius: 10, tension: 0.3, _unit: 'vis' },
            { label: t.visAxis, data: vis.days.map(x => ({ x: dateToWindowX(x.t), y: +x.vis.toFixed(2) })), yAxisID: 'yv', showLine: false, pointRadius: 1.3, pointBackgroundColor: 'rgba(56,189,248,0.45)', pointBorderWidth: 0, _noTip: true }
          );
          // 실측 투명도(분기 평균): 분기 가운데 달 15일에 노란 동그라미
          if (vis.ground) {
            const pts = [];
            for (let k = -1; k <= 1; k++) vis.ground.q.forEach((val, qi) => {
              if (val == null) return;
              const x = dateToWindowX(new Date(todayObj.getFullYear() + k, qi * 3 + 1, 15).getTime());
              if (x >= -0.4 && x <= 11.6) pts.push({ x, y: val });
            });
            pts.sort((a, b) => a.x - b.x);
            if (pts.length) datasets.push({ label: t.visGroundShort(vis.ground.name), data: pts, yAxisID: 'yv', showLine: false, pointStyle: 'circle', pointRadius: 4.5, pointHoverRadius: 6, pointBackgroundColor: 'rgba(15,23,42,0.9)', pointBorderColor: '#FCD34D', pointBorderWidth: 1.8, _unit: 'vis' });
          }
          if (vis.check) datasets.push({ label: t.visCheckShort, data: [{ x: dateToWindowX(Date.parse(vis.check.to + 'T12:00:00Z')), y: +vis.check.vis.toFixed(2) }], yAxisID: 'yv', showLine: false, pointStyle: 'rectRot', pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: 'rgba(15,23,42,0.9)', pointBorderColor: '#7DD3FC', pointBorderWidth: 1.6, _unit: 'vis' });
        } catch (e) {
          console.warn('[visibility] 시야 그래프 오류, 수온만 표시:', e);
          datasets.length = prev ? 7 : 4; vis = null;
        }
        const scales = {
          x: {
            type: 'linear', min: -0.4, max: 11.6,
            ticks: {
              stepSize: 1, color: '#64748b', font: { size: 9 },
              callback: (v) => t.months[((windowStartMonth + Math.round(v)) % 12 + 12) % 12] || ''
            },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          // [FIX] "상대온도라 날뛰어 보임" - 색상표와 같은 0~40도 절대 범위로 고정
          y: { min: 0, max: 40, ticks: { color: '#64748b', font: { size: 9 }, callback: formatAxisTemp }, grid: { color: 'rgba(255,255,255,0.05)' } }
        };
        // 시야 축(오른쪽): 1~30m 로그 눈금 - 3m와 5m 차이도 30m와 같은 그래프에서 보이게
        if (vis) scales.yv = {
          type: 'logarithmic', position: 'right', min: 0.5, max: 30, grid: { drawOnChartArea: false },
          afterBuildTicks: (ax) => { ax.ticks = VIS_TICKS.map(value => ({ value })); },
          ticks: { color: '#38BDF8', font: { size: 9 }, callback: (val) => val + 'm' }
        };
        chartInstance = new Chart(chartCanvas, {
          type: 'line',
          data: { datasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            layout: { padding: { top: 48 } },
            // 선마다 x 간격이 달라서(수온 주 단위, 시야 일 단위) 누른 곳에서 가장 가까운 값 하나를 보여줘요
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: {
                filter: (item) => !item.dataset._noTip,
                callbacks: {
                  // x = 이동 윈도우 위치 → 실제 달력 월/일
                  title: (items) => {
                    const xi = items[0].parsed.x;
                    const wi = Math.max(0, Math.min(12, Math.floor(xi + 1e-6)));
                    const mi = ((windowStartMonth + wi) % 12 + 12) % 12;
                    const frac = xi - wi;
                    if (frac < 0.02) return t.months[mi];
                    const dim = new Date(todayObj.getFullYear(), mi + 1, 0).getDate();
                    const day = Math.min(dim, Math.round(frac * dim) + 1);
                    return `${t.months[mi]} ${day}`;
                  },
                  label: (ctx) => ctx.dataset._unit === 'vis'
                    ? `${ctx.dataset.label}: ${fmtVis(ctx.parsed.y)}`
                    : `${ctx.dataset.label}: ${formatTemp(ctx.parsed.y)}`
                }
              }
            },
            scales
          }
        });
        const obsSrc = usingLive && selectedStation._liveCache.obsSource;
        const statusLine = usingLive
          ? `<div class="item" style="color:#FFB000;">● ${obsSrc ? t.liveDataObs(obsSourceText([obsSrc])) : t.liveDataOn}</div>`
          : (selectedStation._liveState === 'loading'
              ? `<div class="item" style="color:#facc15;">⏳ ${t.liveDataLoading}</div>`
              : `<div class="item" style="color:#94a3b8;">⚠ ${t.liveDataFallback}</div>`);
        const visLegend = vis
          ? `<div class="item"><span class="swatch" style="background:#38BDF8;"></span>${t.visObserved}</div>
             <div class="item"><span class="swatch band"></span>${t.visTrend}</div>` +
            (vis.check ? `<div class="item"><span style="display:inline-block;width:7px;height:7px;border:1.5px solid #7DD3FC;transform:rotate(45deg);margin:0 5px 0 2px;"></span>${t.visCheckShort} ${fmtVis(vis.check.vis)}</div>` : '') +
            (vis.ground ? `<div class="item"><span style="display:inline-block;width:8px;height:8px;border:1.8px solid #FCD34D;border-radius:50%;margin:0 5px 0 1px;"></span>${t.visGroundShort(vis.ground.name)}</div>` : '')
          : (selectedStation._visState === 'loading'
              ? `<div class="item" style="color:#7DD3FC;">${t.visLoading}</div>`
              : (selectedStation._visState === 'failed' ? `<div class="item" style="color:#94a3b8;">${t.visFailed}</div>` : ''));
        legendBox.innerHTML = statusLine + `
          ${prev
            ? `<div class="item"><span class="swatch" style="background:rgba(226,232,240,.85);"></span>${t.prevAvg(prev.nYears)}</div><div class="item"><span class="swatch" style="background:rgba(203,213,225,.35);height:6px;"></span>${t.prevRange(prev.nYears)}</div>`
            : `<div class="item"><span class="swatch dashed" style="color:#5B6474;background:#5B6474;"></span>${(selectedStation._liveCache && selectedStation._liveCache.climYears) ? t.chartPastObs(selectedStation._liveCache.climYears) : t.chartPast}</div>`}
          <div class="item"><span class="swatch" style="background:#FFB000;"></span>${t.chartActual}</div>
          <div class="item"><span class="swatch dashed" style="color:rgba(255,176,0,0.55);background:rgba(255,176,0,0.55);"></span>${t.chartFuture}</div>
        ` + visLegend;
      } else {
        const data = getDepthProfile(selectedStation.curTemp, selectedStation.isBeach);
        chartInstance = new Chart(chartCanvas, {
          type: 'line',
          data: {
            labels: data.depths.map(d => `${d}m`),
            datasets: [{ label: t.chartDepthLabel, data: data.profile, borderColor: '#FFB000', backgroundColor: 'rgba(255, 176, 0, 0.10)', fill: true, tension: 0.2, pointRadius: 3, pointHitRadius: 20 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            layout: { padding: { top: 26 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (ctx) => `${formatTemp(ctx.parsed.y)}` } }
            },
            scales: {
              x: { title: { display: true, text: t.depthAxisLabel, color: '#94a3b8', font: { size: 10 } }, ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
              y: { title: { display: true, text: t.tempAxisLabel, color: '#94a3b8', font: { size: 10 } }, ticks: { color: '#64748b', font: { size: 9 }, callback: formatAxisTemp }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
          }
        });
        legendBox.innerHTML = `<div class="item" style="color:#94a3b8;">⚠ ${t.liveDataFallback}</div>` +
          `<div class="item"><span class="swatch" style="background:#FFB000;"></span>${t.chartDepthLabel}</div>`;
      }
    }

    // [CHANGE] "값을 미리 불러오지 마, 사람들이 클릭했을 때만" - opts.auto가
    // true면(앱이 처음 켜질 때 기본 정점을 자동으로 고른 경우) Open-Meteo를
    // 부르지 않고 "클릭하면 불러와요" 안내만 보여줍니다. 사람이 정점을
    // 누르거나, 검색하거나, 탭을 누른 순간부터 그 정점의 값을 불러와요.
    async function selectStation(st, opts) {
      if (selectedStation !== st) forecastView = 'temp'; // [FIX] 정점을 바꾸면 수온·시야 화면부터
      selectedStation = st;
      if (!(opts && opts.auto)) {
        st._userRequested = true; st._userPicked = true;
        openSheet(); // [ADD] 시트 모드(가로 화면)에서는 정점을 누르면 패널이 바로 올라옴
        // [ADD] 접속 통계 - 사람이 직접 고른 정점만 "많이 본 정점"으로 셉니다
        if (/^https?:$/.test(location.protocol) && navigator.sendBeacon) {
          try { navigator.sendBeacon(`/api/track?e=station&s=${encodeURIComponent(stationDisplayName(st))}`); } catch (_) {}
        }
      }
      const isHotspot = maxTempStation && maxTempStation.id === st.id;
      document.getElementById('st-name').innerText = `${st.name} ${isHotspot ? `🔥 [${t.hotspot}]` : ''}`;
      document.getElementById('st-temp').innerText = formatTemp(st.curTemp);

      // [CHANGE] HUD에 정점명을 텍스트로 보여주던 것은 제거했습니다 -
      // 이제 지구본/지도에서 선택된 마커 자체가 다르게 표시되니 중복이라서요.
      if (typeof updateBeachSpriteScale === 'function') updateBeachSpriteScale();
      if (typeof updateLeafletSelection === 'function') updateLeafletSelection();

      const tagStr = st.isBeach ? ` [${t.beachTag}]` : '';
      document.getElementById('st-info').innerText = t.infoCoord(st.network, st.coords[1], st.coords[0]) + tagStr;

      const depthBtn = document.getElementById('btn-dp');
      if (!st.hasDepth) {
        depthBtn.style.opacity = '0.35';
        depthBtn.style.pointerEvents = 'none';
        if (activeMode === 'depth') setMode('now');
      } else {
        depthBtn.style.opacity = '1';
        depthBtn.style.pointerEvents = 'auto';
      }

      updateChart(); // 실데이터가 아직 없으면 예시값으로 먼저 보여주고
      ensureVisData(st); // [ADD] 시야(위성) - 우리 서버에서 오니 바로 불러와요

      // [ADD] "현재+과거 데이터를 실제로 가져와서 그래프 만들 수 있어?" 요청 반영.
      // Open-Meteo에서 이 정점의 실제 현재값+과거 5년+올해 실측을 가져옵니다.
      // 한 번 성공한 정점은 세션 내내 캐시돼서 재선택 시 다시 안 불러와요.
      // [CHANGE] 90일 실데이터(요청 2건)는 그 탭을 볼 때만 불러옵니다 -
      // Open-Meteo 요청 한도를 아끼려고요. 실시간 현황 표는 renderNowTable이 따로 불러요.
      if (activeMode === 'forecast' && st._userRequested) ensureLiveData(st);
    }

    async function ensureLiveData(st) {
      if (st._liveCache || st._liveState === 'loading') return;
      st._liveState = 'loading';
      if (selectedStation === st) updateChart();
      try {
        await fetchStationRealData(st);
        st._liveState = 'ok';
      } catch (e) {
        console.warn('[live-data] 정점 실데이터 가져오기 실패, 예시값 유지:', e);
        st._liveState = 'failed';
      }
      if (selectedStation === st && activeMode === 'forecast') updateChart(); // 그 사이 다른 정점을 안 골랐으면 실데이터로 다시 그림
    }

    // [ADD] (lat, lon)에서 가까운 정점 목록 (beachOnly면 해변 정점만)
    function nearestStations(lat, lon, count, beachOnly, exclude) {
      const list = [];
      stations.forEach(s => {
        if (exclude && exclude.includes(s)) return;
        if (beachOnly && !s.isBeach) return;
        const dLat = s.coords[1] - lat;
        let dLon = s.coords[0] - lon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const dLonKm = dLon * Math.cos(lat * Math.PI / 180);
        list.push({ s, d: dLat * dLat + dLonKm * dLonKm });
      });
      list.sort((a, b) => a.d - b.d);
      return list.slice(0, count).map(x => x.s);
    }

    // [ADD] 첫 화면 정점을 "실제 데이터가 있는 상태"로 여는 함수.
    // 1) 고른 정점을 바로 선택(화면엔 "불러오는 중")  2) 실패하면 1.5초 뒤 한 번 더
    // 3) 그래도 안 되면 근처 해변 정점을 최대 3곳까지 차례로 시도.
    // 하루 한도 초과면 더 시도해도 소용없어서 바로 멈춰요. 그 사이 사용자가
    // 다른 정점을 직접 누르면 즉시 중단합니다.
    async function openInitialStation(first) {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const candidates = [first, ...nearestStations(first.coords[1], first.coords[0], 3, true, [first])];
      for (const st of candidates) {
        if (selectedStation && selectedStation !== st && selectedStation._userPicked) return; // 사용자가 직접 고름
        st._userRequested = true;
        st._hourlyState = 'loading';
        selectStation(st, { auto: true });
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const d = await fetchStationHourly(st);
            st._hourlyState = 'ok';
            const nowT = interpAt(d.temp, d.nowLocalMs);
            if (nowT != null) st.curTemp = +nowT.toFixed(1);
            if (selectedStation === st) updateChart();
            return;
          } catch (e) {
            if (e && e.code === 'DAILY_LIMIT') {
              st._hourlyState = 'failed'; st._hourlyError = 'DAILY_LIMIT';
              if (selectedStation === st) updateChart();
              return;
            }
            if (attempt === 0) await sleep(1500);
          }
          if (selectedStation !== st) return; // 그 사이 사용자가 다른 정점을 누름
        }
        st._hourlyState = 'failed';
      }
      if (selectedStation) updateChart();
    }

    // [CHANGE] "기존처럼 버튼 3개로 교체" - 실시간 현황 / 90일 추이 / 수심 프로파일이
    // 같은 자리(고정 높이)를 번갈아 씁니다.
    function setMode(mode) {
      if (mode === 'forecast' && activeMode !== 'forecast') forecastView = 'temp'; // [FIX] 90일 추이는 항상 수온·시야 화면부터
      activeMode = mode;
      if (selectedStation) selectedStation._userRequested = true; // 버튼을 누른 것도 사용자 요청
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(mode === 'forecast' ? 'btn-ts' : mode === 'depth' ? 'btn-dp' : 'btn-now').classList.add('active');
      updateChart();
      if (mode === 'forecast' && selectedStation) ensureLiveData(selectedStation);
      if (mode === 'forecast' && selectedStation) ensureVisData(selectedStation);
    }

    // [ADD] "지구공" 리셋 버튼을 섭씨/화씨 전환 버튼으로 바꿔달라는 요청 반영.
    // (지구본으로 돌아가는 건 상세지도에서 축소만 해도 자동으로 전환됩니다.)
    function toggleTempUnit() {
      tempUnit = tempUnit === 'C' ? 'F' : 'C';
      const btn = document.getElementById('btn-reset');
      if (btn) btn.innerText = '°' + tempUnit;

      // [FIX] "색상바에 도씨로만 표시되는 오류" - 범례(0°C/40°C+)가 단위
      // 전환 버튼과 연결이 안 돼 있었어요. 같이 갱신합니다.
      const legendMin = document.getElementById('legend-min');
      const legendMax = document.getElementById('legend-max');
      if (legendMin) legendMin.innerText = tempUnit === 'F' ? `${cToF(0)}°F` : '0°C';
      if (legendMax) legendMax.innerText = tempUnit === 'F' ? `${cToF(32)}°F+` : '32°C+';

      if (selectedStation) {
        document.getElementById('st-temp').innerText = formatTemp(selectedStation.curTemp);
        updateChart();
      }
    }

    // ───────── [ADD] 그래프 범례: 눌러서 접기/펴기, 끌어서 옮기기, 그래프 밖(아래)으로 치우기 ─────────
    // 범례 내용은 그래프를 다시 그릴 때마다 새로 써지므로, 바뀔 때마다 머리줄(⠿ 범례 ▾ ⤓)을 다시 붙여요.
    //  - 머리줄 탭: 접기/펴기  - 머리줄 끌기: 그래프 안에서 옮기기
    //  - ⤓ 누르기 또는 그래프 아래 끝 밖으로 끌어내리기: 그래프 아래 줄로 치움(가로로 펼쳐짐). ⤒ 또는 위로 끌면 다시 그래프 위로
    // 위치·접힘·치움 상태는 이 브라우저에만 기억(localStorage). 처음엔 좁은 화면(휴대폰)이면 접힌 채로 시작.
    (function setupLegendControls() {
      const box = document.getElementById('chart-legend');
      const chartBox = box && box.parentElement;
      if (!box || !chartBox) return;
      const store = {
        get(k, d) { try { const v = localStorage.getItem('otemp.legend.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
        set(k, v) { try { localStorage.setItem('otemp.legend.' + k, JSON.stringify(v)); } catch (_) {} }
      };
      // 아이콘은 SVG로(아이폰에서 ⤓ 같은 문자가 컬러 이모지로 바뀌지 않게)
      const LG_DOWN_SVG = '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1v6M2.2 4.4 5 7.2l2.8-2.8M1.5 9h7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const LG_UP_SVG = '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 9V3M2.2 5.6 5 2.8l2.8 2.8M1.5 1h7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      let collapsed = store.get('collapsed', window.innerWidth < 600);
      let docked = store.get('docked', false);
      let off = store.get('offset', { x: 0, y: 0 });
      const place = () => {
        if (docked) { if (box.parentElement === chartBox) chartBox.after(box); box.style.transform = 'none'; return; }
        if (box.parentElement !== chartBox) chartBox.appendChild(box);
        const pr = chartBox.getBoundingClientRect();
        box.style.transform = 'none';
        const br = box.getBoundingClientRect();
        if (!br.width) return;
        // 그래프 상자 밖으로 나가지 않게
        off.x = Math.min(pr.right - br.right, Math.max(pr.left - br.left, off.x)) || 0;
        off.y = Math.min(pr.bottom - br.bottom, Math.max(pr.top - br.top, off.y)) || 0;
        box.style.transform = `translate(${off.x}px, ${off.y}px)`;
      };
      const apply = () => {
        box.classList.toggle('collapsed', collapsed);
        box.classList.toggle('docked', docked);
        const arrow = box.querySelector('.lg-head .lg-arrow');
        if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
        const dock = box.querySelector('.lg-head .lg-dock');
        if (dock) { dock.innerHTML = docked ? LG_UP_SVG : LG_DOWN_SVG; dock.title = docked ? t.legendUndock : t.legendDock; }
        place();
      };
      const setDocked = (v) => { docked = v; store.set('docked', v); if (!v) { off = { x: 0, y: 0 }; store.set('offset', off); } apply(); };
      const addHead = () => {
        if (!box.firstElementChild || box.querySelector('.lg-head')) return;
        const head = document.createElement('div');
        head.className = 'lg-head';
        head.innerHTML = `<span class="lg-grip">⠿</span><span>${t.legendTitle || 'Legend'}</span><span class="lg-arrow"></span><span class="lg-dock" role="button"></span>`;
        box.insertBefore(head, box.firstChild);
        let start = null, moved = false;
        head.addEventListener('pointerdown', (e) => {
          start = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y, dockBtn: !!(e.target.closest && e.target.closest('.lg-dock')) }; moved = false;
          head.setPointerCapture(e.pointerId);
        });
        head.addEventListener('pointermove', (e) => {
          if (!start) return;
          const dx = e.clientX - start.x, dy = e.clientY - start.y;
          if (!moved && Math.hypot(dx, dy) < 6) return; // 살짝 누른 건 "탭"
          moved = true;
          if (docked) return; // 치운 상태에선 끌기 = 위로 올리기만(손 뗄 때 판단)
          off = { x: start.ox + dx, y: start.oy + dy };
          box.style.transform = `translate(${off.x}px, ${off.y}px)`;
        });
        const end = (e) => {
          if (!start) return;
          const s0 = start; start = null;
          if (!moved) {
            if (s0.dockBtn) return setDocked(!docked);
            collapsed = !collapsed; store.set('collapsed', collapsed); return apply();
          }
          if (docked) { if (e.clientY - s0.y < -30) setDocked(false); return; }
          // 그래프 아래 끝보다 더 끌어내리면 그래프 밖(아래 줄)으로 치움
          const pr = chartBox.getBoundingClientRect(), br = box.getBoundingClientRect();
          if (br.top > pr.bottom - 24) return setDocked(true);
          place(); store.set('offset', off);
        };
        head.addEventListener('pointerup', end);
        head.addEventListener('pointercancel', () => { start = null; });
        apply();
      };
      new MutationObserver(addHead).observe(box, { childList: true });
      addHead();
      window.addEventListener('resize', () => requestAnimationFrame(place));
    })();

    // ───────── [ADD] 시트 모드(가로로 넓고 낮은 화면): 패널을 팝업처럼 올리고 내리기 ─────────
    // 열기: 탭 누르기, 정점 누르기. 닫기: 오른쪽 위 ✕, 맨 위 손잡이를 아래로 끌기, Esc 키.
    function sheetEl() { return document.getElementById('bottom-sheet'); }
    function openSheet() {
      if (!document.body.classList.contains('sheet-mode')) return;
      const bs = sheetEl(); if (!bs || bs.classList.contains('open')) return;
      bs.classList.add('open');
      setTimeout(() => { if (typeof updateChart === 'function' && selectedStation) updateChart(); }, 340); // 올라온 뒤 크기 맞춰 다시 그림
    }
    function closeSheet() {
      const bs = sheetEl(); if (bs) { bs.classList.remove('open'); bs.style.transform = ''; }
    }
    (function setupSheet() {
      const bs = sheetEl(); if (!bs) return;
      const handle = document.createElement('div');
      handle.className = 'sheet-handle'; handle.innerHTML = '<span></span>';
      bs.insertBefore(handle, bs.firstChild);
      const x = document.createElement('button');
      x.className = 'sheet-close'; x.type = 'button'; x.setAttribute('aria-label', 'close');
      x.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      x.addEventListener('click', closeSheet);
      bs.appendChild(x);
      document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', openSheet));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
      // 손잡이 끌어내리기: 손가락을 따라 내려가다가 80px 넘게 내리면 닫힘
      let y0 = null;
      handle.addEventListener('pointerdown', (e) => { if (!bs.classList.contains('open')) return openSheet(); y0 = e.clientY; handle.setPointerCapture(e.pointerId); bs.style.transition = 'none'; });
      handle.addEventListener('pointermove', (e) => { if (y0 == null) return; const dy = Math.max(0, e.clientY - y0); bs.style.transform = `translateY(${dy}px)`; });
      const end = (e) => {
        if (y0 == null) return;
        const dy = e.clientY - y0; y0 = null;
        bs.style.transition = ''; bs.style.transform = '';
        if (dy > 80) closeSheet();
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    })();

// Three.js 구체 UV 매핑 표준 정렬
