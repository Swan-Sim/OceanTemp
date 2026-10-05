    // [ADD] 지도(위성) 위에 수심을 "지도처럼" 이어서 깔기 - api/_depth.js 수심 타일(줌 13 격자, 한 장 약 4~5km)
    //  자료: 한국 국립해양조사원 150m · 유럽 EMODnet 115m · 미국 NOAA(약 90m 간격으로 뽑음) · 그 밖 GMRT
    //  - 확대 12 이상에서 화면에 걸친 타일을 받아(서버 180일 저장) 반투명 수심 색 + 10m 간격 등심선(30·40·60m 진하게) + 숫자
    //  - 타일마다 경계 밖까지 조금 더 받아 계산한 뒤 경계에서 잘라 그려서 이음새가 안 보여요
    //  - 선과 숫자는 그림이 아니라 지도 위 선·글자라 확대해도 선명해요
    //  - 오른쪽 아래 "수심" 버튼으로 켜고 끄기(이 브라우저에 기억)
    const DEPTH_MIN_ZOOM = 12, DTILE_Z = 13, DTILE_MAX = 80, DTILE_PAR = 4;
    const dTiles = new Map(); // "x_y" → { st: 'load'|'ok'|'none', grp, lbl: [[위도, 경도, 수심]] }
    let dQueue = [], dActive = 0, dLabels = null;
    let depthOn = (() => { try { return localStorage.getItem('otemp.depthLayer') !== '0'; } catch (_) { return true; } })();
    let depthHooked = false, depthBtn = null;

    const tileX = (lon) => Math.floor((lon + 180) / 360 * 2 ** DTILE_Z);
    const tileY = (lat) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** DTILE_Z); };

    // 격자 값: 국립해양조사원은 빈 칸 = 육지(+3m), 나머지 자료는 빈 칸 = 모름(NaN)
    const gzOf = (g, nullLand) => (i, j) => { const v = g.z[i * g.cols + j]; return v == null ? (nullLand ? 3 : NaN) : v; };
    function gridSampler(g, nullLand) {
      const gz = gzOf(g, nullLand);
      return (lat, lon) => { const fi = (lat - g.la0) / g.dla, fj = (lon - g.lo0) / g.dlo; if (fi < 0 || fj < 0 || fi > g.rows - 1 || fj > g.cols - 1) return NaN;
        const i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j;
        return gz(i, j) * (1 - a) * (1 - b) + gz(i, j + 1) * (1 - a) * b + gz(i + 1, j) * a * (1 - b) + gz(i + 1, j + 1) * a * b; };
    }

    // 바탕 색: 타일 범위만 정확히 채운 256×256 그림(육지·모름은 투명)
    function depthFill(d) {
      const t = d.tile, W = 256, H = 256, sample = gridSampler(d.grid, d.nullLand);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const x = cv.getContext('2d'), img = x.createImageData(W, H);
      for (let py = 0; py < H; py++) { const lat = t.n - (py + 0.5) / H * (t.n - t.s);
        for (let px = 0; px < W; px++) { const v = sample(lat, t.w + (px + 0.5) / W * (t.e - t.w)); if (!(v < 0)) continue;
          const k = Math.min(1, -v / 60), o = (py * W + px) * 4;
          img.data[o] = 120 - 110 * k; img.data[o + 1] = 220 - 150 * k; img.data[o + 2] = 230 - 60 * k; img.data[o + 3] = Math.min(150, 40 + 110 * Math.min(1, -v / 8)) * (0.55 + 0.45 * k); } }
      x.putImageData(img, 0, 0);
      return cv.toDataURL('image/png');
    }

    // 짧은 조각들을 끝점끼리 이어 긴 선으로(지도가 아주 짧은 조각은 안 그리는 경우가 있어서)
    function joinSegs(segs) {
      const K = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7), ends = new Map(), used = new Uint8Array(segs.length), lines = [];
      segs.forEach((s, i) => [0, 1].forEach(e => { const k = K(s[e]); (ends.get(k) || ends.set(k, []).get(k)).push([i, e]); }));
      const nextFrom = (pt) => { const l = ends.get(K(pt)) || []; for (const [i, e] of l) if (!used[i]) { used[i] = 1; return segs[i][1 - e]; } return null; };
      segs.forEach((s, i) => {
        if (used[i]) return; used[i] = 1;
        const line = [s[0], s[1]];
        for (let p = nextFrom(line[line.length - 1]); p; p = nextFrom(line[line.length - 1])) line.push(p);
        for (let p = nextFrom(line[0]); p; p = nextFrom(line[0])) line.unshift(p);
        lines.push(line);
      });
      return lines;
    }

    // 등심선(마칭 스퀘어, 격자를 3배로 잘게 나눠 부드럽게). 조각 가운데가 타일 안에 있는 것만 → 이웃 타일과 겹치지 않음
    function depthContours(d) {
      const g = d.grid, t = d.tile, gz = gzOf(g, d.nullLand), U = 3, R = (g.rows - 1) * U + 1, C = (g.cols - 1) * U + 1, F = new Float32Array(R * C);
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const fi = r / U, fj = c / U, i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j;
        F[r * C + c] = gz(i, j) * (1 - a) * (1 - b) + gz(i, j + 1) * (1 - a) * b + gz(i + 1, j) * a * (1 - b) + gz(i + 1, j + 1) * a * b;
      }
      const P = (r, c) => [g.la0 + r / U * g.dla, g.lo0 + c / U * g.dlo];
      let deepest = 0; for (let k = 0; k < F.length; k++) if (F[k] < deepest) deepest = F[k];
      const keep = (s) => { const la = (s[0][0] + s[1][0]) / 2, lo = (s[0][1] + s[1][1]) / 2; return la >= t.s && la < t.n && lo >= t.w && lo < t.e; };
      const out = {};
      for (let lvl = 10; lvl <= Math.min(100, -deepest); lvl += 10) {
        const lv = -lvl + 0.013, segs = []; // 값이 정확히 -30처럼 같으면 선이 끊겨서 살짝 비켜 계산
        for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
          const v = [F[r * C + c], F[r * C + c + 1], F[(r + 1) * C + c + 1], F[(r + 1) * C + c]];
          if (isNaN(v[0]) || isNaN(v[1]) || isNaN(v[2]) || isNaN(v[3])) continue;
          const cn = [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c]], pts = [];
          for (let e = 0; e < 4; e++) { const a = v[e], b = v[(e + 1) % 4]; if ((a - lv) * (b - lv) < 0) { const k = (lv - a) / (b - a), p = cn[e], q = cn[(e + 1) % 4]; pts.push(P(p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k)); } }
          if (pts.length === 2) { if (keep(pts)) segs.push(pts); } else if (pts.length === 4) { [[pts[0], pts[1]], [pts[2], pts[3]]].forEach(s => { if (keep(s)) segs.push(s); }); }
        }
        if (segs.length) out[lvl] = joinSegs(segs);
      }
      return out;
    }

    function buildTile(d) {
      const t = d.tile, layers = [L.imageOverlay(depthFill(d), [[t.s, t.w], [t.n, t.e]], { interactive: false, className: 'depth-ov' })], lbl = [];
      const cs = depthContours(d);
      Object.keys(cs).forEach(k => {
        const strong = k === '30' || k === '40' || k === '60';
        layers.push(L.polyline(cs[k], { color: '#fff', weight: strong ? 1.8 : 0.9, opacity: strong ? 0.9 : 0.45, interactive: false, smoothFactor: 0.5 }));
        if (strong) cs[k].forEach(ln => ln.forEach((p, i) => { if (i % 6 === 3) lbl.push([p[0], p[1], +k]); }));
      });
      return { st: 'ok', grp: L.layerGroup(layers), lbl };
    }

    function loadNext() {
      while (dActive < DTILE_PAR && dQueue.length) {
        const key = dQueue.shift(), [x, y] = key.split('_');
        dActive++;
        fetch(`/api/spotobs?svc=dtile&x=${x}&y=${y}`).then(r => r.json()).then(d => {
          if (d && d.ok && d.grid) { const tl = buildTile(d); dTiles.set(key, tl); if (depthOn && leafletMap && isDetailMode && leafletMap.getZoom() >= DEPTH_MIN_ZOOM) tl.grp.addTo(leafletMap); placeDepthLabels(); }
          else dTiles.set(key, { st: 'none' });
        }).catch(() => dTiles.delete(key)).finally(() => { dActive--; loadNext(); });
      }
    }

    // 숫자: 화면 안 30·40·60m 선 위, 화면 가운데에서 가장 가까운 곳 하나씩(글자 크기는 확대와 상관없이 그대로)
    function placeDepthLabels() {
      if (!leafletMap) return;
      if (!dLabels) dLabels = L.layerGroup().addTo(leafletMap);
      dLabels.clearLayers();
      if (!depthOn || leafletMap.getZoom() < DEPTH_MIN_ZOOM) return;
      const b = leafletMap.getBounds().pad(-0.08), c = leafletMap.getCenter(), best = {};
      dTiles.forEach(tl => { if (tl.st !== 'ok') return; tl.lbl.forEach(p => { if (!b.contains([p[0], p[1]])) return; const dd = c.distanceTo([p[0], p[1]]); if (!best[p[2]] || dd < best[p[2]].d) best[p[2]] = { d: dd, p }; }); });
      Object.values(best).forEach(({ p }) => dLabels.addLayer(L.marker([p[0], p[1]], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'depth-lbl', html: `${p[2]}m`, iconSize: [30, 14], iconAnchor: [15, 7] }) })));
    }

    function refreshDepthLayers() {
      if (!leafletMap || !isDetailMode) return;
      updateDepthBtn();
      const on = depthOn && leafletMap.getZoom() >= DEPTH_MIN_ZOOM;
      dTiles.forEach(tl => { if (!tl.grp) return; const has = leafletMap.hasLayer(tl.grp); if (on && !has) tl.grp.addTo(leafletMap); else if (!on && has) leafletMap.removeLayer(tl.grp); });
      if (!on) { placeDepthLabels(); return; }
      const b = leafletMap.getBounds().pad(0.15), x0 = tileX(b.getWest()), x1 = tileX(b.getEast()), y0 = tileY(b.getNorth()), y1 = tileY(b.getSouth());
      const want = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) want.push(x + '_' + y);
      if (want.length > 40) return; // 아주 넓은 화면은 건너뜀
      dQueue = want.filter(k => !dTiles.has(k));
      dQueue.forEach(k => dTiles.set(k, { st: 'load' }));
      loadNext();
      // 오래된 타일 정리(화면에서 먼 것부터)
      if (dTiles.size > DTILE_MAX) {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        [...dTiles.keys()].map(k => { const [x, y] = k.split('_').map(Number); return [k, Math.hypot(x - cx, y - cy)]; }).sort((a, z) => z[1] - a[1])
          .slice(0, dTiles.size - DTILE_MAX).forEach(([k]) => { const tl = dTiles.get(k); if (tl.st === 'load') return; if (tl.grp) leafletMap.removeLayer(tl.grp); dTiles.delete(k); });
      }
      placeDepthLabels();
    }

    // 지도 오른쪽 아래 "수심" 켜기/끄기 버튼(확대 12 이상에서만 보임)
    function updateDepthBtn() {
      if (!leafletMap) return;
      if (!depthBtn) {
        const Ctl = L.Control.extend({ onAdd() { const d = L.DomUtil.create('button', 'depth-btn'); d.type = 'button'; L.DomEvent.disableClickPropagation(d);
          d.onclick = () => { depthOn = !depthOn; try { localStorage.setItem('otemp.depthLayer', depthOn ? '1' : '0'); } catch (_) {} refreshDepthLayers(); }; depthBtn = d; return d; } });
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
