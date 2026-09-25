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

      return { climLine, actualLine, projectedLine, todayPoint: todayLine };
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
      if (selectedStation === st && activeMode === 'now') updateChart();
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

    function renderNowChart(chartCanvas, legendBox) {
      const st = selectedStation;
      const d = st._hourlyCache;
      if (!d) {
        if (!st._userRequested) {
          legendBox.innerHTML = `<div class="item" style="color:#94a3b8;">👆 ${t.tapToLoad}</div>`;
          chartInstance = null;
          return;
        }
        if (!st._hourlyState) ensureHourlyData(st);
        legendBox.innerHTML = st._hourlyState === 'failed'
          ? `<div class="item" style="color:#94a3b8;">⚠ ${st._hourlyError === 'DAILY_LIMIT' ? t.nowDailyLimit : t.nowFailed}</div>`
          : `<div class="item" style="color:#facc15;">⏳ ${t.nowLoading}</div>`;
        chartInstance = null;
        return;
      }

      const HOUR = 3600 * 1000;
      const nowT = interpAt(d.temp, d.nowLocalMs);
      const nowH = interpAt(d.tide, d.nowLocalMs);
      const highs = d.extremes.filter(e => e.type === 'high');
      const lows = d.extremes.filter(e => e.type === 'low');

      // 20°C ↔ 0m 정렬: 두 축 모두 "기준점 아래 1 : 위 HEAD" 비율로 잡으면
      // 기준점(20°C, 0m)이 항상 같은 높이에 옵니다. 위쪽은 범례 자리로 여유.
      const T0 = 20, HEAD = 1.7;
      const tDev = Math.max(2, ...d.temp.map(p => Math.abs(p.y - T0))) * 1.1;
      const hDev = Math.max(0.3, ...d.tide.map(p => Math.abs(p.y))) * 1.1;
      const tickXs = [];
      for (let x = Math.ceil(d.from / (12 * HOUR)) * 12 * HOUR; x <= d.to; x += 12 * HOUR) tickXs.push(x);

      chartInstance = new Chart(chartCanvas, {
        type: 'line',
        data: {
          datasets: [
            { label: t.nowTemp, data: d.temp, yAxisID: 'y', borderColor: '#ef4444', tension: 0.3, pointRadius: 0, pointHitRadius: 10, borderWidth: 2.2 },
            { label: t.tideLevel, data: d.tide, yAxisID: 'y2', borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.10)', fill: 'origin', tension: 0.35, pointRadius: 0, pointHitRadius: 10, borderWidth: 2 },
            { label: t.tideHigh, data: highs, yAxisID: 'y2', borderColor: '#f97316', backgroundColor: '#f97316', pointRadius: 3, showLine: false },
            { label: t.tideLow, data: lows, yAxisID: 'y2', borderColor: '#a78bfa', backgroundColor: '#a78bfa', pointRadius: 3, showLine: false },
            { label: t.tideNow, data: nowT != null ? [{ x: d.nowLocalMs, y: nowT }] : [], yAxisID: 'y', borderColor: '#ef4444', backgroundColor: '#ffffff', borderWidth: 3, pointRadius: 5, showLine: false },
            { label: t.tideNow, data: nowH != null ? [{ x: d.nowLocalMs, y: nowH }] : [], yAxisID: 'y2', borderColor: '#38bdf8', backgroundColor: '#ffffff', borderWidth: 3, pointRadius: 5, showLine: false }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'nearest', axis: 'x', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => fmtLocalTime(items[0].parsed.x, true),
                label: (ctx) => ctx.dataset.yAxisID === 'y'
                  ? `${ctx.dataset.label}: ${formatTemp(ctx.parsed.y)}`
                  : `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} m`
              }
            }
          },
          scales: {
            x: {
              type: 'linear', min: d.from, max: d.to,
              ticks: {
                color: '#64748b', font: { size: 9 }, maxRotation: 0,
                callback: (v) => { const dd = new Date(v); return dd.getUTCHours() === 0 ? `${t.months[dd.getUTCMonth()]} ${dd.getUTCDate()}` : fmtLocalTime(v, false); }
              },
              grid: { color: '#1e293b' },
              afterBuildTicks: (axis) => { axis.ticks = tickXs.map(v => ({ value: v })); }
            },
            y: {
              position: 'left', min: T0 - tDev, max: T0 + tDev * HEAD,
              ticks: { color: '#fca5a5', font: { size: 9 }, callback: formatAxisTemp },
              grid: { color: (c) => Math.abs(c.tick.value - T0) < 1e-6 ? '#475569' : '#1e293b' },
              afterBuildTicks: (axis) => {
                // 20°C 눈금이 꼭 들어가도록 기준점부터 위/아래로 눈금 생성
                const step = tDev > 6 ? 4 : 2;
                const ticks = [];
                for (let v = T0; v >= axis.min - 1e-6; v -= step) ticks.unshift({ value: v });
                for (let v = T0 + step; v <= axis.max + 1e-6; v += step) ticks.push({ value: v });
                axis.ticks = ticks;
              }
            },
            y2: {
              position: 'right', min: -hDev, max: hDev * HEAD,
              ticks: { color: '#7dd3fc', font: { size: 9 }, callback: (v) => `${(+v).toFixed(1)}m` },
              grid: { drawOnChartArea: false },
              afterBuildTicks: (axis) => {
                // 0m 눈금이 꼭 들어가도록 (왼쪽 20°C 눈금과 같은 높이)
                const step = hDev > 1.5 ? 1 : 0.5;
                const ticks = [];
                for (let v = 0; v >= axis.min - 1e-6; v -= step) ticks.unshift({ value: v });
                for (let v = step; v <= axis.max + 1e-6; v += step) ticks.push({ value: v });
                axis.ticks = ticks;
              }
            }
          }
        }
      });

      const nextHigh = highs.find(e => e.x > d.nowLocalMs);
      const nextLow = lows.find(e => e.x > d.nowLocalMs);
      legendBox.innerHTML =
        `<div class="item" style="color:#4ade80;">🟢 ${t.nowSource}</div>` +
        `<div class="item"><span class="swatch" style="background:#ef4444;"></span>${t.nowTemp}</div>` +
        `<div class="item"><span class="swatch" style="background:#38bdf8;"></span>${t.tideLevel} (m, ${t.tideRef})</div>` +
        (nextHigh ? `<div class="item"><span class="swatch" style="background:#f97316;"></span>${t.tideNextHigh} ${fmtLocalTime(nextHigh.x, false)} (${nextHigh.y.toFixed(2)} m)</div>` : '') +
        (nextLow ? `<div class="item"><span class="swatch" style="background:#a78bfa;"></span>${t.tideNextLow} ${fmtLocalTime(nextLow.x, false)} (${nextLow.y.toFixed(2)} m)</div>` : '') +
        `<div class="item" style="color:#94a3b8;">⚠ ${t.tideNote}</div>`;
    }

    function updateChart() {
      const chartCanvas = document.getElementById('detailChart').getContext('2d');
      if (chartInstance) chartInstance.destroy();
      const legendBox = document.getElementById('chart-legend');

      if (activeMode === 'now') { renderNowChart(chartCanvas, legendBox); return; }

      if (activeMode === 'forecast') {
        const usingLive = !!selectedStation._liveCache;
        const data = usingLive ? computeTimeSeriesDataFromLive(selectedStation) : computeTimeSeriesData(selectedStation);
        chartInstance = new Chart(chartCanvas, {
          type: 'line',
          data: {
            datasets: [
              { label: t.chartPast, data: data.climLine, borderColor: '#64748b', borderDash: [4, 4], tension: 0.3, pointRadius: 0, pointHitRadius: 20 },
              { label: t.chartActual, data: data.actualLine, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.12)', fill: true, tension: 0.25, pointRadius: 0, pointHitRadius: 20, borderWidth: 2.2 },
              { label: t.chartFuture, data: data.projectedLine, borderColor: '#fca5a5', borderDash: [5, 4], tension: 0.25, pointRadius: 0, pointHitRadius: 20, borderWidth: 2 },
              { label: t.todayBadge, data: data.todayPoint, borderColor: '#ef4444', backgroundColor: '#ffffff', borderWidth: 3, pointRadius: 5, pointHitRadius: 16, pointHoverRadius: 7, showLine: false }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            // [FIX] "손가락으로 선택이 잘 안 된다" - 점 자체(반경 0)에 정확히
            // 닿아야만 반응하던 기본 동작 대신, x축 세로 전체 어디를 눌러도
            // 그 지점에서 가장 가까운 값을 찾아 보여주도록 히트 영역을 키웠습니다.
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { display: false }, // [CHANGE] 기본 범례는 끄고, 차트 안 커스텀 범례로 대체
              tooltip: {
                callbacks: {
                  // [CHANGE] "오늘이 중앙에 오게" - x가 더 이상 달력 월(0=1월)이
                  // 아니라 이동 윈도우 위치라서, 실제 달력 월/일로 환산해서 보여줍니다.
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
                  label: (ctx) => `${ctx.dataset.label}: ${formatTemp(ctx.parsed.y)}`
                }
              }
            },
            scales: {
              x: {
                type: 'linear', min: -0.4, max: 11.6,
                ticks: {
                  stepSize: 1, color: '#64748b', font: { size: 9 },
                  callback: (v) => t.months[((windowStartMonth + Math.round(v)) % 12 + 12) % 12] || ''
                },
                grid: { color: '#1e293b' }
              },
              // [FIX] "상대온도라 날뛰어 보임" - Chart.js가 데이터 범위에
              // 맞춰 Y축을 자동으로 좁게 잡다 보니, 실제로는 1~2도 차이인데
              // 축이 그만큼만 딱 맞춰져서 그래프가 요동치는 것처럼 보였어요.
              // 색상표와 같은 0~40도 절대 범위로 고정해서 실제 변화폭
              // 그대로 보이게 했습니다.
              y: { min: 0, max: 40, ticks: { color: '#64748b', font: { size: 9 }, callback: formatAxisTemp }, grid: { color: '#1e293b' } }
            }
          }
        });
        const statusLine = usingLive
          ? `<div class="item" style="color:#4ade80;">🟢 ${t.liveDataOn}</div>`
          : (selectedStation._liveState === 'loading'
              ? `<div class="item" style="color:#facc15;">⏳ ${t.liveDataLoading}</div>`
              : `<div class="item" style="color:#94a3b8;">⚠ ${t.liveDataFallback}</div>`);
        legendBox.innerHTML = statusLine + `
          <div class="item"><span class="swatch dashed" style="color:#64748b;background:#64748b;"></span>${t.chartPast}</div>
          <div class="item"><span class="swatch" style="background:#ef4444;"></span>${t.chartActual}</div>
          <div class="item"><span class="swatch dashed" style="color:#fca5a5;background:#fca5a5;"></span>${t.chartFuture}</div>
        `;
      } else {
        const data = getDepthProfile(selectedStation.curTemp, selectedStation.isBeach);
        chartInstance = new Chart(chartCanvas, {
          type: 'line',
          data: {
            labels: data.depths.map(d => `${d}m`),
            datasets: [{ label: t.chartDepthLabel, data: data.profile, borderColor: '#f43f5e', backgroundColor: 'rgba(244, 63, 94, 0.15)', fill: true, tension: 0.2, pointRadius: 3, pointHitRadius: 20 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (ctx) => `${formatTemp(ctx.parsed.y)}` } }
            },
            scales: {
              x: { title: { display: true, text: t.depthAxisLabel, color: '#94a3b8', font: { size: 10 } }, ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: '#1e293b' } },
              y: { title: { display: true, text: t.tempAxisLabel, color: '#94a3b8', font: { size: 10 } }, ticks: { color: '#64748b', font: { size: 9 }, callback: formatAxisTemp }, grid: { color: '#1e293b' } }
            }
          }
        });
        legendBox.innerHTML = `<div class="item" style="color:#94a3b8;">⚠ ${t.liveDataFallback}</div>` +
          `<div class="item"><span class="swatch" style="background:#f43f5e;"></span>${t.chartDepthLabel}</div>`;
      }
    }

    // [CHANGE] "값을 미리 불러오지 마, 사람들이 클릭했을 때만" - opts.auto가
    // true면(앱이 처음 켜질 때 기본 정점을 자동으로 고른 경우) Open-Meteo를
    // 부르지 않고 "클릭하면 불러와요" 안내만 보여줍니다. 사람이 정점을
    // 누르거나, 검색하거나, 탭을 누른 순간부터 그 정점의 값을 불러와요.
    async function selectStation(st, opts) {
      selectedStation = st;
      if (!(opts && opts.auto)) st._userRequested = true;
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

      // [ADD] "현재+과거 데이터를 실제로 가져와서 그래프 만들 수 있어?" 요청 반영.
      // Open-Meteo에서 이 정점의 실제 현재값+과거 5년+올해 실측을 가져옵니다.
      // 한 번 성공한 정점은 세션 내내 캐시돼서 재선택 시 다시 안 불러와요.
      // [CHANGE] 90일 실데이터(요청 2건)는 그 탭을 볼 때만 불러옵니다 -
      // Open-Meteo 요청 한도를 아끼려고요. 첫 탭(±2일)은 renderNowChart가 따로 불러요.
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

    function setMode(mode) {
      activeMode = mode;
      if (selectedStation) selectedStation._userRequested = true; // 탭을 누른 것도 사용자 요청
      // 수온·조석 실패 상태에서 탭을 다시 누르면 재시도
      if (mode === 'now' && selectedStation && selectedStation._hourlyState === 'failed') selectedStation._hourlyState = undefined;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      if (mode === 'forecast') document.getElementById('btn-ts').classList.add('active');
      else if (mode === 'now') document.getElementById('btn-now').classList.add('active');
      else document.getElementById('btn-dp').classList.add('active');
      updateChart();
      if (mode === 'forecast' && selectedStation) ensureLiveData(selectedStation);
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

// Three.js 구체 UV 매핑 표준 정렬
