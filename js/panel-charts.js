    function computeTimeSeriesData(baseTemp) {
      // [FIX] "5년 평균은 19.6도인데 실측값이 8도대로 나온다" - 실제 버그였어요.
      // 평년선(12개 점)과 실측/추정선(각각 다른 개수의 점)이 서로 다른 x
      // 간격을 쓰고 있었는데, Chart.js의 interaction mode:'index'는 x값이
      // 아니라 "배열상 같은 순번(인덱스)"끼리 짝지어서 툴팁을 보여줘요.
      // 그래서 "7월"에 커서를 올려도 평년선은 진짜 7월(19.6도)을, 실측선은
      // 순번이 우연히 같았던 2월대(8도대)를 보여주는 식으로 엇갈렸던 거예요.
      // 세 선 모두 동일한 x 그리드를 쓰게 통일하고, 각 선이 해당하지 않는
      // 구간은 null로 비워서(Chart.js가 자동으로 건너뜀) 완전히 정렬시켰습니다.
      const daysInCurMonth = new Date(todayObj.getFullYear(), curMonth + 1, 0).getDate();
      const todayX = curMonth + (curDate - 1) / daysInCurMonth;

      function climAt(x) {
        const annualCycle = Math.sin((x - 3) * (Math.PI / 6)) * 6.5;
        return Math.max(0, baseTemp + annualCycle);
      }

      const baseAnomaly = baseTemp - climAt(todayX);

      const STEPS = 48; // 0~11(1월~12월)을 세 선이 공유하는 촘촘한 그리드
      const climLine = [], actualLine = [], projectedLine = [];
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
      }

      const todayPoint = [{ x: todayX, y: +baseTemp.toFixed(1) }];

      return { climLine, actualLine, projectedLine, todayPoint };
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
        const data = computeTimeSeriesData(selectedStation.curTemp);
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
              y: { ticks: { color: '#64748b', font: { size: 9 }, callback: formatAxisTemp }, grid: { color: '#1e293b' } }
            }
          }
        });
        legendBox.innerHTML = `
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

    function selectStation(st) {
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

      updateChart();
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
      if (selectedStation) {
        document.getElementById('st-temp').innerText = formatTemp(selectedStation.curTemp);
        updateChart();
      }
    }

// Three.js 구체 UV 매핑 표준 정렬
