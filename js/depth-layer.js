    // [ADD] 지도(위성)에서 포인트 주변 수심을 바로 보여주기 - api/_depth.js 격자(한국 150m, 유럽 115m, 미국 수 m, 그 밖 GMRT)
    //  - 확대 13 이상에서, 화면 안 포인트(최대 8곳) 주변 약 ±1.3km에 반투명 수심 색 + 10m 간격 선(30·40·60m는 진하게) + 숫자
    //  - 포인트마다 처음 한 번 받아 두고(서버 180일 저장, 브라우저는 이번 방문 동안) 다시 쓰지 않아요
    //  - 오른쪽 아래 "수심" 버튼으로 켜고 끄기(이 브라우저에 기억)
    const DEPTH_MIN_ZOOM = 13, DEPTH_MAX_SPOTS = 8;
    const depthLayers = new Map(), depthCenters = new Map(); // station.id → L.imageOverlay / 중심
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

    // 격자 → 반투명 그림(육지·자료 없는 칸은 투명)
    function depthCanvas(g) {
      const S = Math.max(4, Math.min(12, Math.round(360 / Math.max(g.rows, g.cols))));
      const W = (g.cols - 1) * S, H = (g.rows - 1) * S;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const x = cv.getContext('2d'), img = x.createImageData(W, H), Z = new Float32Array(W * H);
      const zAt = (fi, fj) => { const i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j;
        const q = [g.z[i * g.cols + j], g.z[i * g.cols + j + 1], g.z[(i + 1) * g.cols + j], g.z[(i + 1) * g.cols + j + 1]];
        if (q.every(v => v == null)) return NaN; for (let k = 0; k < 4; k++) if (q[k] == null) q[k] = 3;
        return q[0] * (1 - a) * (1 - b) + q[1] * (1 - a) * b + q[2] * a * (1 - b) + q[3] * a * b; };
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) Z[py * W + px] = zAt((H - 1 - py) / S, px / S); // 위쪽이 북쪽
      const band = (v) => Math.floor(-v / 10);
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        const v = Z[py * W + px], o = (py * W + px) * 4;
        if (!(v < 0)) continue; // 육지·자료 없음: 투명
        const t = Math.min(1, -v / 60);
        let r = 120 - 110 * t, gg = 220 - 150 * t, b = 230 - 60 * t, al = 70 + 70 * t;
        const rv = px < W - 1 ? Z[py * W + px + 1] : v, dv = py < H - 1 ? Z[(py + 1) * W + px] : v;
        const nb = [rv, dv].filter(n => n < 0 && band(n) !== band(v)).map(band);
        if (nb.length) { const m = Math.max(band(v), ...nb); if (m === 3 || m === 4 || m === 6) { r = gg = b = 255; al = 235; } else { r = gg = b = 235; al = 150; } }
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = al;
      }
      x.putImageData(img, 0, 0);
      // 진한 선(30·40·60m) 위에 숫자 몇 개
      x.font = `bold ${Math.max(10, S + 4)}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 3;
      [30, 40, 60].forEach(d => {
        const hits = [];
        for (let py = 6; py < H - 6; py += 3) for (let px = 10; px < W - 10; px += 3) { const v = Z[py * W + px], r = Z[py * W + px + 3];
          if (v < 0 && r < 0 && (-v - d) * (-r - d) < 0) hits.push([px, py]); }
        const picked = [];
        for (const h of hits) { if (picked.length >= 2) break; if (picked.every(p => Math.hypot(p[0] - h[0], p[1] - h[1]) > W / 3)) picked.push(h); }
        picked.forEach(([px, py]) => { x.strokeStyle = 'rgba(7,11,20,.8)'; x.strokeText(d + 'm', px, py); x.fillStyle = '#fff'; x.fillText(d + 'm', px, py); });
      });
      return cv.toDataURL('image/png');
    }

    async function addDepthLayer(st) {
      if (depthLayers.has(st.id)) return;
      depthLayers.set(st.id, null); // 받는 중 표시(중복 요청 방지)
      const j = await depthGridFor(st);
      if (!j || !leafletMap || !depthOn) { depthLayers.delete(st.id); if (!j) { depthLayers.set(st.id, null); depthCenters.delete(st.id); } return; }
      const g = j.grid, hla = g.dla / 2, hlo = g.dlo / 2;
      const bounds = [[g.la0 - hla, g.lo0 - hlo], [g.la0 + (g.rows - 1) * g.dla + hla, g.lo0 + (g.cols - 1) * g.dlo + hlo]];
      const ov = L.imageOverlay(depthCanvas(g), bounds, { opacity: 0.85, interactive: false, className: 'depth-ov' }).addTo(leafletMap);
      depthLayers.set(st.id, ov);
      if (typeof selectedStation !== 'undefined' && selectedStation === st && typeof setFootInfo === 'function' && typeof footText !== 'undefined') setFootInfo(footText);
    }
    function clearDepthLayers() { depthLayers.forEach(ov => { if (ov && leafletMap) leafletMap.removeLayer(ov); }); depthLayers.clear(); depthCenters.clear(); }

    function refreshDepthLayers() {
      if (!leafletMap || !isDetailMode) return;
      updateDepthBtn();
      if (!depthOn || leafletMap.getZoom() < DEPTH_MIN_ZOOM) { depthLayers.forEach(ov => { if (ov) ov.setOpacity(0); }); return; }
      depthLayers.forEach(ov => { if (ov) ov.setOpacity(0.85); });
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
