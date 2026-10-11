// [ADD] 해협 조류 보정 - 바다 모델(약 8km 격자)은 섬 사이 좁은 해협의 밀물·썰물 조류를 거의 못 잡아요.
//  해협 안의 흐름은 "양쪽 끝 해수면 높이 차이"가 밀어요(남쪽이 높으면 북으로, 북쪽이 높으면 남으로). 두 끝의 조석 위상이 달라서 차이가 생기고,
//  대조(스프링)엔 차이가 커서 조석 조류가 배경 흐름을 이기고, 소조엔 배경 흐름이 남아요. (현지 관찰: 만조 무렵 남향 배경 + 북향 조석 ≈ 0)
//  계산: 두 참조 지점 조위(Open-Meteo sea_level_height_msl)의 차이 Δh(t) → 해협 축 방향으로 k·Δh(t−지연) 벡터 → 모델 배경 흐름 벡터에 더함.
//  k·지연시간은 시작값(물리 추정)이고, 현지 관찰·로그북 기록으로 맞춰 가요. 화면엔 "해협 조위차 보정 추정"으로 표시.
(function () {
  const STRAITS = [
    { // 타뇽 해협(세부 서해안 ↔ 네그로스 동해안). 남쪽 입구 = 두마게티 앞(보홀해), 북쪽 출구 = 비사야해. 해협 안 모든 포인트에 적용
      id: 'tanon', name: { ko: '타뇽 해협', en: 'Tañon Strait' },
      box: [9.40, 10.95, 123.15, 123.85],            // [위도 최소, 위도 최대, 경도 최소, 경도 최대]
      south: [9.25, 123.40], north: [11.00, 123.55], // 참조 지점(바다 격자 선택)
      axis: 337,           // 조석 흐름 축(도): 밀물 때 "흘러가는" 방향. 현지 관찰(배경 SSE와 정반대로 상쇄) → NNW
      k: 1.3,              // Δh 1m당 조류 m/s (기본값. 아래 cal이 있으면 관찰로 다시 계산)
      lagH: 1.5,           // 조위차 → 조류 반응 지연(시간). 관성이 크면 3시간 가까이, 마찰이 크면 0 가까이
      tz: 'Asia/Manila',
      // 관찰 교정: 이 현지 시각에 모델 배경 bgKn(노트, bgTo 방향)인데 실제는 거의 0 → 그때 조석 흐름 = 정반대 bgKn. k(부호 포함)를 여기에 맞춰요
      cal: { at: '2026-10-10T11:00', bgKn: 0.7, bgTo: 157, note: 'ClubHari Housereef 만조(1.4m) 때 실제 흐름 ≈ 0' }
    }
  ];
  const BASE = 'https://marine-api.open-meteo.com/v1/marine';
  const cache = {}; // id → { at, rows: [{x, dh}] }

  function straitOf(st) {
    if (!st || !st.coords) return null;
    const lon = st.coords[0], lat = st.coords[1];
    return STRAITS.find(s => lat >= s.box[0] && lat <= s.box[1] && lon >= s.box[2] && lon <= s.box[3]) || null;
  }
  async function dhSeries(s) {
    const c = cache[s.id]; if (c && Date.now() - c.at < 3 * 3600e3) return c.rows;
    const q = `latitude=${s.south[0]},${s.north[0]}&longitude=${s.south[1]},${s.north[1]}&hourly=sea_level_height_msl&past_days=3&forecast_days=8&timezone=${encodeURIComponent(s.tz)}&cell_selection=sea`;
    const r = await fetch(`${BASE}?${q}`); if (!r.ok) throw new Error('strait ' + r.status);
    const j = await r.json(), arr = Array.isArray(j) ? j : [j];
    if (arr.length < 2 || !arr[0].hourly || !arr[1].hourly) throw new Error('strait data');
    const a = arr[0].hourly, b = arr[1].hourly, rows = [];
    a.time.forEach((ts, i) => { const hs = a.sea_level_height_msl[i], hn = b.sea_level_height_msl[i];
      if (typeof hs === 'number' && typeof hn === 'number') rows.push({ x: Date.parse(ts + ':00Z'), dh: hs - hn }); });
    if (rows.length < 12) throw new Error('strait short');
    cache[s.id] = { at: Date.now(), rows }; calibrate(s, rows); return rows;
  }
  // 관찰 교정: 교정 시각의 Δh로 k를 정해요(부호도 함께 → 어느 쪽이 높을 때 밀물인지 자동으로 맞음). Δh가 너무 작으면(3cm 미만) 기본값 유지
  function calibrate(s, rows) {
    if (!s.cal || s._calDone) return;
    const KEY = 'otemp.strait.k.' + s.id + '.' + s.cal.at;
    const x = Date.parse(s.cal.at + ':00Z') - s.lagH * 3600e3;
    if (x < rows[0].x || x > rows[rows.length - 1].x) { try { const v = +localStorage.getItem(KEY); if (v) s.k = v; } catch (_) {} s._calDone = true; return; } // 교정 시각이 자료 범위 밖이면 전에 구한 값
    const dh = atX(rows, x), need = s.cal.bgKn * 0.514444; // 상쇄에 필요한 조석 흐름(m/s)
    if (Math.abs(dh) < 0.03) { try { console.warn('[strait]', s.id, 'calibration dh too small', dh.toFixed(3)); } catch (_) {} s._calDone = true; return; }
    s.k = +(need / dh).toFixed(3); s._calDone = true; try { localStorage.setItem(KEY, String(s.k)); } catch (_) {}
    try { console.info('[strait]', s.id, 'calibrated k =', s.k, 'dh =', dh.toFixed(3), 'm at', s.cal.at, '(lag', s.lagH, 'h)'); } catch (_) {}
  }
  const atX = (rows, x) => { // 선형 보간
    if (x <= rows[0].x) return rows[0].dh; if (x >= rows[rows.length - 1].x) return rows[rows.length - 1].dh;
    let lo = 0, hi = rows.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rows[m].x <= x) lo = m; else hi = m; }
    const a = rows[lo], b = rows[hi]; return a.dh + (b.dh - a.dh) * ((x - a.x) / (b.x - a.x || 1));
  };
  // 정점의 시간별 자료(d.current)에 조석 조류를 더해요. 바뀐 게 있으면 true
  window.straitTideApply = async function (st, d) {
    const s = straitOf(st); if (!s || !d || !Array.isArray(d.current) || !d.current.length || d._strait) return false;
    let rows; try { rows = await dhSeries(s); } catch (_) { return false; }
    const r = Math.PI / 180, lag = s.lagH * 3600e3;
    d.current = d.current.map(c => {
      if (c.speed == null || c.to == null) return c;
      const dh = atX(rows, c.x - lag), ts = s.k * dh;                      // +면 남→북(axis), −면 북→남
      const u = c.speed * Math.sin(c.to * r) + ts * Math.sin(s.axis * r), v = c.speed * Math.cos(c.to * r) + ts * Math.cos(s.axis * r);
      return Object.assign({}, c, { bg: { speed: c.speed, to: c.to }, tide: +ts.toFixed(3), dh: +dh.toFixed(3), speed: +Math.hypot(u, v).toFixed(3), to: (Math.atan2(u, v) / r + 360) % 360, strait: s.id });
    });
    d._strait = s.id; return true;
  };
  window.straitName = (id) => { const s = STRAITS.find(x => x.id === id); return s ? s.name[(typeof lang !== 'undefined' && lang === 'ko') ? 'ko' : 'en'] : ''; };
})();
