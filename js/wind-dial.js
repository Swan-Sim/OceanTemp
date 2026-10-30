    // [ADD] 바람·파도 나침반 - 상세 지도(줌인)에서 정점을 고르면 그 점 둘레에 원을 그리고
    //   노란 화살표 = 바람(불어오는 쪽 → 정점, 길이·굵기 = 세기), 하늘색 물결 = 파도(들어오는 쪽 → 정점, 크기 = 파고)
    //   아래 실시간 현황 표를 좌우로 넘기면 표 가운데 시각의 값으로 바뀌어요(windDialSetTime).
    //   방향은 기상 관례대로 "오는 방향"(Open-Meteo wind_direction_10m, wave_direction, 관측소 풍향 모두 같은 기준).
    //   [ADD] 초록 화살표 = 흐름(정점에서 "흘러가는 쪽"으로). 점선 = 수면 흐름(Copernicus 표층 합성 해류: 조류+해류+바람·파도가 미는 흐름),
    //   실선 = 수심 5m(안전정지, 바람 영향 남음)·30m(거의 조류) 흐름 추정 = 수면 흐름에서 바람이 끄는 몫(바람의 약 3%, 북반구는 바람 방향에서 오른쪽 30°)을 깊이에 따라 줄인 값.
    //   모델 격자가 약 8km라 섬·곶 주변의 국지 흐름(지형 영향)은 반영되지 않아요.
    let windDialMarker = null, windDialX = null, windDialRaf = 0, windDialLastSize = null;
    const windDialPos = () => { try { return localStorage.getItem('otemp.dial.pos') || 'E'; } catch (_) { return 'E'; } };
    // 상자 끌기: 손을 떼면 원 중심 기준 각도로 8방향 중 가장 가까운 곳에 붙음
    document.addEventListener('pointerdown', (e) => {
      const g = e.target && e.target.closest && e.target.closest('[data-dial-drag]'); if (!g) return;
      e.stopPropagation(); e.preventDefault();
      const svg = g.closest('svg'), map = typeof leafletMap !== 'undefined' ? leafletMap : null;
      try { if (map && map.dragging) map.dragging.disable(); } catch (_) {}
      const base = g.getAttribute('transform') || '', x0 = e.clientX, y0 = e.clientY; let moved = false;
      const mv = (ev) => { const dx = ev.clientX - x0, dy = ev.clientY - y0; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; g.setAttribute('transform', `translate(${dx} ${dy}) ` + base); };
      const up = (ev) => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        try { if (map && map.dragging) map.dragging.enable(); } catch (_) {}
        if (!moved) { g.setAttribute('transform', base); return; }
        const r = svg.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const br = (Math.atan2(ev.clientX - cx, -(ev.clientY - cy)) * 180 / Math.PI + 360) % 360;
        const pos = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(br / 45) % 8];
        try { localStorage.setItem('otemp.dial.pos', pos); } catch (_) {}
        if (typeof windDialUpdate === 'function') windDialUpdate();
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    }, true);
    const KN = 0.514444;
    // [ADD] 써지(파도가 지나갈 때 물이 앞뒤로 흔들리는 세기) 추정: 선형 파랑 이론의 물입자 속도 u = πH/T·e^(-kz), k = ω²/g(깊은 바다 가정)
    //  H = 유의파고, T = 파도 주기. 해안에서 파도가 휘거나 얕아지며 커지는 건 반영 안 됨 → 약함/보통/강함 세 단계로만 표시
    function windDialSurge(v, z) {
      if (!v || v.height == null) return null;
      const T = v.period != null ? v.period : v.swellPeriod;
      if (!(T > 1)) return null;
      const w = 2 * Math.PI / T, k = w * w / 9.81;
      return Math.PI * v.height / T * Math.exp(-k * z);   // m/s
    }
    const surgeLevel = (u, ko) => u == null ? '' : u < 0.12 ? (ko ? '약함' : 'weak') : u < 0.35 ? (ko ? '보통' : 'moderate') : (ko ? '강함' : 'strong');
    // 수심 z(m) 흐름 추정: 수면 흐름 - 바람이 끄는 몫 + (그 몫이 깊이에 따라 줄고 오른쪽으로 도는 만큼, 에크만 나선·감쇠 깊이 10m)
    // [ADD] 태풍·강풍일 때 표층 흐름 보정. 바다 모델(Open-Meteo)은 해상도가 거칠어 강풍이 표면을 미는 힘을 덜 담아요
    //  (예: 바람 49m/s인데 표층 1.6kn). 바람 12m/s 이상이면, 표층 흐름이 "바람 밀림(풍속의 3%, 최대 40m/s 기준)"보다 약할 때
    //  모자란 만큼을 바람 밀림 방향으로 보태요. 보정된 표층에서 5m·30m를 계산해서 깊이별 값도 앞뒤가 맞아요. 추정값이에요.
    function windDialSurfaceFix(c, w, lat) {
      if (!c || !w || w.speed == null || w.dir == null || w.speed < 12) return c;
      const r = Math.PI / 180, sgn = lat >= 0 ? 1 : -1, ds = 0.03 * Math.min(w.speed, 40), d0 = (w.dir + 180 + sgn * 30) * r;
      const ex = Math.sin(d0), ey = Math.cos(d0), u = c.speed * Math.sin(c.to * r), v = c.speed * Math.cos(c.to * r);
      const along = u * ex + v * ey;
      if (along >= ds) return c;
      const add = ds - along, u2 = u + add * ex, v2 = v + add * ey;
      return { ...c, speed: Math.hypot(u2, v2), to: (Math.atan2(u2, v2) / r + 360) % 360, windFix: true };
    }
    function windDialCurrentAt(c, w, lat, z) {
      if (!c) return null;
      const r = Math.PI / 180, D = 10, sgn = lat >= 0 ? 1 : -1;
      let u = c.speed * Math.sin(c.to * r), v = c.speed * Math.cos(c.to * r);
      if (w && w.speed != null && w.dir != null) {
        const ds = 0.03 * w.speed, d0 = (w.dir + 180 + sgn * 30) * r;
        const k = Math.exp(-z / D), dz = d0 + sgn * (z / D);       // 깊을수록 약해지고 더 돌아감
        u += -ds * Math.sin(d0) + ds * k * Math.sin(dz);
        v += -ds * Math.cos(d0) + ds * k * Math.cos(dz);
      }
      return { speed: Math.hypot(u, v), to: (Math.atan2(u, v) / r + 360) % 360 };
    }

    function windDialNearest(arr, x, maxGap) {
      if (!arr || !arr.length) return null;
      let best = null, bd = Infinity;
      for (const p of arr) { const dd = Math.abs(p.x - x); if (dd < bd) { bd = dd; best = p; } }
      return bd <= (maxGap || 3 * 3600e3) ? best : null;
    }
    const windDialDir16 = (deg) => {
      const ko = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
      const en = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      const i = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
      return (typeof lang !== 'undefined' && lang === 'ko') ? ko[i] : en[i];
    };

    function windDialSVG(w, v, timeLabel, cs, c5, c30, tzLabel, vis, cs0, raw) {
      const R = 74, ko = typeof lang !== 'undefined' && lang === 'ko';
      // [CHANGE] 원은 반투명(50%)으로, N·E·S·W 글자는 뺐어요(지도가 북쪽 위 고정이라 불필요)
      let g = `<g opacity="0.5"><circle r="${R}" fill="rgba(2,6,23,0.18)" stroke="rgba(255,255,255,0.55)" stroke-width="1.3"/>` +
        `<circle r="${R * 0.62}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="3 4"/></g>`;
      // [CHANGE] 화살표 길이 = 값에 완전 비례(머리 삼각형은 값이 0이 아니면 항상 같은 크기로 표시, 0이면 화살표 없음)
      //   바람 15 m/s = 60px, 파도 3 m = 60px, 흐름 1 m/s(약 2노트) = 원 반지름 가까이, 써지 0.5 m/s = 양쪽 40px. 넘으면 그 길이에서 멈춤
      const prop = (val, full, px) => Math.min(px, Math.max(0, val) / full * px);
      if (w && w.dir != null && w.speed != null && w.speed > 0.05) {
        const Ls = prop(w.speed, 15, 60), wid = 5, tip = R - 4, base = tip + 14;
        g += `<g transform="rotate(${w.dir.toFixed(0)})" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.7))">` +
          (Ls > 0.5 ? `<line x1="0" y1="${-(base + Ls)}" x2="0" y2="${-base + 2}" stroke="#fbbf24" stroke-width="${wid}" stroke-linecap="round"/>` : '') +
          `<path d="M-10 ${-base} L0 ${-tip} L10 ${-base}Z" fill="#fbbf24"/></g>`;
      }
      const vdir = v ? (v.waveDir != null ? v.waveDir : v.swellDir) : null;
      if (v && v.height != null && v.height > 0.02 && vdir != null) {
        const Ls = prop(v.height, 3, 60), tip = R - 2, base = tip + 13, amp = 5;
        let d = `M0 ${-(base + Ls)}`;
        const n = Math.max(0, Math.floor(Ls / 8));
        for (let k = 0; k < n; k++) d += ` q${k % 2 ? -amp : amp} 4 0 8`;
        if (Ls - n * 8 > 0.5) d += ` L0 ${-base}`;
        g += `<g transform="rotate(${vdir.toFixed(0)})" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.7))">` +
          (Ls > 0.5 ? `<path d="${d}" fill="none" stroke="#7dd3fc" stroke-width="3.5" stroke-linecap="round"/>` : '') +
          `<path d="M-9 ${-base} L0 ${-tip} L9 ${-base}Z" fill="#7dd3fc"/></g>`;
      }
      // 흐름: 정점에서 바깥으로(흘러가는 쪽)
      const flow = (c, color, wid, dashed, tipR, hollow) => {
        // [CHANGE] 머리 끝은 원 위(흘러가는 쪽), 꼬리는 정점 쪽. 약할 때도 구분되게 수면·5m·30m 머리를 원에서 조금씩 안쪽으로 엇갈리고
        //  모양도 다르게(수면 = 속 빈 연두 삼각형, 5m = 초록, 30m = 검은빛 초록)
        if (!c || c.speed == null || c.to == null || c.speed < 0.005) return '';
        const tip = tipR, hb = tip - 12, Ls = prop(c.speed, 1.0, Math.max(10, hb - 10));
        return `<g transform="rotate(${c.to.toFixed(0)})" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.8))">` +
          (Ls > 0.5 ? `<line x1="0" y1="${-(hb - Ls)}" x2="0" y2="${-hb}" stroke="${color}" stroke-width="${wid}" stroke-linecap="round"${dashed ? ' stroke-dasharray="5 4"' : ''}/>` : '') +
          `<path d="M-8 ${-hb} L0 ${-tip} L8 ${-hb}Z" fill="${hollow ? 'rgba(7,11,20,.6)' : color}" stroke="${hollow ? color : 'none'}" stroke-width="${hollow ? 2 : 0}" stroke-linejoin="round"/></g>`;
      };
      // [ADD] 써지: 파도 축을 따라 앞뒤로 흔들림 → 정점 중심 양쪽 화살표(수심 5m 세기로 길이)
      if (v && vdir != null) {
        const u5 = windDialSurge(v, 5);
        if (u5 != null && u5 > 0.005) {
          const L = prop(u5, 0.5, 40), sw = 2.5;
          g += `<g transform="rotate(${vdir.toFixed(0)})" opacity="0.95" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.7))">` +
            (L > 0.5 ? `<line x1="0" y1="${-L}" x2="0" y2="${L}" stroke="#bae6fd" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="2 3"/>` : '') +
            `<path d="M-6 ${-L} L0 ${-L - 10} L6 ${-L}Z" fill="#bae6fd"/><path d="M-6 ${L} L0 ${L + 10} L6 ${L}Z" fill="#bae6fd"/></g>`;
        }
      }
      g += flow(cs, '#d9f99d', 3, true, R, false) + flow(c5, '#86d65e', 4, false, R - 13, false) + flow(c30, '#22c55e', 5, false, R - 26, false); // 표층 형광연두(속 찬, 테두리 없음) · 5m 중간 연두 · 30m 밝은 초록 // 깊은 것이 위에 그려져 머리가 가려지지 않게
      // [CHANGE] 정보 상자 한 칸 정리: 위 "지금" 알약 + 현지시각, 흐름(표층·5m·30m 노트), 바람·파도·써지·시야 표. 끌어서 8방향 중 한 곳에 붙여요
      const isNowLbl = /^(지금|Now)$/.test(timeLabel), fv = (x) => x >= 29.95 ? '30+' : x < 10 ? x.toFixed(1) : Math.round(x);
      // 3열 표(모두 왼쪽 정렬): 1열 이름/표층, 2열 5m·값, 3열 30m·설명. 각 열의 글자 시작 x가 위아래로 같아요
      const BW = 272, X1 = 32, X2 = 106, X3 = 194; let y = 0, rows = '';
      const tw = Math.max(64, timeLabel.length * 9 + 22), tcol = isNowLbl ? '#FFB000' : '#4ade80';
      rows += `<rect x="8" y="8" width="${tw}" height="26" rx="13" fill="rgba(7,11,20,0.95)" stroke="${tcol}" stroke-width="1.8"/><text x="${8 + tw / 2}" y="26" font-size="14" fill="#fff" font-weight="800" text-anchor="middle">${timeLabel}</text>`
        + (tzLabel ? `<text x="${8 + tw + 8}" y="27" font-size="11" fill="#94a3b8">${tzLabel}</text>` : '');
      y = 40;
      if (cs) {
        const kn = (c) => (c.speed / KN).toFixed(1);
        const cols = [[ko ? '표층' : 'Surf', '#d9f99d', cs, X1]].concat(c5 ? [['5m', '#86d65e', c5, X2], ['30m', '#22c55e', c30, X3]] : []);
        const rc = raw ? [raw.s, raw.c5, raw.c30] : null, bh = raw ? 86 : 64;
        rows += `<rect x="8" y="${y + 4}" width="18" height="${bh - 8}" rx="4" fill="rgba(74,222,128,.12)"/><text transform="translate(${8 + 13} ${y + bh / 2}) rotate(-90)" font-size="11" fill="#4ade80" font-weight="800" text-anchor="middle">${ko ? '흐름' : 'Current'}</text>`;
        cols.forEach((c, k) => { const cx = c[3];
          rows += `<text x="${cx}" y="${y + 18}" font-size="12.5" fill="${c[1]}" font-weight="800">${c[0]}</text>`
            + `<text x="${cx}" y="${y + 42}" font-size="16" fill="#fff" font-weight="800">${kn(c[2])}</text><text x="${cx + 4 + String(kn(c[2])).length * 8.8}" y="${y + 42}" font-size="10.5" fill="#94a3b8">kn</text>`
            + `<text x="${cx}" y="${y + 57}" font-size="10.5" fill="#94a3b8">${c[2].speed.toFixed(2)} m/s</text>`
            + (rc && rc[k] ? `<text x="${cx}" y="${y + 74}" font-size="12" fill="#94a3b8" font-weight="700">${kn(rc[k])}</text>${rc[k].to != null ? `<g transform="translate(${cx + 12 + String(kn(rc[k])).length * 7.2} ${y + 70}) rotate(${Math.round(rc[k].to)})"><path d="M0,-7 L5,5 L0,2 L-5,5 Z" fill="#cbd5e1"/></g>` : ''}${k === cols.length - 1 ? `<text x="${cx + 26 + String(kn(rc[k])).length * 7.2}" y="${y + 74}" font-size="10" fill="#94a3b8">${ko ? '원값' : 'raw'}</text>` : ''}` : ''); });
        y += bh;
      }
      // [ADD] fromDeg: 불어오는/들어오는 방향(도). 있으면 셋째 열 앞에 "가는 쪽" 화살표(실시간 표의 Dir 화살표와 같은 기준)
      const tr = (color, name, big, unit, rest, fromDeg) => { y += 21; rows += `<text x="${X1}" y="${y}" font-size="12.5" fill="${color}" font-weight="800">${name}</text>`
        + (big != null ? `<text x="${X2}" y="${y}" font-size="14" fill="#fff" font-weight="800">${big}</text><text x="${X2 + 4 + String(big).length * 8.6}" y="${y}" font-size="11" fill="#cbd5e1">${unit}</text>` : '')
        + (fromDeg != null ? `<g transform="translate(${X3 + 5} ${y - 4}) rotate(${Math.round((fromDeg + 180) % 360)})"><path d="M0,-6.5 L4.5,4.5 L0,2 L-4.5,4.5 Z" fill="${color}"/></g>` : '')
        + (rest ? `<text x="${X3 + (fromDeg != null ? 14 : 0)}" y="${y}" font-size="12" fill="#cbd5e1">${rest}</text>` : ''); };
      if (w && w.speed != null) tr('#fbbf24', ko ? '바람' : 'Wind', Math.round(w.speed), 'm/s', `${w.gust != null ? (ko ? '돌풍 ' : 'gust ') + Math.round(w.gust) : ''}`, w.dir); // 방향은 화살표로만
      if (v && v.height != null) {
        // 주기(초)는 파고가 0.1m 이상일 때만 - 파도가 없는데 "2초"만 남으면 뜻이 헷갈려요
        tr('#7dd3fc', ko ? '파도' : 'Waves', v.height.toFixed(1), 'm', `${v.swellPeriod != null && v.height >= 0.1 ? `${Math.round(v.swellPeriod)}${ko ? '초' : 's'}` : ''}`, v.height >= 0.1 ? vdir : null); // 방향은 화살표로만, 파고 0.1m 미만이면 방향·주기 없음
        const s5 = windDialSurge(v, 5);
        if (s5 != null) { y += 21; rows += `<text x="${X1}" y="${y}" font-size="12.5" fill="#7dd3fc" font-weight="800">${ko ? '써지' : 'Surge'}↕</text><text x="${X2}" y="${y}" font-size="12" fill="#fff" font-weight="700">${surgeLevel(s5, ko)}</text>`; }
      }
      if (vis) tr('#7dd3fc', ko ? '시야' : 'Vis', fv(vis.vis), 'm', vis.lo != null ? `${fv(vis.lo)}–${fv(vis.hi)} m` : '');
      let labels = '';
      // [ADD] 상자 위치: 원 둘레 8방향(E·W·N·S·NE·NW·SE·SW) 중 한 곳. 상자를 끌어다 놓으면 가장 가까운 방향으로 붙어요(브라우저에 기억)
      const BH = y + 12, pos = windDialPos(), gap = 22;
      const PX = { E: [R + gap, -R - 30], W: [-R - gap - BW, -R - 30], N: [-BW / 2, -R - gap - BH], S: [-BW / 2, R + gap],
        NE: [R + 8, -R - 8 - BH], NW: [-R - 8 - BW, -R - 8 - BH], SE: [R + 8, R + 8], SW: [-R - 8 - BW, R + 8] }[pos] || [R + gap, -R - 30];
      labels += `<g data-dial-drag="1" style="pointer-events:auto;cursor:move;touch-action:none" transform="translate(${PX[0]} ${PX[1]})"><rect x="0" y="0" width="${BW}" height="${BH}" rx="10" fill="rgba(7,11,20,0.88)" stroke="rgba(255,255,255,0.16)"/>${rows}</g>`;
      const W = 2 * (R + gap + BW + 10), H = 2 * (R + gap + BH + 10); windDialLastSize = [W, H];
      return `<svg width="${W}" height="${H}" viewBox="${-W / 2} ${-H / 2} ${W} ${H}" style="overflow:visible;pointer-events:none">${g}${labels}</svg>`;
    }

    function windDialUpdate() {
      const st = typeof selectedStation !== 'undefined' ? selectedStation : null;
      const map = typeof leafletMap !== 'undefined' ? leafletMap : null;
      const d = st && st._hourlyCache;
      const show = map && typeof isDetailMode !== 'undefined' && isDetailMode && d && (d.wind.length || d.waves.length || (d.current || []).length);
      if (!show) { if (windDialMarker && map) { map.removeLayer(windDialMarker); } windDialMarker = null; if (window.currentTerrainField) currentTerrainField(null, null); return; }
      const x = windDialX != null && windDialX >= d.from - 3600e3 && windDialX <= d.to + 3600e3 ? windDialX : d.nowLocalMs;
      const w = windDialNearest(d.wind, x), v = windDialNearest(d.waves, x);
      const cs0 = windDialSurfaceFix(windDialNearest(d.current, x), w, st.coords[1]);
      let cs = cs0, c5 = windDialCurrentAt(cs0, w, st.coords[1], 5), c30 = windDialCurrentAt(cs0, w, st.coords[1], 30);
      // [ADD] 섬 주변 지형 반영(js/current-terrain.js): 정점 자리 흐름을 다시 계산 + 지도에 섬 둘레 흐름 화살표
      if (window.currentTerrainAdjust) { c5 = currentTerrainAdjust(st, c5); c30 = currentTerrainAdjust(st, c30); cs = currentTerrainAdjust(st, cs0); }
      if (window.currentTerrainField) currentTerrainField(st, cs0);
      const isNow = Math.abs(x - d.nowLocalMs) < 1.5 * 3600e3;
      const dt = new Date(x), ko = typeof lang !== 'undefined' && lang === 'ko';
      const timeLabel = isNow ? (ko ? '지금' : 'Now') : `${dt.getUTCMonth() + 1}/${dt.getUTCDate()} ${String(dt.getUTCHours()).padStart(2, '0')}:00`;
      // [ADD] 표·나침반 시각은 그 포인트의 현지 시각 - 다른 나라에서 볼 때 헷갈리지 않게 표시
      const offH = Math.round((d.nowLocalMs - Date.now()) / 900e3) / 4;
      const tzLabel = `${ko ? '현지 시각' : 'local time'} UTC${offH >= 0 ? '+' : '−'}${Math.abs(offH)}`;
      // [ADD] 그 시각(날짜)의 시야 추정 + 범위 (앱 시야 계산의 projection, 하루 단위)
      let vis = null;
      const vc = st._visCache;
      if (vc && vc.projection && vc.projection.length) {
        const off = d.nowLocalMs - Date.now();
        let best = null, bd = Infinity;
        vc.projection.forEach(p => { const dd = Math.abs(p.t + off - x); if (dd < bd) { bd = dd; best = p; } });
        if (best && bd <= 36 * 3600e3) vis = isNow && vc.now ? vc.now : best;
      }
      // [ADD] 관리자: 해협 보정 전 모델 원값(표층·5m·30m)도 같은 크기로 아래 줄에
      let raw = null; try { const u = window.otAccount && window.otAccount.user && window.otAccount.user();
        if (u && u.role === 'admin' && cs0 && cs0.bg) raw = { s: cs0.bg, c5: windDialCurrentAt(cs0.bg, w, st.coords[1], 5), c30: windDialCurrentAt(cs0.bg, w, st.coords[1], 30) }; } catch (_) {}
      const html = windDialSVG(w, v, timeLabel, cs, c5, c30, tzLabel, vis, cs0, raw);
      const size = windDialLastSize || [2 * (74 + 200), 2 * (74 + 70)];
      const icon = L.divIcon({ className: 'wind-dial', html, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
      const ll = [st.coords[1], st.coords[0]];
      // [CHANGE] 나침반·바람·파도·흐름 상자를 포인트 이름표보다 위 층(전용 층, 누르기는 아래로 통과)에 - 이름표에 Surge 글자가 가려지던 문제
      if (!map.getPane('windDialPane')) { const pn = map.createPane('windDialPane'); pn.style.zIndex = 640; pn.style.pointerEvents = 'none'; }
      if (!windDialMarker) windDialMarker = L.marker(ll, { icon, interactive: false, keyboard: false, pane: 'windDialPane' }).addTo(map);
      else { windDialMarker.setLatLng(ll); windDialMarker.setIcon(icon); }
    }
    // 표에서 부름: 표 가운데 칸의 시각(현지 시각을 UTC처럼 쓴 ms)
    function windDialSetTime(x) {
      windDialX = x;
      if (windDialRaf) return;
      windDialRaf = requestAnimationFrame(() => { windDialRaf = 0; windDialUpdate(); });
    }

    // 상세 지도 들어가기/나가기, 정점 바꾸기 때도 다시 그리기
    (function hookDial() {
      const wrap = (name, after) => {
        const f = window[name];
        if (typeof f !== 'function') return;
        window[name] = function () { const r = f.apply(this, arguments); try { after(); } catch (_) {} return r; };
      };
      wrap('showDetailMap', () => setTimeout(windDialUpdate, 60));
      wrap('switchToGlobe', () => windDialUpdate());
      wrap('selectStation', () => { windDialX = null; setTimeout(windDialUpdate, 60); });
    })();
