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
      k: 1.0,      // 조위 변화율 1 m/h 당 조류 m/s (조차 1.4m → 최대 약 0.7노트). 관찰 세기 들어오면 조정
      lagH: 0.5,   // 조위 변화율 → 조류 지연(시간). 0이면 만조에 정확히 멈춤
      bgW: 0.25    // 모델 배경 흐름 가중치. 관찰(만조 때 거의 0)과 모델(0.7노트 SSE 고정)이 안 맞아 해협 안에선 배경을 1/4로 줄여요
    }
  ];
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
    const s = straitOf(st); if (!s || !d || !Array.isArray(d.current) || !d.current.length || !Array.isArray(d.tide) || d.tide.length < 3 || d._strait) return false;
    const r = Math.PI / 180, lag = s.lagH * 3600e3; let n = 0;
    d.current = d.current.map(c => {
      if (c.speed == null || c.to == null) return c;
      const rate = rateAt(d.tide, c.x - lag); if (rate == null) return c;
      const ts = s.k * rate; // +면 밀물 방향(axis), −면 반대
      const bw = s.bgW == null ? 1 : s.bgW;
      const u = bw * c.speed * Math.sin(c.to * r) + ts * Math.sin(s.axis * r), v = bw * c.speed * Math.cos(c.to * r) + ts * Math.cos(s.axis * r); n++;
      return Object.assign({}, c, { bg: { speed: c.speed, to: c.to }, tide: +ts.toFixed(3), rate: +rate.toFixed(3), speed: +Math.hypot(u, v).toFixed(3), to: (Math.atan2(u, v) / r + 360) % 360, strait: s.id });
    });
    d._strait = s.id; return n > 0;
  };
  window.straitName = (id) => { const s = STRAITS.find(x => x.id === id); return s ? s.name[(typeof lang !== 'undefined' && lang === 'ko') ? 'ko' : 'en'] : ''; };
})();
