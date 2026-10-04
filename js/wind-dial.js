    // [ADD] 바람·파도 나침반 - 상세 지도(줌인)에서 정점을 고르면 그 점 둘레에 원을 그리고
    //   노란 화살표 = 바람(불어오는 쪽 → 정점, 길이·굵기 = 세기), 하늘색 물결 = 파도(들어오는 쪽 → 정점, 크기 = 파고)
    //   아래 실시간 현황 표를 좌우로 넘기면 표 가운데 시각의 값으로 바뀌어요(windDialSetTime).
    //   방향은 기상 관례대로 "오는 방향"(Open-Meteo wind_direction_10m, wave_direction, 관측소 풍향 모두 같은 기준).
    let windDialMarker = null, windDialX = null, windDialRaf = 0;

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

    function windDialSVG(w, v, timeLabel) {
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
        const amp = 3 + s * 6, sw = 2.5 + s * 3, top = R - 4, bot = 22;
        let d = `M0 ${-top}`;
        for (let y = -top, k = 0; y < -bot - 6; y += 8, k++) d += ` q${k % 2 ? -amp : amp} 4 0 8`;
        g += `<g transform="rotate(${vdir.toFixed(0)})" style="filter:drop-shadow(0 0 2px rgba(0,0,0,.7))">` +
          `<path d="${d}" fill="none" stroke="#7dd3fc" stroke-width="${sw.toFixed(1)}" stroke-linecap="round"/>` +
          `<path d="M${-(sw + 5)} ${-bot - 8} L0 ${-bot + 6} L${sw + 5} ${-bot - 8}Z" fill="#7dd3fc"/></g>`;
      }
      const box = (x, y, color, title, big, unit, small) => `<g transform="translate(${x} ${y})">` +
        `<rect x="0" y="0" width="104" height="40" rx="9" fill="rgba(7,11,20,0.86)" stroke="rgba(255,255,255,0.16)"/>` +
        `<text x="9" y="17" font-size="11" fill="${color}" font-weight="700">${title} <tspan fill="#fff" font-size="15">${big}</tspan><tspan fill="#cbd5e1" font-size="10"> ${unit}</tspan></text>` +
        `<text x="9" y="32" font-size="10" fill="#cbd5e1">${small}</text></g>`;
      let labels = '';
      if (w && w.speed != null) labels += box(R + 22, -R - 30, '#fbbf24', ko ? '바람' : 'Wind', Math.round(w.speed), 'm/s',
        `${w.dir != null ? windDialDir16(w.dir) + (ko ? '풍' : '') : ''}${w.gust != null ? (ko ? ' · 돌풍 ' : ' · gust ') + Math.round(w.gust) : ''}`);
      if (v && v.height != null) labels += box(R + 22, R - 10, '#7dd3fc', ko ? '파도' : 'Waves', v.height.toFixed(1), 'm',
        `${vdir != null ? windDialDir16(vdir) + (ko ? '쪽' : '') : ''}${v.swellPeriod != null ? ` · ${Math.round(v.swellPeriod)}${ko ? '초' : 's'}` : ''}`);
      labels += `<text x="0" y="${R + 30}" font-size="10.5" fill="#fff" font-weight="700" text-anchor="middle" style="paint-order:stroke;stroke:rgba(0,0,0,.75);stroke-width:3px">${timeLabel}</text>`;
      const W = 2 * (R + 140), H = 2 * (R + 60);
      return `<svg width="${W}" height="${H}" viewBox="${-W / 2} ${-H / 2} ${W} ${H}" style="overflow:visible;pointer-events:none">${g}${labels}</svg>`;
    }

    function windDialUpdate() {
      const st = typeof selectedStation !== 'undefined' ? selectedStation : null;
      const map = typeof leafletMap !== 'undefined' ? leafletMap : null;
      const d = st && st._hourlyCache;
      const show = map && typeof isDetailMode !== 'undefined' && isDetailMode && d && (d.wind.length || d.waves.length);
      if (!show) { if (windDialMarker && map) { map.removeLayer(windDialMarker); } windDialMarker = null; return; }
      const x = windDialX != null && windDialX >= d.from - 3600e3 && windDialX <= d.to + 3600e3 ? windDialX : d.nowLocalMs;
      const w = windDialNearest(d.wind, x), v = windDialNearest(d.waves, x);
      const isNow = Math.abs(x - d.nowLocalMs) < 1.5 * 3600e3;
      const dt = new Date(x), ko = typeof lang !== 'undefined' && lang === 'ko';
      const timeLabel = isNow ? (ko ? '지금' : 'Now') : `${dt.getUTCMonth() + 1}/${dt.getUTCDate()} ${String(dt.getUTCHours()).padStart(2, '0')}:00`;
      const html = windDialSVG(w, v, timeLabel);
      const size = [2 * (74 + 140), 2 * (74 + 60)];
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
