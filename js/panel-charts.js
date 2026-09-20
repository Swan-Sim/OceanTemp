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
      const todayX = curMonth + (curDate - 1) / daysInCurMonth;
      const STEPS = 48;
      const gridSpacing = 11 / STEPS;

      function nearestActual(x) {
        if (!live.actualLine.length) return null;
        let best = null, bestDiff = Infinity;
        for (const p of live.actualLine) {
          const diff = Math.abs(p.x - x);
          if (diff < bestDiff) { bestDiff = diff; best = p; }
        }
        return best && bestDiff < gridSpacing * 1.5 ? best.y : null;
      }

      const baseAnomaly = baseTemp - climAtFromMonthly(live.climByMonth, todayX);
      const climLine = [], actualLine = [], projectedLine = [], todayLine = [];
      const todayIdx = Math.round((todayX / 11) * STEPS);

      for (let s = 0; s <= STEPS; s++) {
        const x = (11 * s) / STEPS;
        const clim = climAtFromMonthly(live.climByMonth, x);
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
      const todayX = curMonth + (curDate - 1) / daysInCurMonth;

      // [CHANGE] "가장 가까운 정점 하나 말고 주변 정점들 평균 반영해줘" -
      // 이 정점 자체는 실데이터를 못 가져왔어도, 근처 실데이터 정점 여러 개의
      // 거리 가중 평균 곡선을 가져다가 이 정점의 실제 현재값에 맞춰
      // 눈금만 평행이동해서 씁니다.
      const nearbyAvg = getNearbyLiveClimAverage(station, 5);
      let climAt;
      if (nearbyAvg) {
        const shift = baseTemp - climAtFromMonthly(nearbyAvg.climByMonth, todayX);
        climAt = (x) => Math.max(0, climAtFromMonthly(nearbyAvg.climByMonth, x) + shift);
      } else {
        // [FIX] 남반구는 계절이 반대(7월이 겨울, 1월이 여름)인데 모든 정점이
        // 같은 사인파를 썼어요. 위도가 음수면 위상을 6개월 밀었습니다.
        const phaseShift = lat < 0 ? 6 : 0;
        climAt = (x) => Math.max(0, baseTemp + Math.sin((x - 3 + phaseShift) * (Math.PI / 6)) * 6.5);
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

      const STEPS = 48; // 0~11(1월~12월)을 모든 선이 공유하는 촘촘한 그리드
      const climLine = [], actualLine = [], projectedLine = [], todayLine = [];
      const todayIdx = Math.round((todayX / 11) * STEPS);
      for (let s = 0; s <= STEPS; s++) {
        const x = (11 * s) / STEPS;
        climLine.push({ x, y: +climAt(x).toFixed(1) });

        // 실측값: 연초(1/1)부터 오늘까지 - 편차가 0에서 시작해 오늘 시점엔 실제 편차만큼
        if (x <= todayX) {
          const frac = todayX > 0 ? x / todayX : 1;
          actualLine.push({ x, y: +(climAt(x) + baseAnomaly * frac).toFixed(1) });
        } else {
          actualLine.push({ x, y: null });
        }

        // 추정값: 오늘부터 12월까지 - 편차가 서서히 평년으로 수렴
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

    function updateChart() {
      const chartCanvas = document.getElementById('detailChart').getContext('2d');
      if (chartInstance) chartInstance.destroy();
      const legendBox = document.getElementById('chart-legend');

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
                  title: (items) => {
                    const xi = items[0].parsed.x;
                    const mi = Math.max(0, Math.min(11, Math.floor(xi + 1e-6)));
                    const frac = xi - mi;
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
                type: 'linear', min: -0.4, max: 11.4,
                ticks: { stepSize: 1, color: '#64748b', font: { size: 9 }, callback: (v) => t.months[Math.round(v)] || '' },
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
        legendBox.innerHTML = `<div class="item"><span class="swatch" style="background:#f43f5e;"></span>${t.chartDepthLabel}</div>`;
      }
    }

    async function selectStation(st) {
      selectedStation = st;
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
        if (activeMode === 'depth') activeMode = 'forecast';
      } else {
        depthBtn.style.opacity = '1';
        depthBtn.style.pointerEvents = 'auto';
      }

      updateChart(); // 실데이터가 아직 없으면 예시값으로 먼저 보여주고

      // [ADD] "현재+과거 데이터를 실제로 가져와서 그래프 만들 수 있어?" 요청 반영.
      // Open-Meteo에서 이 정점의 실제 현재값+과거 5년+올해 실측을 가져옵니다.
      // 한 번 성공한 정점은 세션 내내 캐시돼서 재선택 시 다시 안 불러와요.
      if (!st._liveCache) {
        st._liveState = 'loading';
        if (selectedStation === st) updateChart();
        try {
          await fetchStationRealData(st);
        } catch (e) {
          console.warn('[live-data] 정점 실데이터 가져오기 실패, 예시값 유지:', e);
          st._liveState = 'failed';
        }
        if (selectedStation === st) updateChart(); // 그 사이 다른 정점을 안 골랐으면 실데이터로 다시 그림
      }
    }

    function setMode(mode) {
      activeMode = mode;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      if (mode === 'forecast') document.getElementById('btn-ts').classList.add('active');
      else document.getElementById('btn-dp').classList.add('active');
      updateChart();
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
      if (legendMax) legendMax.innerText = tempUnit === 'F' ? `${cToF(40)}°F+` : '40°C+';

      if (selectedStation) {
        document.getElementById('st-temp').innerText = formatTemp(selectedStation.curTemp);
        updateChart();
      }
    }

// Three.js 구체 UV 매핑 표준 정렬
