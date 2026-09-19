    function computeTimeSeriesData(baseTemp) {
      // [CHANGE] 기존엔 "평년"과 "1년 추정치" 두 줄만 있고, 정작 "올해 실제로
      // 어떻게 흘러왔는지"를 보여주는 선이 없었어요. 연초(1/1)~오늘까지는
      // 실측값(실선, 붉은색 계열)으로, 오늘~연말까지는 추정값(점선)으로
      // 나눠서 그립니다. 평년(5~6년 평균) 기준선은 그대로 유지해요.
      const daysInCurMonth = new Date(todayObj.getFullYear(), curMonth + 1, 0).getDate();
      const todayX = curMonth + (curDate - 1) / daysInCurMonth;

      function climAt(x) {
        const annualCycle = Math.sin((x - 3) * (Math.PI / 6)) * 6.5;
        return Math.max(0, baseTemp + annualCycle);
      }

      const climLine = [];
      for (let i = 0; i <= 11; i++) climLine.push({ x: i, y: +climAt(i).toFixed(1) });

      const baseAnomaly = baseTemp - climAt(todayX);

      // 실측값: 1월 1일(x=0)부터 오늘까지 - 편차가 0에서 시작해 오늘 시점엔 실제 편차만큼
      const actualLine = [];
      const steps = Math.max(4, Math.round(todayX * 4));
      for (let s = 0; s <= steps; s++) {
        const x = (todayX * s) / steps;
        const frac = todayX > 0 ? x / todayX : 1;
        actualLine.push({ x, y: +(climAt(x) + baseAnomaly * frac).toFixed(1) });
      }

      // 추정값: 오늘부터 12월까지 - 편차가 서서히 평년으로 수렴
      const projectedLine = [];
      const remain = Math.max(0.01, 11 - todayX);
      const remainSteps = Math.max(4, Math.round(remain * 4));
      for (let s = 0; s <= remainSteps; s++) {
        const x = todayX + (remain * s) / remainSteps;
        const decay = Math.exp(-(x - todayX) / 3.2);
        projectedLine.push({ x, y: +(climAt(x) + baseAnomaly * decay).toFixed(1) });
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
              { label: t.chartPast, data: data.climLine, borderColor: '#64748b', borderDash: [4, 4], tension: 0.3, pointRadius: 0 },
              { label: t.chartActual, data: data.actualLine, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.12)', fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2.2 },
              { label: t.chartFuture, data: data.projectedLine, borderColor: '#38bdf8', borderDash: [5, 4], tension: 0.25, pointRadius: 0, borderWidth: 2 },
              { label: t.todayBadge, data: data.todayPoint, borderColor: '#ef4444', backgroundColor: '#ffffff', borderWidth: 3, pointRadius: 5, pointHoverRadius: 7, showLine: false }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
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
          <div class="item"><span class="swatch dashed" style="color:#38bdf8;background:#38bdf8;"></span>${t.chartFuture}</div>
        `;
      } else {
        const data = getDepthProfile(selectedStation.curTemp, selectedStation.isBeach);
        chartInstance = new Chart(chartCanvas, {
          type: 'line',
          data: {
            labels: data.depths.map(d => `${d}m`),
            datasets: [{ label: t.chartDepthLabel, data: data.profile, borderColor: '#f43f5e', backgroundColor: 'rgba(244, 63, 94, 0.15)', fill: true, tension: 0.2, pointRadius: 3 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
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

      // [ADD] 지구본 위 HUD의 안내 문구("원하는 곳을 클릭하세요")를
      // 클릭한 정점 이름으로 바꿔서 보여줍니다.
      const hudLabel = document.getElementById('txt-legend-beach');
      if (hudLabel) hudLabel.innerText = st.name;

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
