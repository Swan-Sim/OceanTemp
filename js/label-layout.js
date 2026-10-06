    // [ADD] 상세 지도 정점 이름표 배치 (시안 C "지시선" + 몰린 곳은 D "부채꼴")
    //  - 점 3개 이상이 40px 안에 몰린 무리: 무리 가운데에서 바깥쪽으로 고르게 펼쳐 선으로 이어요(선끼리 안 엇갈리게)
    //  - 이름표는 가로로. 점 주변 8방향(오른쪽 → 왼쪽 → 대각선 → 위·아래) 중 다른 이름표·점과 안 겹치는 자리에 붙여요
    //  - 떨어진 정점은 바로 옆에, 자리가 없으면 짧은 선(약 34px)으로 근처 빈 곳에(선이 길어질 상황이면 숨김)
    //  - 그래도 자리가 없으면 이름표만 숨기고 점은 남겨요(확대하면 다시 나타남)
    //  - 고른 정점 → 화면 가운데에 가까운 정점 순서로 자리를 잡아요
    (function () {
      const H = 19, GAP = 4, DOT = 8; // 이름표 높이, 점과 이름표 사이, 점 반지름(여유 포함)
      const AX = 7, AY = 10; // 마커 안에서 점 가운데 위치(iconAnchor와 같음)
      let raf = 0;
      const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

      function layoutLabels() {
        raf = 0;
        if (typeof leafletMap === 'undefined' || !leafletMap || typeof isDetailMode === 'undefined' || !isDetailMode) return;
        const size = leafletMap.getSize(), bounds = leafletMap.getBounds().pad(0.05), z = leafletMap.getZoom();
        const items = [], dots = [];
        Object.keys(leafletMarkersByStationId).forEach(id => {
          const m = leafletMarkersByStationId[id], el = m.getElement && m.getElement();
          if (!el || !bounds.contains(m.getLatLng())) return;
          const p = leafletMap.latLngToContainerPoint(m.getLatLng());
          dots.push({ x: p.x - DOT, y: p.y - DOT, w: DOT * 2, h: DOT * 2 });
          const lab = el.querySelector('.lf-label'); if (!lab) return;
          if (!lab._w) { lab.style.display = ''; const w = Math.ceil(lab.getBoundingClientRect().width); if (w) lab._w = w; } // 화면에 보일 때 한 번 재서 기억
          items.push({ id, el, lab, p, w: lab._w || 60 });
        });
        const sel = typeof selectedStation !== 'undefined' && selectedStation ? String(selectedStation.id) : null;
        const cx = size.x / 2, cy = size.y / 2;
        items.sort((a, b) => (b.id === sel) - (a.id === sel) || Math.hypot(a.p.x - cx, a.p.y - cy) - Math.hypot(b.p.x - cx, b.p.y - cy));
        const placed = [], inView = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= size.x && b.y + b.h <= size.y;
        const free = (b, own) => inView(b) && !placed.some(q => hit(b, q)) && !dots.some(q => q !== own && hit(b, q));
        const draw = (o, pos, lead) => {
          const old = o.el.querySelector('svg.lf-lead'); if (old) old.remove();
          if (!pos) { o.lab.style.display = 'none'; return; }
          o.lab.style.display = ''; o.lab.style.left = (AX + pos[0]) + 'px'; o.lab.style.top = (AY + pos[1]) + 'px';
          if (lead) {
            const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'lf-lead'); s.setAttribute('width', '1'); s.setAttribute('height', '1');
            s.innerHTML = `<line x1="${AX}" y1="${AY}" x2="${AX + lead[0]}" y2="${AY + lead[1]}"/>`; o.el.prepend(s);
          }
        };
        // [D] 몰린 무리(서로 40px 안, 3개 이상)는 부채꼴로 먼저 자리 잡기
        const done = new Set();
        if (z >= 8) {
          const par = items.map((_, i) => i), root = (i) => par[i] === i ? i : (par[i] = root(par[i]));
          for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (Math.hypot(items[i].p.x - items[j].p.x, items[i].p.y - items[j].p.y) < 40) par[root(i)] = root(j);
          const groups = {}; items.forEach((o, i) => (groups[root(i)] = groups[root(i)] || []).push(o));
          Object.values(groups).filter(c => c.length >= 3).forEach(c => {
            const gx = c.reduce((s, o) => s + o.p.x, 0) / c.length, gy = c.reduce((s, o) => s + o.p.y, 0) / c.length;
            const rad = Math.max(...c.map(o => Math.hypot(o.p.x - gx, o.p.y - gy))) + 42;
            c.sort((a, b) => Math.atan2(a.p.y - gy, a.p.x - gx) - Math.atan2(b.p.y - gy, b.p.x - gx)); // 놓인 방향 순서대로 → 선이 안 엇갈림
            const a0 = Math.atan2(c[0].p.y - gy, c[0].p.x - gx);
            c.forEach((o, k) => {
              const own = dots.find(d => d.x === o.p.x - DOT && d.y === o.p.y - DOT); let pos = null, lead = null;
              outer: for (const extra of [0, 22, 44]) for (const tw of [0, 0.5, -0.5]) {
                const a = a0 + (k + tw) / c.length * 2 * Math.PI, ex = gx + Math.cos(a) * (rad + extra), ey = gy + Math.sin(a) * (rad + extra);
                const lx = Math.cos(a) >= 0 ? ex : ex - o.w, b = { x: lx, y: ey - H / 2, w: o.w, h: H };
                if (free(b, own)) { placed.push(b); pos = [lx - o.p.x, ey - H / 2 - o.p.y]; lead = [ex - o.p.x, ey - o.p.y]; break outer; }
              }
              if (!pos && o.id === sel) pos = [DOT + GAP, -H / 2];
              draw(o, pos, lead); done.add(o);
            });
          });
        }
        items.forEach(o => {
          if (done.has(o)) return;
          const own = dots.find(d => d.x === o.p.x - DOT && d.y === o.p.y - DOT);
          let pos = null, lead = null;
          const near = [[DOT + GAP, -H / 2], [-DOT - GAP - o.w, -H / 2], [DOT - 2, -DOT - H + 2], [DOT - 2, DOT - 2], [-DOT - o.w + 2, -DOT - H + 2], [-DOT - o.w + 2, DOT - 2], [-o.w / 2, -DOT - GAP - H], [-o.w / 2, DOT + GAP]];
          for (const [dx, dy] of near) { const b = { x: o.p.x + dx, y: o.p.y + dy, w: o.w, h: H }; if (free(b, own)) { pos = [dx, dy]; placed.push(b); break; } }
          if (!pos && z >= 8) { // 지시선: 바깥으로 점점 멀리, 16방향
            outer: for (const r of [34]) for (let k = 0; k < 16; k++) { // 짧은 선만(길어질 곳은 위의 부채꼴이 맡음)
              const a = k / 16 * 2 * Math.PI, ex = Math.cos(a) * r, ey = Math.sin(a) * r;
              const dx = ex >= 0 ? ex : ex - o.w, dy = ey - H / 2, b = { x: o.p.x + dx, y: o.p.y + dy, w: o.w, h: H };
              if (free(b, own)) { pos = [dx, dy]; lead = [ex, ey]; placed.push(b); break outer; }
            }
          }
          if (!pos && o.id === sel) pos = [DOT + GAP, -H / 2]; // 고른 정점은 겹쳐도 보이게
          draw(o, pos, lead);
        });
      }
      const schedule = () => { if (!raf) raf = setTimeout(layoutLabels, 30); };
      window.layoutStationLabels = schedule;

      let hooked = false;
      const f = window.showDetailMap;
      if (typeof f === 'function') window.showDetailMap = function () {
        const r = f.apply(this, arguments);
        try { if (leafletMap && !hooked) { hooked = true; leafletMap.on('zoomend moveend resize', schedule); } setTimeout(schedule, 450); } catch (_) {}
        return r;
      };
      const u = window.updateLeafletSelection;
      if (typeof u === 'function') window.updateLeafletSelection = function () { const r = u.apply(this, arguments); schedule(); return r; };
    })();
