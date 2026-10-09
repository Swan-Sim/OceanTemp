import os
os.chdir(os.path.expanduser('~/mnt/WaterTemp'))

def rep(path, a, b, count=1):
    s = open(path).read()
    assert s.count(a) == count, (path, a[:70], s.count(a))
    open(path, 'w').write(s.replace(a, b))

# ── panel-charts.js: 지난 해 평균선 + 범위 띠, 앞으로의 추정도 이 평균을 기준으로 ──
P = 'js/panel-charts.js'
rep(P, """      return { climLine, actualLine, projectedLine, todayPoint: todayLine };
    }

    // ===FIRST===""", """      // [ADD] 지난 해 같은 날짜 실측: 그래프 1년 범위를 하루씩, 1~3년 전 같은 날(±3일 평균)을 모아 평균·최저·최고
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
""")

# 그래프: 지난 해 선이 있으면 월별 평년 점선 대신 흰 평균선 + 옅은 띠
rep(P, """        const datasets = [
          { label: (selectedStation._liveCache && selectedStation._liveCache.climYears) ? t.chartPastObs(selectedStation._liveCache.climYears) : t.chartPast, data: data.climLine, borderColor: '#5B6474', borderDash: [4, 4], tension: 0.3, pointRadius: 0, pointHitRadius: 20 },""",
"""        const prev = data.prev && data.prev.nYears ? data.prev : null;
        const datasets = [
          { label: (selectedStation._liveCache && selectedStation._liveCache.climYears) ? t.chartPastObs(selectedStation._liveCache.climYears) : t.chartPast, data: data.climLine, borderColor: '#5B6474', borderDash: [4, 4], tension: 0.3, pointRadius: 0, pointHitRadius: 20, hidden: !!prev },""")
rep(P, """        // [ADD] 시야: 실측(위성 7일 평균) 실선 + 일별 점, 앞으로의 추세 점선 + 두꺼운 반투명 오차 범위
        if (vis) try {""",
"""        // [ADD] 지난 해 같은 날짜 실측: 옅은 띠(최저~최고) + 흰 평균선. 수온 선들 뒤에 깔리게 앞쪽에 넣어요
        if (prev) {
          datasets.splice(1, 0,
            { label: t.prevRange(prev.nYears), data: prev.lo, borderWidth: 0, pointRadius: 0, fill: false, tension: 0.3, _noTip: true },
            { label: t.prevRange(prev.nYears), data: prev.hi, borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(203,213,225,0.14)', tension: 0.3, _noTip: true },
            { label: t.prevAvg(prev.nYears), data: prev.avg, borderColor: 'rgba(226,232,240,0.85)', borderWidth: 1.6, pointRadius: 0, pointHitRadius: 10, tension: 0.3 }
          );
        }
        // [ADD] 시야: 실측(위성 7일 평균) 실선 + 일별 점, 앞으로의 추세 점선 + 두꺼운 반투명 오차 범위
        if (vis) try {""")
rep(P, """          datasets.length = 4; vis = null;""", """          datasets.length = prev ? 7 : 4; vis = null;""")
rep(P, """          <div class="item"><span class="swatch dashed" style="color:#5B6474;background:#5B6474;"></span>${(selectedStation._liveCache && selectedStation._liveCache.climYears) ? t.chartPastObs(selectedStation._liveCache.climYears) : t.chartPast}</div>""",
"""          ${prev
            ? `<div class="item"><span class="swatch" style="background:rgba(226,232,240,.85);"></span>${t.prevAvg(prev.nYears)}</div><div class="item"><span class="swatch" style="background:rgba(203,213,225,.35);height:6px;"></span>${t.prevRange(prev.nYears)}</div>`
            : `<div class="item"><span class="swatch dashed" style="color:#5B6474;background:#5B6474;"></span>${(selectedStation._liveCache && selectedStation._liveCache.climYears) ? t.chartPastObs(selectedStation._liveCache.climYears) : t.chartPast}</div>`}""")

# ── 탭 이름 + 문구 ──
I = 'js/i18n-and-input.js'
rep(I, 'tabForecast: "90일 추이",', 'tabForecast: "연간 추이",\n        prevAvg: (n) => `지난 ${n}년 같은 날 실측 평균`, prevRange: (n) => `지난 ${n}년 범위(최저~최고)`,')
rep(I, 'tabForecast: "90-day trend",', 'tabForecast: "Yearly trend",\n        prevAvg: (n) => `Past ${n}-yr observed avg (same dates)`, prevRange: (n) => `Past ${n}-yr range (min-max)`,')
rep('index.html', """onclick="setMode('forecast')">90일 추이</button>""", """onclick="setMode('forecast')">연간 추이</button>""")
print('client ok')
