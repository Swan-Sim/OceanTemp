    // [ADD] 종목 신호(기본 = 스쿠버 다이빙) - 포인트 테두리 색으로 가능(초록)·비추천(노랑)·불가(빨강)
    //  - 왼쪽 아래 셀렉트 박스로 종목 고르기: 스쿠버 다이빙 · 카약·SUP · 바람 스포츠(윈드서핑·카이트·윙) · 서핑 · 조정
    //  - 셀렉트 박스를 열 때만 종목마다 신호등 + 상황 설명(고른 포인트 기준, 없으면 화면 안 포인트 개수)
    //  - 시각: 실시간 표에서 고른 칸 시각(없으면 지금)
    //  - 자료: Open-Meteo 바람(forecast)·파도/조류(marine)를 화면에 보이는 포인트 여러 곳 한 번에(최대 50곳씩). 1시간 동안 다시 안 받음
    //  - 오프쇼어(육지에서 부는 바람) 판단은 바다 쪽 방향을 아는 포인트만(관리자 입력값, 고른 포인트는 해안선으로 자동)
    (function () {
      const KN = 1.94384;
      const ORDER = ['dive', 'paddle', 'wind', 'surf', 'row'];
      const NAME = {
        ko: { dive: '스쿠버 다이빙', paddle: '카약·SUP', wind: '바람 스포츠', windSub: '윈드서핑·카이트·윙', surf: '서핑', row: '조정', good: '가능', ok: '비추천', no: '불가', loading: '날씨 불러오는 중…', none: '자료 없음', visible: (g, o, n) => `화면 안 포인트: 가능 ${g} · 비추천 ${o} · 불가 ${n}`, now: '지금' },
        en: { dive: 'Scuba diving', paddle: 'Kayak · SUP', wind: 'Wind sports', windSub: 'Windsurf · Kite · Wing', surf: 'Surfing', row: 'Rowing', good: 'Go', ok: 'Caution', no: 'No-go', loading: 'Loading weather…', none: 'No data', visible: (g, o, n) => `On screen: go ${g} · caution ${o} · no-go ${n}`, now: 'Now' },
        ja: { dive: 'スキューバ', paddle: 'カヤック・SUP', wind: '風のスポーツ', windSub: 'ウィンド・カイト・ウイング', surf: 'サーフィン', row: 'ボート(漕艇)', good: '可', ok: '注意', no: '不可', loading: '天気を読み込み中…', none: 'データなし', visible: (g, o, n) => `画面内: 可 ${g} · 注意 ${o} · 不可 ${n}`, now: '今' }
      };
      const T = () => NAME[typeof lang !== 'undefined' && NAME[lang] ? lang : 'en'];
      let sport = (() => { try { const v = localStorage.getItem('otemp.sport'); return ORDER.includes(v) ? v : 'dive'; } catch (_) { return 'dive'; } })();

      // ── 판단 기준(일반적인 초중급 기준). c = { w 풍속 m/s, g 돌풍, d 풍향(불어오는 쪽), h 파고 m, p 주기 s, cur 조류 kn } ──
      function side(dir, face) {
        if (face == null || dir == null) return null;
        const d = Math.abs(((dir - face + 540) % 360) - 180);
        return d <= 45 ? 'on' : d <= 110 ? 'side' : d <= 140 ? 'side-off' : 'off';
      }
      function rate(sp, c, face) {
        const ko = typeof lang === 'undefined' || lang === 'ko';
        const kn = c.w * KN, h = c.h, s = side(c.d, face), H = (x) => x == null ? '–' : x.toFixed(1) + 'm';
        const tx = (k, e) => ko ? k : e;
        if (sp === 'dive') {
          if ((h != null && h >= 2) || kn >= 25) return ['no', tx(`파고 ${H(h)} · 바람 ${kn.toFixed(0)}kn`, `waves ${H(h)} · wind ${kn.toFixed(0)}kn`)];
          if ((h != null && h >= 1.2) || kn >= 16 || (c.cur != null && c.cur >= 1)) return ['ok', h != null && h >= 1.2 ? tx(`파고 ${H(h)}`, `waves ${H(h)}`) : kn >= 16 ? tx(`바람 ${kn.toFixed(0)}kn`, `wind ${kn.toFixed(0)}kn`) : tx(`조류 ${c.cur.toFixed(1)}kn`, `current ${c.cur.toFixed(1)}kn`)];
          return ['good', tx(`파고 ${H(h)} · 바람 ${kn.toFixed(0)}kn`, `waves ${H(h)} · wind ${kn.toFixed(0)}kn`)];
        }
        if (sp === 'paddle') {
          const hh = h || 0;
          if (s === 'off' && kn >= 8) return ['no', tx(`육지에서 부는 바람 ${kn.toFixed(0)}kn (바다로 떠밀림)`, `offshore wind ${kn.toFixed(0)}kn (drift risk)`)];
          if (kn <= 8 && hh <= 0.5) return ['good', tx(`바람 ${kn.toFixed(0)}kn · 물결 ${H(h)}`, `wind ${kn.toFixed(0)}kn · waves ${H(h)}`)];
          if (kn <= 12 && hh <= 0.9) return ['ok', tx(`바람 ${kn.toFixed(0)}kn · 물결 ${H(h)}`, `wind ${kn.toFixed(0)}kn · waves ${H(h)}`)];
          return ['no', tx(`바람 ${kn.toFixed(0)}kn · 파고 ${H(h)}`, `wind ${kn.toFixed(0)}kn · waves ${H(h)}`)];
        }
        if (sp === 'row') {
          const hh = h || 0;
          if (kn <= 7 && hh <= 0.3) return ['good', tx(`바람 ${kn.toFixed(0)}kn · 물결 ${H(h)}`, `wind ${kn.toFixed(0)}kn · chop ${H(h)}`)];
          if (kn <= 11 && hh <= 0.6) return ['ok', tx(`바람 ${kn.toFixed(0)}kn · 물결 ${H(h)}`, `wind ${kn.toFixed(0)}kn · chop ${H(h)}`)];
          return ['no', tx(`바람 ${kn.toFixed(0)}kn · 물결 ${H(h)}`, `wind ${kn.toFixed(0)}kn · chop ${H(h)}`)];
        }
        if (sp === 'wind') {
          if (s === 'off' && kn >= 11) return ['no', tx(`육지에서 부는 바람 ${kn.toFixed(0)}kn (오프쇼어 위험)`, `offshore wind ${kn.toFixed(0)}kn (unsafe)`)];
          const gusty = c.g != null && c.g * KN > kn * 1.5 + 2;
          if (kn >= 14 && kn <= 25 && !gusty) return ['good', tx(`바람 ${kn.toFixed(0)}kn`, `wind ${kn.toFixed(0)}kn`) + (s ? ' · ' + (ko ? { on: '온쇼어', side: '사이드', 'side-off': '사이드오프' }[s] : s) : '')];
          if (kn >= 11 && kn <= 30) return ['ok', gusty ? tx(`돌풍 심함 ${(c.g * KN).toFixed(0)}kn`, `gusty ${(c.g * KN).toFixed(0)}kn`) : tx(`바람 ${kn.toFixed(0)}kn`, `wind ${kn.toFixed(0)}kn`)];
          return ['no', kn < 11 ? tx(`바람 약함 ${kn.toFixed(0)}kn`, `too light ${kn.toFixed(0)}kn`) : tx(`바람 너무 강함 ${kn.toFixed(0)}kn`, `too strong ${kn.toFixed(0)}kn`)];
        }
        if (sp === 'surf') {
          if (h == null) return ['no', tx('파도 자료 없음', 'no wave data')];
          if (h < 0.5) return ['no', tx(`파도 없음 ${H(h)}`, `flat ${H(h)}`)];
          const clean = kn < 8 || s === 'off' || s === 'side-off', per = c.p;
          if (h >= 0.9 && h <= 2.5 && (per == null || per >= 10) && clean) return ['good', tx(`파고 ${H(h)} · 주기 ${per ? Math.round(per) + 's' : '–'}`, `${H(h)} @ ${per ? Math.round(per) + 's' : '–'}`)];
          if (h <= 3.2 && (clean || kn < 14)) return ['ok', tx(`파고 ${H(h)} · 바람 ${kn.toFixed(0)}kn`, `${H(h)} · wind ${kn.toFixed(0)}kn`)];
          return ['no', h > 3.2 ? tx(`파도 너무 큼 ${H(h)}`, `too big ${H(h)}`) : tx(`바람에 파도 뭉개짐 ${kn.toFixed(0)}kn`, `blown out ${kn.toFixed(0)}kn`)];
        }
        return null;
      }
      window.sportRate = rate;

      // ── 날씨 자료(포인트별 시간대) ──
      const data = new Map(); // key → { at, t:[ms], w, g, d, h, p, cur }
      const keyOf = (st) => `${st.coords[1].toFixed(3)}_${st.coords[0].toFixed(3)}`;
      const pending = new Set();
      async function fetchBatch(list) {
        const la = list.map(s => s.coords[1].toFixed(3)).join(','), lo = list.map(s => s.coords[0].toFixed(3)).join(',');
        const q = `latitude=${la}&longitude=${lo}&forecast_days=3&past_days=1&timezone=GMT&timeformat=unixtime`;
        const [w, m] = await Promise.all([
          fetch(`https://api.open-meteo.com/v1/forecast?${q}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`https://marine-api.open-meteo.com/v1/marine?${q}&hourly=wave_height,wave_period,swell_wave_period,ocean_current_velocity&cell_selection=sea`).then(r => r.ok ? r.json() : null).catch(() => null)
        ]);
        const W = w ? (Array.isArray(w) ? w : [w]) : [], M = m ? (Array.isArray(m) ? m : [m]) : [];
        list.forEach((st, i) => {
          const a = W[i] && W[i].hourly, b = M[i] && M[i].hourly;
          if (!a) return;
          data.set(keyOf(st), { at: Date.now(), t: a.time.map(x => x * 1000), w: a.wind_speed_10m, g: a.wind_gusts_10m, d: a.wind_direction_10m,
            h: b ? b.wave_height : null, p: b ? (b.swell_wave_period || b.wave_period) : null, cur: b ? b.ocean_current_velocity : null, mt: b ? b.time.map(x => x * 1000) : null });
        });
      }
      function condAt(st, ms) {
        const e = data.get(keyOf(st)); if (!e) return null;
        const idx = (arr) => { let k = Math.round((ms - arr[0]) / 3600e3); return k >= 0 && k < arr.length ? k : -1; };
        const i = idx(e.t); if (i < 0 || e.w[i] == null) return null;
        const j = e.mt ? idx(e.mt) : -1, at = (a, k) => a && k >= 0 && a[k] != null ? a[k] : null;
        const cur = at(e.cur, j);
        return { w: e.w[i], g: at(e.g, i), d: at(e.d, i), h: at(e.h, j), p: at(e.p, j), cur: cur == null ? null : cur / 1.852 };
      }

      // ── 시각: 실시간 표에서 고른 칸(현지 시각을 UTC처럼 쓴 값 → 실제 시각), 없으면 지금 ──
      let selX = null;
      const targetMs = () => {
        const st = typeof selectedStation !== 'undefined' ? selectedStation : null, d = st && st._hourlyCache;
        if (selX == null || !d) return Date.now();
        return selX - Math.round((d.nowLocalMs - Date.now()) / 60000) * 60000;
      };
      const fDial = window.windDialSetTime;
      if (typeof fDial === 'function') window.windDialSetTime = function (x) { selX = x; schedulePaint(); return fDial.apply(this, arguments); };

      // ── 지도 테두리 칠하기 ──
      const visibleStations = () => {
        if (typeof leafletMap === 'undefined' || !leafletMap || typeof isDetailMode === 'undefined' || !isDetailMode) return [];
        const b = leafletMap.getBounds().pad(0.1), c = leafletMap.getCenter();
        return (typeof stations !== 'undefined' ? stations : []).filter(st => st.isBeach && st.coords && b.contains([st.coords[1], st.coords[0]]))
          .sort((a, z) => Math.hypot(a.coords[1] - c.lat, a.coords[0] - c.lng) - Math.hypot(z.coords[1] - c.lat, z.coords[0] - c.lng)).slice(0, 120);
      };
      let paintRaf = 0, loadTimer = 0;
      function schedulePaint() { if (!paintRaf) paintRaf = requestAnimationFrame(() => { paintRaf = 0; paint(); }); }
      function paint() {
        const ms = targetMs(), vis = visibleStations(), cnt = { good: 0, ok: 0, no: 0 };
        const show = typeof leafletMap !== 'undefined' && leafletMap && leafletMap.getZoom() >= 8;
        (typeof stations !== 'undefined' ? stations : []).forEach(st => {
          if (!st.isBeach) return;
          const m = typeof leafletMarkersByStationId !== 'undefined' && leafletMarkersByStationId[st.id], el = m && m.getElement && m.getElement();
          const dot = el && el.querySelector('.lf-dot'); if (!dot) return;
          let g = null;
          if (show) { const c = condAt(st, ms); if (c) { const r = rate(sport, c, st.face != null ? st.face : null); g = r && r[0]; } }
          dot.classList.toggle('sig-good', g === 'good'); dot.classList.toggle('sig-ok', g === 'ok'); dot.classList.toggle('sig-no', g === 'no');
        });
        vis.forEach(st => { const c = condAt(st, ms); if (c) { const r = rate(sport, c, st.face); if (r) cnt[r[0]]++; } });
        lastCnt = cnt;
        if (menu && menu.style.display !== 'none') renderMenu();
      }
      let lastCnt = { good: 0, ok: 0, no: 0 };
      function loadVisible() {
        clearTimeout(loadTimer);
        loadTimer = setTimeout(async () => {
          if (typeof leafletMap === 'undefined' || !leafletMap || leafletMap.getZoom() < 8) { paint(); return; }
          const need = visibleStations().filter(st => { const e = data.get(keyOf(st)); return (!e || Date.now() - e.at > 3600e3) && !pending.has(keyOf(st)); });
          for (let i = 0; i < need.length; i += 50) {
            const part = need.slice(i, i + 50); part.forEach(st => pending.add(keyOf(st)));
            try { await fetchBatch(part); } catch (_) {}
            part.forEach(st => pending.delete(keyOf(st)));
            paint();
          }
          paint();
        }, 500);
      }

      // ── 셀렉트 박스(열 때만 종목별 신호등 + 설명) ──
      let wrap = null, btn = null, menu = null;
      const light = (g) => `<span class="sg-light"><i class="${g === 'good' ? 'on good' : ''}"></i><i class="${g === 'ok' ? 'on ok' : ''}"></i><i class="${g === 'no' ? 'on no' : ''}"></i></span>`;
      function renderBtn() { if (btn) btn.innerHTML = `<span class="sg-dot"></span>${T()[sport]} <span class="sg-car">▾</span>`; }
      function renderMenu() {
        const L0 = T(), st = typeof selectedStation !== 'undefined' && selectedStation && selectedStation.isBeach ? selectedStation : null;
        const ms = targetMs(), c = st ? condAt(st, ms) : null;
        let face = null;
        if (st) { face = st.face != null ? st.face : (typeof coastFace === 'function' ? coastFace(st) : null); if (face === undefined) face = null; }
        const tm = new Date(ms + (st && st._hourlyCache ? Math.round((st._hourlyCache.nowLocalMs - Date.now()) / 60000) * 60000 : -new Date().getTimezoneOffset() * 60000));
        const hhmm = String(tm.getUTCHours()).padStart(2, '0') + ':' + String(tm.getUTCMinutes()).padStart(2, '0');
        let head = st ? `<div class="sg-head"><b>${String(st.label || st.name).replace(/[<>&]/g, '')}</b> · ${selX == null ? L0.now + ' ' : ''}${hhmm}</div>`
          : `<div class="sg-head">${L0.visible(lastCnt.good, lastCnt.ok, lastCnt.no)}</div>`;
        if (st && !c) head += `<div class="sg-why">${pending.size ? L0.loading : L0.none}</div>`;
        menu.innerHTML = head + ORDER.map(k => {
          const r = st && c ? rate(k, c, face) : null;
          return `<button type="button" class="sg-item${k === sport ? ' cur' : ''}" data-sp="${k}">${st ? light(r && r[0]) : ''}<span class="sg-nm">${L0[k]}${k === 'wind' ? `<small>${L0.windSub}</small>` : ''}</span>` +
            (r ? `<span class="sg-why ${r[0]}">${L0[r[0]]} · ${r[1]}</span>` : '') + `</button>`;
        }).join('') + `<div class="sg-lg"><i class="good"></i>${L0.good}<i class="ok"></i>${L0.ok}<i class="no"></i>${L0.no}</div>`;
      }
      function openMenu(open) {
        menu.style.display = open ? '' : 'none'; btn.classList.toggle('on', open);
        if (open) { renderMenu(); const st = typeof selectedStation !== 'undefined' ? selectedStation : null; if (st && st.isBeach && !data.has(keyOf(st))) { pending.add(keyOf(st)); fetchBatch([st]).finally(() => { pending.delete(keyOf(st)); paint(); }); } }
      }
      window.__onCoastLoaded = () => { if (menu && menu.style.display !== 'none') renderMenu(); };

      const f = window.showDetailMap;
      if (typeof f === 'function') window.showDetailMap = function () {
        const r = f.apply(this, arguments);
        try {
          if (leafletMap && !wrap) {
            const Ctl = L.Control.extend({ onAdd() {
              wrap = L.DomUtil.create('div', 'sg-wrap'); L.DomEvent.disableClickPropagation(wrap); L.DomEvent.disableScrollPropagation(wrap);
              menu = L.DomUtil.create('div', 'sg-menu', wrap); menu.style.display = 'none';
              btn = L.DomUtil.create('button', 'sg-btn', wrap); btn.type = 'button';
              btn.onclick = () => openMenu(menu.style.display === 'none');
              menu.addEventListener('click', (e) => { const b = e.target.closest('[data-sp]'); if (!b) return; sport = b.dataset.sp;
                try { localStorage.setItem('otemp.sport', sport); } catch (_) {} renderBtn(); openMenu(false); paint(); });
              renderBtn(); return wrap; } });
            new Ctl({ position: 'bottomleft' }).addTo(leafletMap);
            leafletMap.on('moveend zoomend', () => { loadVisible(); schedulePaint(); });
            leafletMap.on('click', () => { if (menu && menu.style.display !== 'none') openMenu(false); });
          }
          loadVisible(); setTimeout(paint, 400);
        } catch (_) {}
        return r;
      };
      // 정점을 고르면 메뉴 내용·테두리 다시
      const fs = window.selectStation;
      if (typeof fs === 'function') window.selectStation = function () { const r = fs.apply(this, arguments); selX = null; try { schedulePaint(); } catch (_) {} return r; };
    })();
