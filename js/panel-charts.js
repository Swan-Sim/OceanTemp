    function computeTimeSeriesData(baseTemp) {
      // [FIX] 기존엔 "오늘" 지점을 12개월 사이에 억지로 끼워넣어 13칸짜리
      // 카테고리 축을 만들었는데, Chart.js 카테고리 축은 칸 간격을 전부 동일하게
      // 그리기 때문에 그 지점부터 뒤 구간이 다 밀리면서 기울기가 왜곡됐어요.
      // 월 인덱스(0~11)를 연속된 숫자 x값으로 쓰고, "오늘"은 그 달 안에서
      // 실제 날짜 비율(예: 9월 18일 → 9월과 10월 사이 약 57% 지점)로 위치시킵니다.
      const past5YearAvg = [];
      const future1Year = [];

      for (let i = 0; i < 12; i++) {
        const annualCycle = Math.sin((i - 3) * (Math.PI / 6)) * 6.5;
        const avgVal = Math.max(0, +(baseTemp + annualCycle).toFixed(1));
        past5YearAvg.push({ x: i, y: avgVal });

        const anomaly = baseTemp - avgVal;
        const decay = Math.exp(-i / 4.5);
        future1Year.push({ x: i, y: Math.max(0, +(avgVal + anomaly * decay).toFixed(1)) });
      }

      const daysInCurMonth = new Date(todayObj.getFullYear(), curMonth + 1, 0).getDate();
      const todayX = curMonth + (curDate - 1) / daysInCurMonth;
      const todayPoint = [{ x: todayX, y: baseTemp }];

      return { past5YearAvg, future1Year, todayPoint };
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

      if (activeMode === 'forecast') {
        const data = computeTimeSeriesData(selectedStation.curTemp);
        chartInstance = new Chart(chartCanvas, {
          type: 'line',
          data: {
            datasets: [
              { label: t.chartPast, data: data.past5YearAvg, borderColor: '#64748b', borderDash: [4, 4], tension: 0.3, pointRadius: 1 },
              { label: t.chartFuture, data: data.future1Year, borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.15)', fill: true, tension: 0.3, pointRadius: 2 },
              { label: t.todayBadge, data: data.todayPoint, borderColor: '#ef4444', backgroundColor: '#ffffff', borderWidth: 3, pointRadius: 6, pointHoverRadius: 8, showLine: false }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: '#cbd5e1', font: { size: 10 } } },
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
              y: { ticks: { color: '#64748b', font: { size: 9 }, callback: (v) => `${v}°C / ${cToF(v)}°F` }, grid: { color: '#1e293b' } }
            }
          }
        });
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
              legend: { labels: { color: '#cbd5e1', font: { size: 10 } } },
              tooltip: { callbacks: { label: (ctx) => `${formatTemp(ctx.parsed.y)}` } }
            },
            scales: {
              x: { title: { display: true, text: t.depthAxisLabel, color: '#94a3b8', font: { size: 10 } }, ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: '#1e293b' } },
              y: { title: { display: true, text: t.tempAxisLabel, color: '#94a3b8', font: { size: 10 } }, ticks: { color: '#64748b', font: { size: 9 }, callback: (v) => `${v}°` }, grid: { color: '#1e293b' } }
            }
          }
        });
      }
    }

    function selectStation(st) {
      selectedStation = st;
      const isHotspot = maxTempStation && maxTempStation.id === st.id;
      document.getElementById('st-name').innerText = `${st.name} ${isHotspot ? `🔥 [${t.hotspot}]` : ''}`;
      document.getElementById('st-temp').innerText = formatTemp(st.curTemp);

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

// Three.js 구체 UV 매핑 표준 정렬
