    // [ADD] 흐름(조류) 지형 반영 - 바다 모델(약 8km 격자)은 작은 섬을 몰라서, 정점 주변 섬 모양(OpenStreetMap 해안선)으로 다시 계산
    //  - 섬 하나 = 넓이가 같은 원으로 보고, 물이 원기둥을 비켜 흐르는 기본 물리식(퍼텐셜 흐름): 섬 양옆은 빨라지고(최대 2배), 앞은 거의 멈춤
    //  - 섬 바로 뒤(흐름이 빠져나가는 쪽)는 잔잔해지는 구역을 경험식으로 더함
    //  - 섬 여러 개면 각 섬이 만드는 변화를 더해요. 섬에서 멀어지면 원래 흐름 그대로
    //  - 지도: 정점을 고르면 그 주변 섬 둘레에만 흐름 화살표(수면 흐름 기준). 나침반·흐름 상자 값도 이 계산으로 바꿔 보여줘요(추정)
    //  - [ADD] 본섬·육지 해안(방파제·항구 포함)도 "벽"으로 반영:
    //    ① 벽(해안선 조각)마다 물을 밀어내는 세기를 풀어서(패널법 퍼텐셜 흐름) 벽을 뚫지 못하게 → 막힌 정면은 느려지고,
    //       막힌 물이 방파제 끝·곶 끝으로 돌아 나가며 빨라짐(최대 2.5배로 제한)
    //    ② 사방 1.5km로 16방향 선을 쏴서 대부분 막혀 있으면(항구 안·깊은 만) 잔잔하게
    //    ③ 흐름이 오는 쪽(상류)이 가까이 막혀 있으면(방파제·곶 뒤) 약하게
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

      // [ADD] 해안선 "벽": 조각 목록(미터 좌표). OSM 해안선은 진행 방향 왼쪽이 육지
      function wallModel(lines, la0, lo0) {
        const kx = 111320 * Math.cos(la0 * Math.PI / 180), ky = 111320, segs = [];
        // 조각이 너무 많으면 계산이 무거워져서 점을 솎아요(최대 약 450개)
        const total = lines.reduce((n, l) => n + l.length, 0), step = Math.max(1, Math.ceil(total / 450));
        lines.forEach(l => { const n0 = segs.length;
          if (step > 1) l = l.filter((_, i) => i % step === 0 || i === l.length - 1);
          for (let i = 0; i < l.length - 1; i++) { const ax = l[i][1] * kx, ay = l[i][0] * ky, bx = l[i + 1][1] * kx, by = l[i + 1][0] * ky, dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
            if (!(L > 0)) continue; segs.push({ ax, ay, bx, by, dx, dy, L, tx: dx / L, ty: dy / L, sx: dy / L, sy: -dx / L, first: segs.length === n0, last: false,
              x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) }); }
          if (segs.length > n0) segs[segs.length - 1].last = true; });
        const W = { kx, ky, segs, cx: lo0 * kx, cy: la0 * ky, sx: null, sy: null };
        solvePanels(W);
        return W;
      }
      // 조각 하나(세기 1)가 (x,y)에 만드는 흐름 [동, 북]
      function panelVel(g, x, y) {
        const rx = x - g.ax, ry = y - g.ay, xi = rx * g.tx + ry * g.ty, eta = rx * g.sx + ry * g.sy;
        const r1 = xi * xi + eta * eta, r2 = (xi - g.L) * (xi - g.L) + eta * eta;
        if (r1 < 1e-6 || r2 < 1e-6) return [0, 0];
        const u = Math.log(r1 / r2) / (4 * Math.PI), v = (Math.atan2(eta, xi - g.L) - Math.atan2(eta, xi)) / (2 * Math.PI);
        return [u * g.tx + v * g.sx, u * g.ty + v * g.sy];
      }
      // 벽마다 세기 풀기: 동쪽 흐름(1,0)·북쪽 흐름(0,1) 두 경우 → 실제 흐름은 둘을 섞어 씀
      function solvePanels(W) {
        const S = W.segs, n = S.length; if (!n) { W.sx = W.sy = new Float64Array(0); return; }
        const A = Array.from({ length: n }, () => new Float64Array(n + 2));
        for (let i = 0; i < n; i++) { const gi = S[i], px = gi.ax + gi.dx / 2 + gi.sx * 0.01, py = gi.ay + gi.dy / 2 + gi.sy * 0.01;
          for (let j = 0; j < n; j++) { const v = panelVel(S[j], px, py); A[i][j] = v[0] * gi.sx + v[1] * gi.sy; }
          A[i][n] = -gi.sx; A[i][n + 1] = -gi.sy; }
        for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
          if (p !== c) { const t = A[p]; A[p] = A[c]; A[c] = t; } const d = A[c][c]; if (Math.abs(d) < 1e-12) continue;
          for (let r = c + 1; r < n; r++) { const f = A[r][c] / d; if (!f) continue; const Ar = A[r], Ac = A[c]; for (let k = c; k < n + 2; k++) Ar[k] -= f * Ac[k]; } }
        const sx = new Float64Array(n), sy = new Float64Array(n);
        for (let r = n - 1; r >= 0; r--) { let a = A[r][n], b = A[r][n + 1]; for (let k = r + 1; k < n; k++) { a -= A[r][k] * sx[k]; b -= A[r][k] * sy[k]; }
          const d = A[r][r]; sx[r] = Math.abs(d) < 1e-12 ? 0 : a / d; sy[r] = Math.abs(d) < 1e-12 ? 0 : b / d; }
        W.sx = sx; W.sy = sy;
      }
      // 벽 때문에 생기는 흐름 변화(흐름 1 m/s, 방향 ux·uy 기준). 계산 상자 가장자리(3km 밖)로 갈수록 줄여 끊긴 해안 끝의 가짜 효과를 막음
      //  바다 모델(약 8km 격자)이 이미 큰 해안 모양은 반영하니까, 벽에서 멀어질수록(500m 단위) 줄여서 작은 구조물(방파제·곶) 효과만 더함
      function panelFlow(x, y, ux, uy, W, dWall) {
        let vx = 0, vy = 0; const S = W.segs;
        for (let j = 0; j < S.length; j++) { const s = ux * W.sx[j] + uy * W.sy[j]; if (!s) continue; const v = panelVel(S[j], x, y); vx += s * v[0]; vy += s * v[1]; }
        const dc = Math.hypot(x - W.cx, y - W.cy), w = Math.max(0, Math.min(1, (3000 - dc) / 1000)) * Math.exp(-(dWall || 0) / 500);
        return [vx * w, vy * w];
      }
      // 가장 가까운 벽: 거리, 바다 쪽 방향, 육지 위인지
      function nearWall(x, y, W, R) {
        let best = null;
        for (let i = 0; i < W.segs.length; i++) { const g = W.segs[i];
          if (x < g.x0 - R || x > g.x1 + R || y < g.y0 - R || y > g.y1 + R) continue;
          let t = ((x - g.ax) * g.dx + (y - g.ay) * g.dy) / (g.L * g.L); t = Math.max(0, Math.min(1, t));
          const px = g.ax + t * g.dx, py = g.ay + t * g.dy, d = Math.hypot(x - px, y - py);
          if (!best || d < best.d - 1e-6) best = { d, i, t, px, py };
        }
        if (!best) return null;
        const g = W.segs[best.i]; let nx = g.sx, ny = g.sy;
        // 꼭짓점에서 가장 가까우면 양쪽 조각의 바다 방향을 섞어서 판단(뾰족한 곳 오판 방지)
        if (best.t <= 0 && !g.first) { const h = W.segs[best.i - 1]; nx += h.sx; ny += h.sy; }
        else if (best.t >= 1 && !g.last) { const h = W.segs[best.i + 1]; nx += h.sx; ny += h.sy; }
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const side = (x - best.px) * nx + (y - best.py) * ny;
        // 벽에서 바다 쪽으로 향하는 방향(가까운 점 → 내 위치)
        let ox = x - best.px, oy = y - best.py; const ol = Math.hypot(ox, oy);
        if (ol > 0.5) { ox /= ol; oy /= ol; } else { ox = nx; oy = ny; }
        return { d: best.d, nx: ox, ny: oy, sx: nx, sy: ny, land: side < -0.5 };
      }
      // 한 방향으로 선을 쏴서 처음 막히는 거리(없으면 Infinity)
      function rayHit(x, y, ux, uy, segs, R) {
        let tmin = Infinity;
        for (const g of segs) { const den = ux * g.dy - uy * g.dx; if (Math.abs(den) < 1e-9) continue;
          const qx = g.ax - x, qy = g.ay - y, t = (qx * g.dy - qy * g.dx) / den, s = (qx * uy - qy * ux) / den;
          if (t > 3 && t < tmin && s >= 0 && s <= 1) tmin = t; }
        return tmin <= R ? tmin : Infinity;
      }
      const RAY_R = 1500, NR = 16;
      // 벽 효과: { f: 세기 배율, n: 벽 방향, e: 벽 가까움 정도 } 또는 육지면 null
      function wallEffect(la, lo, to, W) {
        const x = lo * W.kx, y = la * W.ky, nw = nearWall(x, y, W, RAY_R);
        if (!nw) return { f: 1, e: 0, d: Infinity };
        if (nw.land) return null;
        const near = W.segs.filter(g => !(x < g.x0 - RAY_R || x > g.x1 + RAY_R || y < g.y0 - RAY_R || y > g.y1 + RAY_R));
        let blocked = 0;
        for (let k = 0; k < NR; k++) { const a = k / NR * 2 * Math.PI; if (rayHit(x, y, Math.sin(a), Math.cos(a), near, RAY_R) < Infinity) blocked++; }
        const b = blocked / NR, fEnc = 1 - 0.9 * Math.max(0, Math.min(1, (b - 0.55) / 0.35));
        // 흐름이 오는 쪽(상류) 세 방향 중 가장 트인 거리
        const up = (to + 180) * Math.PI / 180;
        let dUp = 0; for (const da of [-0.26, 0, 0.26]) dUp = Math.max(dUp, rayHit(x, y, Math.sin(up + da), Math.cos(up + da), near, RAY_R));
        const fLee = dUp === Infinity ? 1 : 0.35 + 0.65 * Math.max(0, Math.min(1, dUp / 1000));
        return { f: Math.min(fEnc, fLee), nx: nw.nx, ny: nw.ny, e: Math.exp(-nw.d / 150), d: nw.d };
      }

      // 그 자리의 흐름(동·북 성분, m/s). 섬·육지 위면 null. U = 바다 모델 흐름 세기, to = 흐르는 방향(북=0)
      function flowAt(la, lo, U, to, isl, W) {
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
        if (W && W.segs.length) {
          const we = wallEffect(la, lo, to, W); if (!we) return null;
          const pf = panelFlow(lo * W.kx, la * W.ky, ux, uy, W, we.d); vx += U * pf[0]; vy += U * pf[1]; // 벽에 막혀 돌아가는 흐름(정면 느려짐·끝 빨라짐)
          const sp = Math.hypot(vx, vy); if (sp > 2.5 * U) { vx *= 2.5 * U / sp; vy *= 2.5 * U / sp; } // 벽 바로 옆 계산 튐 방지
          if (we.e > 0.01) { const vn = vx * we.nx + vy * we.ny; if (vn < 0) { vx -= vn * we.nx * we.e; vy -= vn * we.ny * we.e; } } // 남은 벽 뚫는 성분 정리
          vx *= we.f; vy *= we.f;
        }
        return [vx, vy];
      }

      function load(st) {
        const key = keyOf(st);
        if (cache.has(key)) return cache.get(key);
        const ent = { islands: null, walls: null };
        cache.set(key, ent);
        fetch(`/api/spotobs?svc=coast&lat=${st.coords[1].toFixed(2)}&lon=${st.coords[0].toFixed(2)}&v=2`).then(r => r.json()).then(j => {
          ent.islands = j && j.ok ? (j.islands || []).map(model) : [];
          ent.walls = wallModel(j && j.ok ? (j.walls || []) : [], +st.coords[1].toFixed(2), +st.coords[0].toFixed(2));
          if (typeof windDialUpdate === 'function') windDialUpdate();
          if (typeof window.__onCoastLoaded === 'function') window.__onCoastLoaded(st);
        }).catch(() => { cache.delete(key); });
        return ent;
      }
      // 정점 둘레(5km) 안 섬 + 해안 벽
      function terrainFor(st) {
        if (!st || !st.coords) return null;
        const ent = load(st); if (!ent.islands) return null;
        const la = st.coords[1], lo = st.coords[0];
        const isl = ent.islands.filter(m => Math.hypot(lo * m.kx - m.cx, la * m.ky - m.cy) < Math.max(5000, m.a * 6));
        const W = ent.walls && ent.walls.segs.length ? ent.walls : null;
        return isl.length || W ? { isl, W } : null;
      }

      // [ADD] 포인트의 바다 쪽 방향(°, 북=0) - 가장 가까운 해안선(3km 안)의 바다 쪽. 불러오는 중이면 undefined, 해안선이 없으면(호수 등) null
      window.coastFace = function (st) {
        if (!st || !st.coords) return null;
        const ent = load(st); if (!ent.islands) return undefined;
        const la = st.coords[1], lo = st.coords[0];
        let best = null;
        if (ent.walls && ent.walls.segs.length) { const nw = nearWall(lo * ent.walls.kx, la * ent.walls.ky, ent.walls, 3000); if (nw && nw.d < 3000) best = { d: nw.d, x: nw.sx, y: nw.sy }; }
        // 작은 섬이 더 가까우면 섬에서 바깥쪽
        ent.islands.forEach(m => { const x = lo * m.kx - m.cx, y = la * m.ky - m.cy, r = Math.hypot(x, y), d = Math.max(0, r - m.a); if (r > 1 && d < 3000 && (!best || d < best.d)) best = { d, x: x / r, y: y / r }; });
        return best ? Math.round((Math.atan2(best.x, best.y) * 180 / Math.PI + 360) % 360) : null;
      };

      // 나침반·흐름 상자용: 정점 자리의 흐름을 지형 반영으로 바꿔요. 영향이 없으면 그대로
      window.currentTerrainAdjust = function (st, c) {
        window.__curTerrain = null;
        if (!c || !(c.speed > 0)) return c;
        const T = terrainFor(st); if (!T) return c;
        let v = flowAt(st.coords[1], st.coords[0], c.speed, c.to, T.isl, T.W);
        if (!v) v = flowAt(st.coords[1], st.coords[0], c.speed, c.to, T.isl, null); // 좌표가 해안선 안쪽(육지)에 찍힌 정점은 섬 효과만
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
        const T = st && cs && cs.speed > 0 && typeof isDetailMode !== 'undefined' && isDetailMode && map.getZoom() >= 13 ? terrainFor(st) : null;
        if (!T) { if (map.hasLayer(fieldLayer)) map.removeLayer(fieldLayer); return; }
        const isl = T.isl, W = T.W;
        if (!map.getPane('curFieldPane')) { const pn = map.createPane('curFieldPane'); pn.style.zIndex = 450; pn.style.pointerEvents = 'none'; }
        const sz = map.getSize(), step = 46, U = cs.speed; // [CHANGE] 간격 34 → 46px(덜 빽빽하게)
        for (let py = step / 2; py < sz.y; py += step) for (let px = step / 2; px < sz.x; px += step) {
          const ll = map.containerPointToLatLng([px, py]);
          const near = isl.length ? Math.min(...isl.map(m => Math.hypot(ll.lng * m.kx - m.cx, ll.lat * m.ky - m.cy) / m.a)) : Infinity;
          const nw = W ? nearWall(ll.lng * W.kx, ll.lat * W.ky, W, 900) : null, dW = nw ? nw.d : Infinity;
          if (near > 3.2 && dW > 900) continue; // 섬 둘레·해안 900m 안에만
          // 반투명: 섬·해안 가까이 0.5 → 바깥 0.2로 흐려짐
          const op = Math.max(0.5 - 0.3 * Math.max(0, Math.min(1, (near - 1.2) / 2)), 0.5 - 0.3 * Math.max(0, Math.min(1, (dW - 150) / 750)));
          const v = flowAt(ll.lat, ll.lng, U, cs.to, isl, W); if (!v) continue;
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
