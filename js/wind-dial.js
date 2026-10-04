    // [ADD] 바람·파도 나침반 - 상세 지도(줌인)에서 정점을 고르면 그 점 둘레에 원을 그리고
    //   노란 화살표 = 바람(불어오는 쪽 → 정점, 길이·굵기 = 세기), 하늘색 물결 = 파도(들어오는 쪽 → 정점, 크기 = 파고)
    //   아래 실시간 현황 표를 좌우로 넘기면 표 가운데 시각의 값으로 바뀌어요(windDialSetTime).
    //   방향은 기상 관례대로 "오는 방향"(Open-Meteo wind_direction_10m, wave_direction, 관측소 풍향 모두 같은 기준).
    //   [ADD] 초록 화살표 = 흐름(정점에서 "흘러가는 쪽"으로). 점선 = 수면 흐름(Copernicus 표층 합성 해류: 조류+해류+바람·파도가 미는 흐름),
    //   실선 = 수심 5m(안전정지, 바람 영향 남음)·30m(거의 조류) 흐름 추정 = 수면 흐름에서 바람이 끄는 몫(바람의 약 3%, 북반구는 바람 방향에서 오른쪽 30°)을 깊이에 따라 줄인 값.
    //   모델 격자가 약 8km라 섬·곶 주변의 국지 흐름(지형 영향)은 반영되지 않아요.
    let windDialMarker = null, windDialX = null, windDialRaf = 0;
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

    function windDialSVG(w, v, timeLabel, cs, c5, c30, tzLabel) {
      const R = 74, ko = typeof lang !== 'undefined' && lang === 'ko';
      let g = `<circle r="${R}" fill="rgba(2,6,23,0.18)" stroke="rgba(255,255,255,0.55)" stroke-width="1.3"/>` +
        `<circle r="${R * 0.62}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="3 4"/>` +
        `<g fill="#e2e8f0" font-size="10" font-weight="700" text-anchor="middle" style="paint-order:stroke;stroke:rgba(0,0,0,.6);stroke-width:2.5px">` +
        `<text y="${-R - 5}">N</text><text x="${R + 9}" y="4">E</text><text y="${R + 13}">S</text><text x="${-R - 9}" y="4">W</text></g>`;
      if (w && w.dir != null && w.speed != null) {
        const s = Math.max(0, Math.min(1, w.speed / 15));           // 0~15 m/s
        const len = 26 + s * 40, wid = 3 + s * 6, start = R + 46, end = start - len;
        g += `<g transform="rotate(${w.dir.toFixed(0)})" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.7))">` +
          `<line x1="0" y1="${-start}" x2="0" y2="${-end - 6}" stroke="#fbbf24" stroke-width="${wid.toFixed(1)}" stroke-linecap="round"/>` +
          `<path d="M${-(wid + 6)} ${-end - 8} L0 ${-end + 8} L${wid + 6} ${-end - 8}Z" fill="#fbbf24"/></g>`;
      }
      const vdir = v ? (v.waveDir != null ? v.waveDir : v.swellDir) : null;
      if (v && v.height != null && vdir != null) {
        const s = Math.max(0, Math.min(1, v.height / 3));           // 0~3 m
        const amp = 3 + s * 6, sw = 2.5 + s * 3, top = R + 46, bot = top - (34 + s * 40); // [CHANGE] 바람처럼 원 밖에서 들어오게
        let d = `M0 ${-top}`;
        for (let y = -top, k = 0; y < -bot - 6; y += 8, k++) d += ` q${k % 2 ? -amp : amp} 4 0 8`;
        g += `<g transform="rotate(${vdir.toFixed(0)})" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.7))">` +
          `<path d="${d}" fill="none" stroke="#7dd3fc" stroke-width="${sw.toFixed(1)}" stroke-linecap="round"/>` +
          `<path d="M${-(sw + 5)} ${-bot - 8} L0 ${-bot + 6} L${sw + 5} ${-bot - 8}Z" fill="#7dd3fc"/></g>`;
      }
      // 흐름: 정점에서 바깥으로(흘러가는 쪽)
      const flow = (c, color, wid, dashed) => {
        if (!c || c.speed == null || c.to == null) return '';
        const s = Math.max(0, Math.min(1, c.speed / 1.0)), len = 16 + s * 44;
        return `<g transform="rotate(${c.to.toFixed(0)})" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.7))">` +
          `<line x1="0" y1="-9" x2="0" y2="${-9 - len}" stroke="${color}" stroke-width="${wid}" stroke-linecap="round"${dashed ? ' stroke-dasharray="5 4"' : ''}/>` +
          `<path d="M${-(wid + 4)} ${-9 - len + 2} L0 ${-9 - len - 10} L${wid + 4} ${-9 - len + 2}Z" fill="${color}"/></g>`;
      };
      // [ADD] 써지: 파도 축을 따라 앞뒤로 흔들림 → 정점 중심 양쪽 화살표(수심 5m 세기로 길이)
      if (v && vdir != null) {
        const u5 = windDialSurge(v, 5);
        if (u5 != null) {
          const L = 12 + Math.min(1, u5 / 0.5) * 34, sw = 2.5;
          g += `<g transform="rotate(${vdir.toFixed(0)})" opacity="0.95" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.7))">` +
            `<line x1="0" y1="${-L + 6}" x2="0" y2="${L - 6}" stroke="#bae6fd" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="2 3"/>` +
            `<path d="M-6 ${-L + 8} L0 ${-L - 2} L6 ${-L + 8}Z" fill="#bae6fd"/><path d="M-6 ${L - 8} L0 ${L + 2} L6 ${L - 8}Z" fill="#bae6fd"/></g>`;
        }
      }
      g += flow(c30, '#15803d', 5, false) + flow(c5, '#4ade80', 4, false) + flow(cs, '#d9f99d', 3, true);
      const box = (x, y, color, title, big, unit, small, hgt) => `<g transform="translate(${x} ${y})">` +
        `<rect x="0" y="0" width="${hgt ? 166 : 104}" height="${hgt || 40}" rx="9" fill="rgba(7,11,20,0.86)" stroke="rgba(255,255,255,0.16)"/>` +
        `<text x="9" y="17" font-size="11" fill="${color}" font-weight="700">${title} <tspan fill="#fff" font-size="15">${big}</tspan><tspan fill="#cbd5e1" font-size="10"> ${unit}</tspan></text>` +
        `<text x="9" y="32" font-size="10" fill="#cbd5e1">${small}</text></g>`;
      let labels = '';
      if (w && w.speed != null) labels += box(R + 22, -R - 30, '#fbbf24', ko ? '바람' : 'Wind', Math.round(w.speed), 'm/s',
        `${w.dir != null ? windDialDir16(w.dir) + (ko ? '풍' : '') : ''}${w.gust != null ? (ko ? ' · 돌풍 ' : ' · gust ') + Math.round(w.gust) : ''}`);
      if (v && v.height != null) {
        labels += box(R + 22, R - 10, '#7dd3fc', ko ? '파도' : 'Waves', v.height.toFixed(1), 'm',
          `${vdir != null ? windDialDir16(vdir) + (ko ? '쪽' : '') : ''}${v.swellPeriod != null ? ` · ${Math.round(v.swellPeriod)}${ko ? '초' : 's'}` : ''}`, 56);
        const s5 = windDialSurge(v, 5), s30 = windDialSurge(v, 30);
        if (s5 != null) labels += `<text x="${R + 31}" y="${R + 36}" font-size="10" fill="#7dd3fc"><tspan font-weight="700">↕ ${ko ? '써지' : 'Surge'}</tspan> 5m <tspan fill="#fff" font-weight="700">${surgeLevel(s5, ko)}</tspan> · 30m <tspan fill="#fff" font-weight="700">${surgeLevel(s30, ko)}</tspan></text>`;
      }
      if (cs) {
        const kn = (c) => (c.speed / KN).toFixed(1), dirTo = (c) => windDialDir16(c.to);
        const line = (y, color, name, c) => `<text x="9" y="${y}" font-size="10.5" fill="${color}"><tspan font-weight="700">${name}</tspan> <tspan fill="#fff" font-weight="700">${kn(c)}</tspan>${ko ? '노트' : 'kn'} → ${dirTo(c)}</text>`;
        labels += `<g transform="translate(${-R - 168} ${-44})"><rect x="0" y="0" width="146" height="${c5 ? 78 : 40}" rx="9" fill="rgba(7,11,20,0.86)" stroke="rgba(255,255,255,0.16)"/>` +
          `<text x="9" y="15" font-size="11" fill="#4ade80" font-weight="800">${ko ? '흐름' : 'Current'}</text>` +
          line(31, '#d9f99d', ko ? '수면' : 'Surface', cs) +
          (c5 ? line(46, '#4ade80', ko ? '수심 5m' : '5 m', c5) + line(61, '#22c55e', ko ? '수심 30m' : '30 m', c30) +
            `<text x="9" y="73" font-size="8.5" fill="#94a3b8">${ko ? '추정 · 지형 영향 미반영' : 'estimate · no local terrain'}</text>` : '') + `</g>`;
      }
      // [CHANGE] 시각을 잘 보이게: 원 아래 진한 알약 모양
      const tw = Math.max(64, timeLabel.length * 9 + 22), isNowLbl = /^(지금|Now)$/.test(timeLabel);
      labels += `<g transform="translate(0 ${R + 34})"><rect x="${-tw / 2}" y="-14" width="${tw}" height="26" rx="13" fill="rgba(7,11,20,0.92)" stroke="${isNowLbl ? '#FFB000' : '#4ade80'}" stroke-width="1.5"/>` +
        `<text x="0" y="4" font-size="13" fill="#fff" font-weight="800" text-anchor="middle">${timeLabel}</text>` +
        (tzLabel ? `<text x="0" y="27" font-size="9.5" fill="#cbd5e1" text-anchor="middle" style="paint-order:stroke;stroke:rgba(0,0,0,.75);stroke-width:3px">${tzLabel}</text>` : '') + `</g>`;
      const W = 2 * (R + 192), H = 2 * (R + 70);
      return `<svg width="${W}" height="${H}" viewBox="${-W / 2} ${-H / 2} ${W} ${H}" style="overflow:visible;pointer-events:none">${g}${labels}</svg>`;
    }

    function windDialUpdate() {
      const st = typeof selectedStation !== 'undefined' ? selectedStation : null;
      const map = typeof leafletMap !== 'undefined' ? leafletMap : null;
      const d = st && st._hourlyCache;
      const show = map && typeof isDetailMode !== 'undefined' && isDetailMode && d && (d.wind.length || d.waves.length || (d.current || []).length);
      if (!show) { if (windDialMarker && map) { map.removeLayer(windDialMarker); } windDialMarker = null; return; }
      const x = windDialX != null && windDialX >= d.from - 3600e3 && windDialX <= d.to + 3600e3 ? windDialX : d.nowLocalMs;
      const w = windDialNearest(d.wind, x), v = windDialNearest(d.waves, x);
      const cs = windDialNearest(d.current, x), c5 = windDialCurrentAt(cs, w, st.coords[1], 5), c30 = windDialCurrentAt(cs, w, st.coords[1], 30);
      const isNow = Math.abs(x - d.nowLocalMs) < 1.5 * 3600e3;
      const dt = new Date(x), ko = typeof lang !== 'undefined' && lang === 'ko';
      const timeLabel = isNow ? (ko ? '지금' : 'Now') : `${dt.getUTCMonth() + 1}/${dt.getUTCDate()} ${String(dt.getUTCHours()).padStart(2, '0')}:00`;
      // [ADD] 표·나침반 시각은 그 포인트의 현지 시각 - 다른 나라에서 볼 때 헷갈리지 않게 표시
      const offH = Math.round((d.nowLocalMs - Date.now()) / 900e3) / 4;
      const tzLabel = `${ko ? '현지 시각' : 'local time'} UTC${offH >= 0 ? '+' : '−'}${Math.abs(offH)}`;
      const html = windDialSVG(w, v, timeLabel, cs, c5, c30, tzLabel);
      const size = [2 * (74 + 192), 2 * (74 + 70)];
      const icon = L.divIcon({ className: 'wind-dial', html, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
      const ll = [st.coords[1], st.coords[0]];
      if (!windDialMarker) windDialMarker = L.marker(ll, { icon, interactive: false, keyboard: false, zIndexOffset: -1000 }).addTo(map);
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
