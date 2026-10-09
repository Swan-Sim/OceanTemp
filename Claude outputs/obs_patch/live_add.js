
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
