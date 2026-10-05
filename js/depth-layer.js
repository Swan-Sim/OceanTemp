    // [ADD] 지도(위성) 위에 수심을 "지도처럼" 이어서 깔기 - api/_depth.js 수심 벡터 타일(줌 13 격자, 한 장 약 4~5km)
    //  서버가 등심선·수심 띠를 미리 다각형/선으로 만들어 저장해 두고(180일, CDN 30일), 앱은 그리기만 해서 빠르고 확대해도 선명해요
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

    // 서버가 미리 만들어 둔 벡터(다각형·선)를 그대로 그리기만 해요 - 일러스트처럼 단색 띠가 깊을수록 겹쳐 진해짐
    const DFILL = { 1: ['#7dd3fc', 0.16], 10: ['#38bdf8', 0.13], 20: ['#0ea5e9', 0.13], 30: ['#0284c7', 0.13], 40: ['#0369a1', 0.13], 50: ['#075985', 0.13], 60: ['#0c4a6e', 0.15], 80: ['#082f49', 0.15], 100: ['#041e33', 0.17] };
    function buildTile(d) {
      const layers = [];
      (d.fills || []).forEach(f => { const c = DFILL[f.d] || ['#0c4a6e', 0.14]; layers.push(L.polygon(f.p, { stroke: false, fillColor: c[0], fillOpacity: c[1], interactive: false, smoothFactor: 0.3 })); });
      Object.keys(d.lines || {}).forEach(k => {
        const strong = k === '30' || k === '40' || k === '60';
        layers.push(L.polyline(d.lines[k], { color: '#fff', weight: strong ? 1.6 : 0.8, opacity: strong ? 0.85 : 0.4, interactive: false, smoothFactor: 0.3 }));
      });
      return { st: 'ok', grp: L.layerGroup(layers), lbl: d.lbl || [] };
    }

    function loadNext() {
      while (dActive < DTILE_PAR && dQueue.length) {
        const key = dQueue.shift(), [x, y] = key.split('_');
        dActive++;
        fetch(`/api/spotobs?svc=dvec&x=${x}&y=${y}`).then(r => r.json()).then(d => {
          if (d && d.ok && !d.empty && (d.fills || d.lines)) { const tl = buildTile(d); dTiles.set(key, tl); if (depthOn && leafletMap && isDetailMode && leafletMap.getZoom() >= DEPTH_MIN_ZOOM) tl.grp.addTo(leafletMap); placeDepthLabels(); }
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
