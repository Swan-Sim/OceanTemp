    // [ADD] 흐름(조류) 지형 반영 - 바다 모델(약 8km 격자)은 작은 섬을 몰라서, 정점 주변 섬 모양(OpenStreetMap 해안선)으로 다시 계산
    //  - 섬 하나 = 넓이가 같은 원으로 보고, 물이 원기둥을 비켜 흐르는 기본 물리식(퍼텐셜 흐름): 섬 양옆은 빨라지고(최대 2배), 앞은 거의 멈춤
    //  - 섬 바로 뒤(흐름이 빠져나가는 쪽)는 잔잔해지는 구역을 경험식으로 더함
    //  - 섬 여러 개면 각 섬이 만드는 변화를 더해요. 섬에서 멀어지면 원래 흐름 그대로
    //  - 지도: 정점을 고르면 그 주변 섬 둘레에만 흐름 화살표(수면 흐름 기준). 나침반·흐름 상자 값도 이 계산으로 바꿔 보여줘요(추정)
    (function () {
      const cache = new Map(); // "위도_경도"(0.01°) → { islands:[모델], loading }
      let fieldLayer = null, lastKey = '';
      const keyOf = (st) => `${st.coords[1].toFixed(2)}_${st.coords[0].toFixed(2)}`;

      function model(poly) {
        const la0 = poly[0][0], kx = 111320 * Math.cos(la0 * Math.PI / 180), ky = 111320;
        let A = 0, cx = 0, cy = 0;
        for (let i = 0; i < poly.length - 1; i++) { const x1 = poly[i][1] * kx, y1 = poly[i][0] * ky, x2 = poly[i + 1][1] * kx, y2 = poly[i + 1][0] * ky, cr = x1 * y2 - x2 * y1; A += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr; }
        A /= 2; cx /= 6 * A; cy /= 6 * A;
        let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity; poly.forEach(p => { mnx = Math.min(mnx, p[1]); mxx = Math.max(mxx, p[1]); mny = Math.min(mny, p[0]); mxy = Math.max(mxy, p[0]); });
        return { kx, ky, cx, cy, a: Math.sqrt(Math.abs(A) / Math.PI), poly, bb: [mny, mnx, mxy, mxx] };
      }
      const inPoly = (la, lo, m) => { if (la < m.bb[0] || la > m.bb[2] || lo < m.bb[1] || lo > m.bb[3]) return false; let c = false; const P = m.poly;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if (((a[0] > la) !== (b[0] > la)) && (lo < (b[1] - a[1]) * (la - a[0]) / (b[0] - a[0]) + a[1])) c = !c; } return c; };

      // 그 자리의 흐름(동·북 성분, m/s). 섬 위면 null. U = 바다 모델 흐름 세기, to = 흐르는 방향(북=0)
      function flowAt(la, lo, U, to, isl) {
        const ux = Math.sin(to * Math.PI / 180), uy = Math.cos(to * Math.PI / 180);
        let vx = U * ux, vy = U * uy;
        for (const m of isl) {
          if (inPoly(la, lo, m)) return null;
          const x = lo * m.kx - m.cx, y = la * m.ky - m.cy, r2 = x * x + y * y, a2 = m.a * m.a;
          if (r2 > a2 * 36 || r2 < a2 * 0.6) continue; // 멀면 영향 없음 · 섬 모양과 원이 안 맞는 안쪽은 건너뜀
          const xs = x * ux + y * uy, ys = -x * uy + y * ux, th = Math.atan2(ys, xs);
          const ur = U * Math.cos(th) * (1 - a2 / r2), ut = -U * Math.sin(th) * (1 + a2 / r2);
          let fs = ur * Math.cos(th) - ut * Math.sin(th), fn = ur * Math.sin(th) + ut * Math.cos(th);
          if (xs > m.a * 0.3) { const k = 1 - 0.65 * Math.exp(-Math.max(0, xs - m.a) / (3 * m.a)) * Math.exp(-(ys * ys) / (1.2 * a2)); fs *= k; fn *= k; }
          vx += (fs * ux - fn * uy) - U * ux; vy += (fs * uy + fn * ux) - U * uy; // 섬마다 생기는 변화만 더함
        }
        return [vx, vy];
      }

      function load(st) {
        const key = keyOf(st);
        if (cache.has(key)) return cache.get(key);
        const ent = { islands: null };
        cache.set(key, ent);
        fetch(`/api/spotobs?svc=coast&lat=${st.coords[1].toFixed(2)}&lon=${st.coords[0].toFixed(2)}`).then(r => r.json()).then(j => {
          ent.islands = j && j.ok ? (j.islands || []).map(model) : [];
          if (typeof windDialUpdate === 'function') windDialUpdate();
        }).catch(() => { cache.delete(key); });
        return ent;
      }
      // 정점 둘레(5km) 안 섬만
      function islandsFor(st) {
        if (!st || !st.coords) return null;
        const ent = load(st); if (!ent.islands) return null;
        const la = st.coords[1], lo = st.coords[0];
        return ent.islands.filter(m => Math.hypot(lo * m.kx - m.cx, la * m.ky - m.cy) < Math.max(5000, m.a * 6));
      }

      // 나침반·흐름 상자용: 정점 자리의 흐름을 지형 반영으로 바꿔요. 영향이 없으면 그대로
      window.currentTerrainAdjust = function (st, c) {
        window.__curTerrain = null;
        if (!c || !(c.speed > 0)) return c;
        const isl = islandsFor(st); if (!isl || !isl.length) return c;
        const v = flowAt(st.coords[1], st.coords[0], c.speed, c.to, isl);
        if (!v) return c; // 좌표가 섬 위로 찍힌 정점은 그대로
        const sp = Math.hypot(v[0], v[1]), k = sp / c.speed;
        if (Math.abs(k - 1) < 0.05 && Math.abs(((Math.atan2(v[0], v[1]) * 180 / Math.PI - c.to + 540) % 360) - 180) < 5) return c;
        window.__curTerrain = { k };
        return { speed: sp, to: (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360, k };
      };

      // 지도: 고른 정점 주변 섬 둘레에만 흐름 화살표(수면 흐름)
      window.currentTerrainField = function (st, cs) {
        const map = typeof leafletMap !== 'undefined' ? leafletMap : null;
        if (!map) return;
        if (!fieldLayer) fieldLayer = L.layerGroup();
        fieldLayer.clearLayers();
        const isl = st && cs && cs.speed > 0 && typeof isDetailMode !== 'undefined' && isDetailMode && map.getZoom() >= 13 ? islandsFor(st) : null;
        if (!isl || !isl.length) { if (map.hasLayer(fieldLayer)) map.removeLayer(fieldLayer); return; }
        if (!map.getPane('curFieldPane')) { const pn = map.createPane('curFieldPane'); pn.style.zIndex = 450; pn.style.pointerEvents = 'none'; }
        const sz = map.getSize(), step = 46, U = cs.speed; // [CHANGE] 간격 34 → 46px(덜 빽빽하게)
        for (let py = step / 2; py < sz.y; py += step) for (let px = step / 2; px < sz.x; px += step) {
          const ll = map.containerPointToLatLng([px, py]);
          const near = Math.min(...isl.map(m => Math.hypot(ll.lng * m.kx - m.cx, ll.lat * m.ky - m.cy) / m.a)); if (near > 3.2) continue; // 섬 둘레에만
          const op = 0.5 - 0.3 * Math.max(0, Math.min(1, (near - 1.2) / 2)); // [CHANGE] 반투명: 섬 가까이 0.5 → 바깥 0.2로 흐려짐
          const v = flowAt(ll.lat, ll.lng, U, cs.to, isl); if (!v) continue;
          const k = Math.hypot(v[0], v[1]) / U, len = 6 + 20 * Math.min(2, k), ang = Math.atan2(v[0], v[1]);
          const col = k >= 1.4 ? '#fb923c' : k <= 0.5 ? '#94a3b8' : '#a3e635';
          const x2 = px + Math.sin(ang) * len, y2 = py - Math.cos(ang) * len, hx = Math.sin(ang), hy = -Math.cos(ang);
          const P = (x, y) => map.containerPointToLatLng([x, y]);
          L.polyline([P(px, py), P(x2, y2)], { color: col, weight: 1.5, opacity: op, interactive: false, pane: 'curFieldPane' }).addTo(fieldLayer);
          L.polyline([P(x2 - hx * 6 - hy * 4, y2 - hy * 6 + hx * 4), P(x2, y2), P(x2 - hx * 6 + hy * 4, y2 - hy * 6 - hx * 4)], { color: col, weight: 1.5, opacity: op, interactive: false, pane: 'curFieldPane' }).addTo(fieldLayer);
        }
        if (!map.hasLayer(fieldLayer)) fieldLayer.addTo(map);
      };
      let hooked = false;
      const f = window.showDetailMap;
      if (typeof f === 'function') window.showDetailMap = function () {
        const r = f.apply(this, arguments);
        try { if (leafletMap && !hooked) { hooked = true; leafletMap.on('moveend zoomend', () => { if (typeof windDialUpdate === 'function') windDialUpdate(); }); } } catch (_) {}
        return r;
      };
    })();
