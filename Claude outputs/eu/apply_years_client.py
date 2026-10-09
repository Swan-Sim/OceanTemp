import os
os.chdir(os.path.expanduser('~/mnt/WaterTemp'))

def rep(path, a, b, count=1):
    s = open(path).read()
    assert s.count(a) == count, (path, a[:70], s.count(a))
    open(path, 'w').write(s.replace(a, b))

# ── 서버 일수 한도: 그래프 왼쪽 끝(5개월 전)의 3년 전까지 ──
rep('api/khoa.js', "Math.max(7, Math.min(1100, parseInt(req.query.days, 10) || 90))", "Math.max(7, Math.min(1300, parseInt(req.query.days, 10) || 90))")
rep('api/kma.js', "Math.max(7, Math.min(1100, parseInt(req.query.days, 10) || 1095))", "Math.max(7, Math.min(1300, parseInt(req.query.days, 10) || 1250))")
W = 'scripts/warm-visibility.mjs'
rep(W, "svc=wtdaily&obs=${code}&days=1095&maxFetch=350", "svc=wtdaily&obs=${code}&days=1250&maxFetch=350")
rep(W, "쌓인 날 ${j.count ?? '?'}/1095", "쌓인 날 ${j.count ?? '?'}/1250")
rep(W, "svc=backfill&days=1095&maxFetch=300", "svc=backfill&days=1250&maxFetch=300")
rep(W, "${j.have ?? '?'}/1095일", "${j.have ?? '?'}/1250일")
rep(W, "svc=wtclim&id=${id}`, { signal: AbortSignal.timeout(70000) })", "svc=wtyears&id=${id}`, { signal: AbortSignal.timeout(70000) })")
rep(W, "console.log(`NOAA ${id}: ${j.years ?? '?'}년치`);", "console.log(`NOAA ${id}: ${Object.keys(j.days || {}).length}일치`);")

# ── live-data.js: 관측소별 지난 해 일평균(years)도 같이 받기 ──
L = 'js/live-data.js'
s = open(L).read()
i0 = s.index('    async function obsDailyTemps(st) {')
i1 = s.index('\n    }\n', i0) + len('\n    }\n')
s = s[:i0] + """    async function obsDailyTemps(st) {
      if (!/^https?:$/.test(location.protocol)) return null;
      const lat = st.coords[1], lon = st.coords[0];
      const get = (url, ms) => fetchJSON(url, ms, 0).catch(() => null);
      const pack = (r, clim, yrs, source) => {
        const daily = (r && r.ok && r.rows) || [];
        const days = (yrs && yrs.ok && yrs.days) || null;
        return (daily.length || days) ? { daily, clim, days, source } : null;
      };
      if (inKoreaWaters(lat, lon)) {
        const j = await once('khoa-st', () => fetchJSON('/api/khoa?svc=stations', 130000, 0));
        const p = nearestOf(j && j.ok ? j.stations : [], lat, lon, OBS_RADIUS_KM, s => s.kind !== 'buoy');
        if (!p) {
          // 근처에 조위관측소가 없으면(독도·먼바다) 기상청 부이 정오 수온으로
          const mj = await once('kma-st', () => fetchJSON('/api/kma?svc=stations', 30000, 0)).catch(() => null);
          const m = nearestOf(mj && mj.ok ? mj.stations : [], lat, lon, KOREA_BUOY_KM);
          if (!m) return null;
          const [r, clim, yrs] = await Promise.all([get(`/api/kma?svc=daily&stn=${m.id}&days=${OBS_DAILY_DAYS}`, 50000), get(`/api/kma?svc=clim&stn=${m.id}`, 15000), get(`/api/kma?svc=years&stn=${m.id}`, 15000)]);
          return pack(r, clim, yrs, { kind: 'kma', name: m.name + ' ' + t.obsBuoyWord, dist: m.dist });
        }
        const [r, clim, yrs] = await Promise.all([get(`/api/khoa?svc=wtdaily&obs=${p.code}&days=${OBS_DAILY_DAYS}`, 50000), get(`/api/khoa?svc=wtclim&obs=${p.code}`, 15000), get(`/api/khoa?svc=wtyears&obs=${p.code}`, 15000)]);
        return pack(r, clim, yrs, { kind: 'khoa', name: p.name, dist: p.dist });
      }
      if (inUsWaters(lat, lon)) {
        const j = await once('noaa-st', () => fetchJSON('/api/noaa?svc=stations', 45000, 0));
        const p = nearestOf(j && j.ok ? j.coops : [], lat, lon, OBS_RADIUS_KM, s => s.wt);
        if (!p) return null;
        const ymdUtc = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
        const [r, clim, yrs] = await Promise.all([
          coopsGet(p.id, 'water_temperature', `&interval=h&begin_date=${ymdUtc(Date.now() - OBS_DAILY_DAYS * 86400e3)}&end_date=${ymdUtc(Date.now())}`),
          get(`/api/noaa?svc=wtclim&id=${p.id}`, 40000), get(`/api/noaa?svc=wtyears&id=${p.id}`, 40000)
        ]);
        const by = {};
        ((r && r.data) || []).forEach(o => { const v = +o.v; if (!Number.isFinite(v) || v < -3 || v > 40) return; const d = String(o.t).slice(0, 10); (by[d] = by[d] || []).push(v); });
        const rows = Object.keys(by).sort()
          .filter(d => !(by[d].length >= 6 && Math.max(...by[d]) - Math.min(...by[d]) < 0.05)) // 멈춘 센서
          .map(d => ({ d, t: +(by[d].reduce((a, b) => a + b, 0) / by[d].length).toFixed(2) }));
        return pack({ ok: true, rows }, clim, yrs, { kind: 'coops', name: p.name, dist: p.dist });
      }
      // 유럽 등: Copernicus 고정 관측소 수온 (최근 약 30일은 하루 파일, 그 전은 월별 파일)
      const j = await once('cmems-st', () => fetchJSON('/api/cmems?svc=stations', 60000, 0)).catch(() => null);
      const p = nearestOf(j && j.ok ? j.stations : [], lat, lon, EU_TEMP_KM, s => s.p.includes('T'));
      if (!p) return null;
      const q = `id=${encodeURIComponent(p.id)}${p.m ? '&m=' + encodeURIComponent(p.m) : ''}`;
      const [r, clim, yrs] = await Promise.all([get(`/api/cmems?svc=wtdaily&${q}&days=${OBS_DAILY_DAYS}`, 55000), get(`/api/cmems?svc=wtclim&${q}`, 15000), get(`/api/cmems?svc=wtyears&${q}`, 15000)]);
      return pack(r, clim, yrs, { kind: 'cmems', name: cmemsName(p), dist: p.dist });
    }

    // [ADD] 관측소 일평균 정리: 고장 센서 값 걸러내기
    //  1) 말이 안 되는 값  2) 4일 넘게 똑같은 값이 이어지면(멈춘 센서) 통째로  3) 같은 달 중앙값과 6°C 넘게 다르면
    function cleanDailyMap(days) {
      const keys = Object.keys(days || {}).filter(d => /^\\d{8}$/.test(d)).sort();
      let arr = keys.map(d => ({ d, v: +days[d] })).filter(o => Number.isFinite(o.v) && o.v > -2.5 && o.v < 36);
      const keep = new Array(arr.length).fill(true);
      for (let i = 0; i < arr.length;) {
        let j = i;
        while (j + 1 < arr.length && Math.abs(arr[j + 1].v - arr[i].v) < 0.005) j++;
        if (j - i + 1 >= 4) for (let k = i; k <= j; k++) keep[k] = false;
        i = j + 1;
      }
      arr = arr.filter((_, i) => keep[i]);
      const byM = {};
      arr.forEach(o => (byM[o.d.slice(4, 6)] = byM[o.d.slice(4, 6)] || []).push(o.v));
      const med = {};
      Object.keys(byM).forEach(m => { const a = byM[m].slice().sort((x, y) => x - y); med[m] = a[Math.floor(a.length / 2)]; });
      const out = {};
      arr.forEach(o => { if (Math.abs(o.v - med[o.d.slice(4, 6)]) <= 6) out[o.d] = o.v; });
      return out;
    }
    // 정리된 일평균 → 월별 평년(10일 이상 있는 달만) + 몇 년치인지
    function climFromDaily(days) {
      const byMonth = Array.from({ length: 12 }, () => []);
      Object.entries(days).forEach(([d, v]) => byMonth[+d.slice(4, 6) - 1].push(v));
      const months = byMonth.map(a => a.length >= 10 ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
      const nDays = byMonth.reduce((a, m) => a + m.length, 0);
      return { ok: true, months, nDays, years: +(nDays / 365).toFixed(1) };
    }
""" + s[i1:]

# fetchStationRealData: 정리된 값 사용 + 지난 해 일평균 붙이기
a = """        if (obs && obs.daily.length >= 14) {
          result.actualLine = obs.daily.map(o => {"""
b = """        // [ADD] 지난 해 같은 날짜 비교(연간 추이의 흰 선·띠)용: 정리된 일평균 + 평년도 이걸로 다시 계산(고장 센서 값 제외)
        if (obs && obs.days) {
          const clean = cleanDailyMap(obs.days);
          if (Object.keys(clean).length >= 60) {
            result.prevDays = clean;
            obs.clim = climFromDaily(clean);
          }
        }
        // 최근 실측도 같은 기준으로 걸러요(지난 해 기록이 있으면 그 달 범위와 비교)
        if (obs && obs.daily.length) {
          const recent = cleanDailyMap(Object.fromEntries([
            ...Object.entries(result.prevDays || {}),
            ...obs.daily.map(o => [o.d.replace(/-/g, ''), o.t])
          ]));
          obs.daily = obs.daily.filter(o => recent[o.d.replace(/-/g, '')] != null);
          // 지금 Open-Meteo 값과 6°C 넘게 다르면 최근 실측은 쓰지 않아요
          const lastObs = obs.daily.length ? obs.daily[obs.daily.length - 1].t : null;
          if (lastObs != null && Math.abs(lastObs - currentTemp) > 6) obs.daily = [];
        }
        if (obs && (obs.daily.length >= 14 || result.prevDays)) {
          if (obs.daily.length >= 14) result.actualLine = obs.daily.map(o => {"""
rep(L, a, b)
rep(L, """          result.obsSource = obs.source;
          // 평년""", """          if (obs.daily.length >= 14) result.obsSource = obs.source; else result.prevSource = obs.source;
          // 평년""")
rep(L, """          result.currentTemp = obs.daily[obs.daily.length - 1].t; // 그래프가 끊기지 않게 최신 실측에서 이어 감""",
"""          if (obs.daily.length >= 14) result.currentTemp = obs.daily[obs.daily.length - 1].t; // 그래프가 끊기지 않게 최신 실측에서 이어 감""")

# ── panel-charts.js: 지난 해 평균선 + 범위 띠, 앞으로의 추정도 이 평균을 기준으로 ──
P = 'js/panel-charts.js'
rep(P, """      return { climLine, actualLine, projectedLine, todayPoint: todayLine };
    }
""", """      // [ADD] 지난 해 같은 날짜 실측: 그래프 1년 범위를 하루씩, 1~3년 전 같은 날(±3일 평균)을 모아 평균·최저·최고
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
