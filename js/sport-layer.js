    // [ADD] 포인트 종목(다이빙·서핑·윈드서핑/카이트/윙·SUP/카약·조정) - 지도 아이콘 + 종목 켜고 끄기
    //  - 다이빙만 있는 포인트는 예전처럼 수온 색 동그라미. 다른 종목이 있으면 작은 원형 아이콘(돛·파도·패들·보트)
    //  - 종목이 여러 개면 대표 아이콘 + "+1" 배지. 대표 순서: 바람 → 서핑 → SUP·카약 → 조정 → 다이빙
    //  - 오른쪽 아래 "종목" 버튼: 종목별로 켜고 끄기(이 브라우저에 기억). 고른 종목이 하나도 없는 포인트는 지도에서 숨김
    (function () {
      const SVG = {
        dive: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="8" width="18" height="9" rx="4"/><path d="M12 8v9"/></svg>',
        surf: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M2 16c3 0 3-3 6-3s3 3 6 3 3-3 6-3"/><path d="M4 11c1-4 5-7 10-6-3 1-4 3-4 6"/></svg>',
        wind: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M11 3v15"/><path d="M11 3c4 3 6 8 6 13h-6"/><path d="M4 20h16"/></svg>',
        paddle: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M5 19L17 7"/><ellipse cx="18.5" cy="5.5" rx="2" ry="3.5" transform="rotate(45 18.5 5.5)"/><path d="M3 21h8"/></svg>',
        row: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M3 15h18l-2 3H5z"/><path d="M6 6l4 9M18 6l-4 9"/></svg>'
      };
      const ORDER = ['wind', 'surf', 'paddle', 'row', 'dive'];
      const NAME = {
        ko: { dive: '다이빙', surf: '서핑', wind: '윈드서핑·카이트·윙', paddle: 'SUP·카약', row: '조정', title: '종목' },
        en: { dive: 'Diving', surf: 'Surfing', wind: 'Windsurf · Kite · Wing', paddle: 'SUP · Kayak', row: 'Rowing', title: 'Activities' },
        ja: { dive: 'ダイビング', surf: 'サーフィン', wind: 'ウィンド・カイト・ウイング', paddle: 'SUP・カヤック', row: 'ボート(漕艇)', title: '種目' }
      };
      const nm = () => NAME[typeof lang !== 'undefined' && NAME[lang] ? lang : 'en'];
      const sportsOf = (st) => (st && Array.isArray(st.sports) && st.sports.length ? st.sports : ['dive']);
      const mainOf = (st) => ORDER.find(k => sportsOf(st).includes(k)) || 'dive';
      window.SPORT_SVG = SVG; window.SPORT_ORDER = ORDER; window.sportName = (k) => nm()[k] || k; window.stationSports = sportsOf;

      // detail-map.js가 정점 표시를 만들 때 부름. c = 수온 색 "r,g,b"
      window.spotDotHTML = function (st, c) {
        const sp = sportsOf(st);
        if (!st.isBeach || (sp.length === 1 && sp[0] === 'dive')) return `<div class="lf-dot ${st.isBeach ? 'beach' : ''}" style="background-color: rgba(${c}, 0.78);"></div>`;
        const m = mainOf(st);
        return `<div class="lf-dot beach lf-sport ${m}" title="${sp.map(k => nm()[k]).join(' · ')}">${SVG[m]}${sp.length > 1 ? `<span class="lf-more">+${sp.length - 1}</span>` : ''}</div>`;
      };

      let off = (() => { try { return new Set(JSON.parse(localStorage.getItem('otemp.sportOff') || '[]')); } catch (_) { return new Set(); } })();
      let btn = null, box = null;
      function apply() {
        if (typeof leafletMap === 'undefined' || !leafletMap || typeof leafletMarkersByStationId === 'undefined') return;
        (typeof stations !== 'undefined' ? stations : []).forEach(st => {
          if (!st.isBeach) return;
          const m = leafletMarkersByStationId[st.id]; if (!m) return;
          const vis = sportsOf(st).some(k => !off.has(k)) || (typeof selectedStation !== 'undefined' && selectedStation === st);
          const has = leafletMap.hasLayer(m);
          if (vis && !has) m.addTo(leafletMap); else if (!vis && has) leafletMap.removeLayer(m);
        });
        if (btn) { btn.textContent = nm().title + (off.size ? ` ${ORDER.length - off.size}/${ORDER.length}` : ''); btn.classList.toggle('on', !!box && box.style.display !== 'none'); }
        if (box) box.querySelectorAll('[data-sp]').forEach(b => b.classList.toggle('off', off.has(b.dataset.sp)));
        if (window.layoutStationLabels) window.layoutStationLabels();
      }
      // 이 근처에 종목이 2가지 이상 있을 때만 버튼 보이기(다이빙만 있는 곳은 필요 없음)
      function anySports() { return (typeof stations !== 'undefined' ? stations : []).some(st => st.isBeach && sportsOf(st).some(k => k !== 'dive')); }
      const f = window.showDetailMap;
      if (typeof f === 'function') window.showDetailMap = function () {
        const r = f.apply(this, arguments);
        try {
          if (leafletMap && !btn && anySports()) {
            const Ctl = L.Control.extend({ onAdd() {
              const wrap = L.DomUtil.create('div', 'sport-tg'); L.DomEvent.disableClickPropagation(wrap); L.DomEvent.disableScrollPropagation(wrap);
              box = L.DomUtil.create('div', 'sport-box', wrap); box.style.display = 'none';
              box.innerHTML = ORDER.map(k => `<button type="button" data-sp="${k}"><span class="lf-sport ${k}">${SVG[k]}</span>${nm()[k]}</button>`).join('');
              box.addEventListener('click', (e) => { const b = e.target.closest('[data-sp]'); if (!b) return; const k = b.dataset.sp; off.has(k) ? off.delete(k) : off.add(k);
                try { localStorage.setItem('otemp.sportOff', JSON.stringify([...off])); } catch (_) {} apply(); });
              btn = L.DomUtil.create('button', 'depth-btn sport-btn', wrap); btn.type = 'button';
              btn.onclick = () => { box.style.display = box.style.display === 'none' ? '' : 'none'; apply(); };
              return wrap; } });
            new Ctl({ position: 'bottomright' }).addTo(leafletMap);
          }
          setTimeout(apply, 300);
        } catch (_) {}
        return r;
      };
    })();
