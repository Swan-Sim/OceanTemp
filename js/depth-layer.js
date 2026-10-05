    // [ADD] 지도(위성)에서 포인트 주변 수심을 바로 보여주기 - api/_depth.js 격자(한국 150m, 유럽 115m, 미국 수 m, 그 밖 GMRT)
    //  - 확대 13 이상에서, 화면 안 포인트(최대 8곳) 주변 약 ±1.3km에 반투명 수심 색(작은 그림) + 10m 간격 등심선(벡터, 30·40·60m 진하게) + 숫자(글자)
    //    선과 숫자는 그림이 아니라 지도 위 선·글자로 그려서 아무리 확대해도 선명해요
    //  - 포인트마다 처음 한 번 받아 두고(서버 180일 저장, 브라우저는 이번 방문 동안) 다시 쓰지 않아요
    //  - 오른쪽 아래 "수심" 버튼으로 켜고 끄기(이 브라우저에 기억)
    const DEPTH_MIN_ZOOM = 13, DEPTH_MAX_SPOTS = 8;
    const depthLayers = new Map(), depthCenters = new Map(); // station.id → L.layerGroup(바탕+선+숫자) / 중심
    let depthOn = (() => { try { return localStorage.getItem('otemp.depthLayer') !== '0'; } catch (_) { return true; } })();
    let depthHooked = false, depthBtn = null;

    function depthGridFor(st) {
      if (st._depthGridP) return st._depthGridP;
      st._depthGridP = fetch(`/api/spotobs?svc=depth&lat=${st.coords[1].toFixed(4)}&lon=${st.coords[0].toFixed(4)}`)
        .then(r => r.json()).then(j => {
          if (j && j.ok && j.grid) { if (!st._depth) st._depth = { ok: true, max300: j.max300, avg300: j.avg300, max1k: j.max1k, srcShort: j.srcShort, res: j.res }; return j; }
          return null;
        }).catch(() => null);
      return st._depthGridP;
    }

    // 격자 값(빈 칸 = 육지 +3m)
    const gz = (g, i, j) => { const v = g.z[i * g.cols + j]; return v == null ? 3 : v; };

    // 바탕 색만 작은 그림으로(선·숫자는 확대해도 선명하게 아래에서 벡터로 그려요). 육지는 투명, 확대하면 부드럽게 늘어남
    function depthFill(g) {
      const S = 4, W = (g.cols - 1) * S + 1, H = (g.rows - 1) * S + 1;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const x = cv.getContext('2d'), img = x.createImageData(W, H);
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        const fi = (H - 1 - py) / S, fj = px / S, i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j;
        const v = gz(g, i, j) * (1 - a) * (1 - b) + gz(g, i, j + 1) * (1 - a) * b + gz(g, i + 1, j) * a * (1 - b) + gz(g, i + 1, j + 1) * a * b;
        if (!(v < 0)) continue;
        const t = Math.min(1, -v / 60), o = (py * W + px) * 4;
        img.data[o] = 120 - 110 * t; img.data[o + 1] = 220 - 150 * t; img.data[o + 2] = 230 - 60 * t; img.data[o + 3] = Math.min(150, 40 + 110 * Math.min(1, -v / 8)) * (0.55 + 0.45 * t);
      }
      x.putImageData(img, 0, 0);
      return cv.toDataURL('image/png');
    }

    // 등심선(마칭 스퀘어). 격자를 3배로 촘촘히(쌍선형) 나눈 뒤 10m 간격 선 → [[위도,경도],[위도,경도]] 조각들
    function depthContours(g) {
      const U = 3, R = (g.rows - 1) * U + 1, C = (g.cols - 1) * U + 1, F = new Float32Array(R * C);
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const fi = r / U, fj = c / U, i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j;
        F[r * C + c] = gz(g, i, j) * (1 - a) * (1 - b) + gz(g, i, j + 1) * (1 - a) * b + gz(g, i + 1, j) * a * (1 - b) + gz(g, i + 1, j + 1) * a * b;
      }
      const P = (r, c) => [g.la0 + r / U * g.dla, g.lo0 + c / U * g.dlo];
      const deepest = Math.min(...F), out = {};
      for (let L = 10; L <= Math.min(100, -deepest); L += 10) {
        const lv = -L, segs = [];
        for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
          const v = [F[r * C + c], F[r * C + c + 1], F[(r + 1) * C + c + 1], F[(r + 1) * C + c]]; // 반시계: 좌하, 우하, 우상, 좌상
          const cn = [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c]], pts = [];
          for (let e = 0; e < 4; e++) { const a = v[e], b = v[(e + 1) % 4]; if ((a - lv) * (b - lv) < 0) { const t = (lv - a) / (b - a), p = cn[e], q = cn[(e + 1) % 4]; pts.push(P(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)); } }
          if (pts.length === 2) segs.push(pts); else if (pts.length === 4) { segs.push([pts[0], pts[1]]); segs.push([pts[2], pts[3]]); }
        }
        if (segs.length) out[L] = segs;
      }
      return out;
    }

    async function addDepthLayer(st) {
      if (depthLayers.has(st.id)) return;
      depthLayers.set(st.id, null); // 받는 중 표시(중복 요청 방지)
      const j = await depthGridFor(st);
      if (!j || !leafletMap || !depthOn) { depthLayers.delete(st.id); if (!j) { depthLayers.set(st.id, null); depthCenters.delete(st.id); } return; }
      const g = j.grid, hla = g.dla / 2, hlo = g.dlo / 2;
      const bounds = [[g.la0 - hla, g.lo0 - hlo], [g.la0 + (g.rows - 1) * g.dla + hla, g.lo0 + (g.cols - 1) * g.dlo + hlo]];
      const layers = [L.imageOverlay(depthFill(g), [[g.la0, g.lo0], [g.la0 + (g.rows - 1) * g.dla, g.lo0 + (g.cols - 1) * g.dlo]], { interactive: false, className: 'depth-ov' })];
      const cs = depthContours(g), here = L.latLng(st.coords[1], st.coords[0]);
      Object.keys(cs).forEach(k => {
        const strong = k === '30' || k === '40' || k === '60';
        layers.push(L.polyline(cs[k], { color: '#fff', weight: strong ? 1.8 : 0.9, opacity: strong ? 0.9 : 0.45, interactive: false, smoothFactor: 0.5 }));
        if (!strong) return;
        // 숫자: 포인트에서 150m 넘게 떨어진 선 위, 가장 가까운 곳 한 군데(글자 크기는 확대해도 그대로)
        let best = null, bd = 1e9;
        cs[k].forEach(sg => { const m = L.latLng((sg[0][0] + sg[1][0]) / 2, (sg[0][1] + sg[1][1]) / 2), d = here.distanceTo(m); if (d > 150 && d < bd) { bd = d; best = m; } });
        if (best) layers.push(L.marker(best, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'depth-lbl', html: `${k}m`, iconSize: [30, 14], iconAnchor: [15, 7] }) }));
      });
      const grp = L.layerGroup(layers);
      grp._bounds = bounds;
      depthLayers.set(st.id, grp);
      if (leafletMap.getZoom() >= DEPTH_MIN_ZOOM) grp.addTo(leafletMap);
      if (typeof selectedStation !== 'undefined' && selectedStation === st && typeof setFootInfo === 'function' && typeof footText !== 'undefined') setFootInfo(footText);
    }
    function clearDepthLayers() { depthLayers.forEach(gr => { if (gr && leafletMap) leafletMap.removeLayer(gr); }); depthLayers.clear(); depthCenters.clear(); }

    function refreshDepthLayers() {
      if (!leafletMap || !isDetailMode) return;
      updateDepthBtn();
      if (!depthOn || leafletMap.getZoom() < DEPTH_MIN_ZOOM) { depthLayers.forEach(gr => { if (gr && leafletMap.hasLayer(gr)) leafletMap.removeLayer(gr); }); return; }
      depthLayers.forEach(gr => { if (gr && !leafletMap.hasLayer(gr)) gr.addTo(leafletMap); });
      const b = leafletMap.getBounds().pad(0.3), c = leafletMap.getCenter();
      stations.filter(s => s.isBeach && !/^River/.test(s.network || '') && b.contains([s.coords[1], s.coords[0]]))
        .sort((a, z) => leafletMap.distance(c, [a.coords[1], a.coords[0]]) - leafletMap.distance(c, [z.coords[1], z.coords[0]]))
        .forEach(s => { // 이미 그린(또는 받는 중인) 포인트 800m 안이면 겹치니 건너뜀, 한 화면에 최대 8곳
          if (depthLayers.has(s.id) || depthLayers.size >= 80) return;
          let n = 0; for (const o of depthCenters.values()) { if (leafletMap.distance(o, [s.coords[1], s.coords[0]]) < 800) return; if (b.contains(o)) n++; }
          if (n >= DEPTH_MAX_SPOTS) return;
          depthCenters.set(s.id, [s.coords[1], s.coords[0]]); addDepthLayer(s); });
    }

    // 지도 오른쪽 아래 "수심" 켜기/끄기 버튼(확대 13 이상에서만 보임)
    function updateDepthBtn() {
      if (!leafletMap) return;
      if (!depthBtn) {
        const Ctl = L.Control.extend({ onAdd() { const d = L.DomUtil.create('button', 'depth-btn'); d.type = 'button'; L.DomEvent.disableClickPropagation(d);
          d.onclick = () => { depthOn = !depthOn; try { localStorage.setItem('otemp.depthLayer', depthOn ? '1' : '0'); } catch (_) {} if (!depthOn) clearDepthLayers(); refreshDepthLayers(); }; depthBtn = d; return d; } });
        new Ctl({ position: 'bottomright' }).addTo(leafletMap);
      }
      depthBtn.style.display = leafletMap.getZoom() >= DEPTH_MIN_ZOOM ? '' : 'none';
      depthBtn.classList.toggle('on', depthOn);
      depthBtn.textContent = (t.depthLayer || '수심') + (depthOn ? ' ON' : ' OFF');
    }

    (function hookDepthLayer() {
      const f = window.showDetailMap;
      if (typeof f !== 'function') return;
      window.showDetailMap = function () {
        const r = f.apply(this, arguments);
        try {
          if (leafletMap && !depthHooked) { depthHooked = true; leafletMap.on('moveend zoomend', refreshDepthLayers); }
          setTimeout(refreshDepthLayers, 500);
        } catch (_) {}
        return r;
      };
    })();
