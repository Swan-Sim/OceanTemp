// [ADD] 해협 조류 보정 - 바다 모델(약 8km 격자)은 섬 사이 좁은 해협의 밀물·썰물 조류를 거의 못 잡아요.
//  현지 관찰(타뇽 해협, ClubHari Housereef): 물이 차오르는 동안(밀물) 북으로, 만조 무렵 거의 멈춤, 빠지는 동안(썰물) 남으로.
//  → 조석 조류 = k × (그 포인트 조위의 시간당 변화율, 지연 적용) 을 해협 축 방향으로 만들고, 모델의 배경 흐름 벡터에 더해요.
//    오르는 중 +(axis 방향), 내리는 중 −(반대). 대조엔 변화율이 커서 세고 소조엔 약해요. 만조·간조 근처에서 약해지고 방향이 바뀌어요.
//  모델 배경 흐름은 해협 안에서 bgW 가중치로 줄여 더해요(관찰: 만조 때 거의 멈춤 → 모델의 고정 SSE 0.7노트는 과대). 화면엔 "해협 조류 보정 추정"으로 표시.
(function () {
  const STRAITS = [
    { // 타뇽 해협(세부 서해안 ↔ 네그로스 동해안) - 해협 안 모든 포인트에 적용
      id: 'tanon', name: { ko: '타뇽 해협', en: 'Tañon Strait' },
      box: [9.40, 10.95, 123.15, 123.85], // [위도 최소, 위도 최대, 경도 최소, 경도 최대]
      axis: 337,   // 밀물(조위 오르는 중) 때 "흘러가는" 방향(도). 관찰: 배경 SSE와 정반대로 상쇄 → NNW
      k: 1.5,      // 조위 변화율 1 m/h 당 조류 m/s. 관찰 교정(10/10 07:40 수심 5m 보정값 1.1노트 → 실제 약 1.6노트)로 1.0에서 올림
      lagH: -0.5,  // 조위 변화율 → 조류 지연(시간). 0이면 만조에 정확히 멈춤. 관찰(10/11 만조 11:00에 거의 0, 10/12 11:00 만조 45분 전인데 이미 약하게 남) → 조류가 조위보다 약 30분 앞서 바뀜
      bgW: 0.25    // 모델 배경 흐름(바람 성분 제외) 가중치. 관찰(만조 때 거의 0)과 모델(0.7노트 SSE 고정)이 안 맞아 해협 안에선 1/4로. 바람이 끄는 성분은 줄이지 않고 그대로
    }
  ];
  // [ADD] 관리자가 포인트마다 넣은 보정값(/api/spotobs?svc=curfix). 있으면 해협 기본값보다 우선
  const REF_RATE = 0.3; let fix = null, fixAt = 0, fixLoading = null;
  async function loadFix(force) {
    if (fix && !force && Date.now() - fixAt < 300e3) return fix;
    if (!fixLoading) fixLoading = fetch('/api/spotobs?svc=curfix' + (force ? '&t=' + Date.now() : '')).then(r => r.json()).then(j => { fix = (j && j.spots) || {}; fixAt = Date.now(); return fix; }).catch(() => fix || {}).finally(() => { fixLoading = null; });
    return fixLoading;
  }
  // 포인트 설정(밀물·썰물 방향 + 변화율 0.3m/h 기준 노트)을 해협 설정과 같은 모양으로 바꿔요
  function spotCfg(st, all) {
    const c = st && st.no && all && all[st.no]; if (!c || c.floodTo == null) return null;
    const kn = 0.514444;
    return { id: 'spot' + st.no, name: { ko: '포인트 보정', en: 'spot fix' }, axis: c.floodTo, ebbAxis: c.ebbTo, k: (c.floodKn || 0) * kn / REF_RATE, kEbb: (c.ebbKn || 0) * kn / REF_RATE, lagH: c.lagH == null ? -0.5 : c.lagH, bgW: c.bgW == null ? 0.25 : c.bgW, spot: true };
  }
  window.curfixGet = (no) => (fix && fix[no]) || null;
  window.curfixReload = async function () { await loadFix(true); const st = typeof selectedStation !== 'undefined' ? selectedStation : null; const d = st && st._hourlyCache;
    if (d && d._rawCurrent) { d.current = d._rawCurrent.map(c => Object.assign({}, c)); d._strait = null; await window.straitTideApply(st, d); try { if (typeof windDialUpdate === 'function') windDialUpdate(); } catch (_) {} } };
  function straitOf(st) {
    if (!st || !st.coords) return null;
    const lon = st.coords[0], lat = st.coords[1];
    return STRAITS.find(s => lat >= s.box[0] && lat <= s.box[1] && lon >= s.box[2] && lon <= s.box[3]) || null;
  }
  // 조위 변화율(m/h): 시각 x 기준 앞뒤 1시간 차이(중앙차분), 자료 끝은 한쪽 차분
  function rateAt(tide, x) {
    if (!tide || tide.length < 3) return null;
    const H = 3600e3, h = (t) => { // 선형 보간 조위
      if (t <= tide[0].x || t >= tide[tide.length - 1].x) return null;
      let lo = 0, hi = tide.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tide[m].x <= t) lo = m; else hi = m; }
      const a = tide[lo], b = tide[hi]; return a.y + (b.y - a.y) * ((t - a.x) / (b.x - a.x || 1));
    };
    const a = h(x - H), b = h(x + H);
    if (a != null && b != null) return (b - a) / 2;
    const c = h(x); if (c == null) return null;
    if (a != null) return c - a; if (b != null) return b - c; return null;
  }
  // 정점의 시간별 자료(d.current)에 조석 조류를 더해요. 바뀐 게 있으면 true (그 포인트 조위 자료만 써서 추가 요청 없음)
  window.straitTideApply = async function (st, d) {
    if (!d || !Array.isArray(d.current) || !d.current.length || !Array.isArray(d.tide) || d.tide.length < 3 || d._strait) return false;
    const all = await loadFix(false);
    const s = spotCfg(st, all) || straitOf(st); if (!s) return false;
    if (!d._rawCurrent) d._rawCurrent = d.current.map(c => Object.assign({}, c)); // 보정 전 원본(다시 적용할 때 씀)
    const r = Math.PI / 180, lag = s.lagH * 3600e3; let n = 0;
    // 바람이 끄는 표층 성분(풍속의 3%, 북반구는 바람이 가는 방향에서 오른쪽 30°) - js/wind-dial.js의 수심별 계산과 같은 식. 이 성분은 줄이지 않아요
    const lat = st.coords[1], sgn = lat >= 0 ? 1 : -1, wind = Array.isArray(d.wind) ? d.wind : [];
    const windAt = (x) => { let b = null, bd = Infinity; for (const w of wind) { const dd = Math.abs(w.x - x); if (dd < bd) { bd = dd; b = w; } } return bd <= 3 * 3600e3 ? b : null; };
    d.current = d.current.map(c => {
      if (c.speed == null || c.to == null) return c;
      const rate = rateAt(d.tide, c.x - lag); if (rate == null) return c;
      // 밀물(rate>0)은 axis 방향으로 k, 썰물(rate<0)은 ebbAxis 방향으로 kEbb(없으면 axis 반대, 같은 k)
      const flood = rate >= 0, ax = flood ? s.axis : (s.ebbAxis != null ? s.ebbAxis : (s.axis + 180) % 360);
      const ts = Math.abs(rate) * (flood ? s.k : (s.kEbb != null ? s.kEbb : s.k)); // 항상 +, 방향은 ax
      const bw = s.bgW == null ? 1 : s.bgW, w = windAt(c.x);
      let wu = 0, wv = 0; if (w && w.speed != null && w.dir != null) { const ds = 0.03 * w.speed, d0 = (w.dir + 180 + sgn * 30) * r; wu = ds * Math.sin(d0); wv = ds * Math.cos(d0); }
      const bu = c.speed * Math.sin(c.to * r) - wu, bv = c.speed * Math.cos(c.to * r) - wv; // 모델 배경에서 바람 성분을 뺀 나머지만 줄여요
      const u = bw * bu + wu + ts * Math.sin(ax * r), v = bw * bv + wv + ts * Math.cos(ax * r); n++;
      return Object.assign({}, c, { bg: { speed: c.speed, to: c.to }, tide: +((flood ? 1 : -1) * ts).toFixed(3), tideTo: ax, rate: +rate.toFixed(3), speed: +Math.hypot(u, v).toFixed(3), to: (Math.atan2(u, v) / r + 360) % 360, strait: s.id });
    });
    d._strait = s.id; return n > 0;
  };
  window.straitName = (id) => { const ko = typeof lang !== 'undefined' && lang === 'ko'; if (/^spot/.test(String(id))) return ko ? '포인트 보정' : 'spot fix'; const s = STRAITS.find(x => x.id === id); return s ? s.name[ko ? 'ko' : 'en'] : ''; };
})();
