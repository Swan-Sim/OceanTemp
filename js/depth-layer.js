    // [ADD] 지도(위성) 위에 수심을 "타일 이미지"처럼 부드럽게 깔기 - api/_depth.js 수심 타일(줌 13 격자, 한 장 약 4~5km)
    //  서버가 등심선·수심 띠를 0~4096 타일 좌표로 미리 계산·압축해 저장(Redis 180일, CDN 30일)해 두고,
    //  앱은 Leaflet 네이티브 L.GridLayer로 각 화면 타일을 <canvas> 비트맵 이미지로 한 번만 그려 GPU로 이동·확대해요.
    //  - 드래그·핀치줌 중에는 벡터를 다시 그리지 않아 모바일에서도 60fps 유지(updateWhenIdle / updateWhenZooming: false)
    //  - 배율별 순차 표시: 줌 12(색상 띠 + 10·20·30·40m 주요선) → 줌 13(+60·80·100m) → 줌 14+(2·5m 얕은 점선 + 전체 등심선 + 고해상도)
    //  - 화면 밖으로 나간 타일은 Leaflet이 자동 정리해 메모리가 쌓이지 않아요.
    //  - 오른쪽 아래 "수심" 버튼으로 켜고 끄기(이 브라우저에 기억)
    const DEPTH_MIN_ZOOM = 12, DTILE_Z = 13, DCACHE_MAX = 120;
    const DTILE_PAR = (typeof window !== 'undefined' && window.innerWidth < 600) ? 4 : 6;
    const dCache = new Map(); // "x_y" → { st: 'load'|'ok'|'none', raw, lbl, touched }
    const dWaiters = new Map(); // "x_y" → Set<fn> (현재 화면에 떠 있는 타일 캔버스 콜백)
    const dFails = new Map(); // "x_y" → 실패 횟수
    const RETRY_MS = [15000, 45000, 120000, 240000];
    const dRefresh = new Set(), dRefreshed = new Set();
    let dQueue = [], dActive = 0, dLabels = null, dLabelTimer = null;
    let depthGridLayer = null, depthHooked = false, depthBtn = null;
    // [CHANGE] 임시: 서버 CPU 절약을 위해 수심 지도는 기본 꺼짐. 사용자가 [수심 OFF] 버튼을 눌러 켜야 보여요.
    let depthOn = (() => { try { return localStorage.getItem('otemp.depthLayer2') === '1'; } catch (_) { return false; } })();

    const tileX = (lon) => Math.floor((lon + 180) / 360 * (1 << DTILE_Z));
    const tileY = (lat) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << DTILE_Z)); };

    // 수심 띠 색 (깊을수록 반투명 단색이 겹쳐 진해짐)
    const DFILL = { 1: ['#a5f3fc', 0.10], 5: ['#7dd3fc', 0.12], 10: ['#38bdf8', 0.09], 20: ['#0ea5e9', 0.09], 30: ['#0284c7', 0.09], 40: ['#0369a1', 0.09], 50: ['#075985', 0.09], 60: ['#0c4a6e', 0.1], 80: ['#082f49', 0.1], 100: ['#041e33', 0.12], 120: ['#03182b', 0.12], 150: ['#021224', 0.14] };

    // [ADD] 포인트 현지 지형(관리자 입력)이 이 타일에 걸리면 주소에 짧은 표시를 붙여요(서버 api/_depth.js profSig와 같은 계산)
    function profParam(x, y) {
      const n = 1 << DTILE_Z, lon = (v) => v / n * 360 - 180, lat = (v) => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
      const b = { s: lat(y + 1), n: lat(y), w: lon(x), e: lon(x + 1) }, E = 0.02;
      const str = (typeof stations !== 'undefined' ? stations : []).filter(st => st.prof && st.no && st.coords && st.coords[1] >= b.s - E && st.coords[1] <= b.n + E && st.coords[0] >= b.w - E && st.coords[0] <= b.e + E)
        .map(st => { const q = st.prof; return `${st.no}:${q.top}/${q.r}/${(q.secs || []).map(x => [x.a0, x.a1, x.deg, x.max].join(',')).join(';')}/${q.els ? [q.els.deg, q.els.max].join(',') : ''}`; }).sort().join('|');
      if (!str) return '';
      let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
      return '&p=' + h.toString(36);
    }
    const fixParam = () => { const f = window.otDepthFix || [], o = window.otDepthOff || {}, off = (o.prof ? 'p' : '') + (o.fix ? 'f' : '') + (o.land ? 'l' : ''); if (!f.length && !off) return ''; const str = f.map(x => `${x.la}/${x.lo}/${x.r}/${x.min}`).sort().join(',') + '#' + off; let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return '&f=' + h.toString(36); };
    let lastFix = fixParam();
    window.addEventListener('otemp:site', () => {
      const n = fixParam(); if (n === lastFix) return;
      lastFix = n; dCache.clear(); dQueue = []; dFails.clear();
      if (depthGridLayer && leafletMap && leafletMap.hasLayer(depthGridLayer)) depthGridLayer.redraw();
      scheduleDepthLabels();
    });
    const DV_MODE = (() => { try { const v = new URLSearchParams(location.search).get('dv'); return ['1', '2', '3'].includes(v) ? v : ''; } catch (_) { return ''; } })();

    // 압축된 v2 등심선에서 숫자 후보([lat, lon, depth]) 한 번만 뽑아두기
    function extractLabels(d) {
      const t = d && d.tile; if (!t) return [];
      const out = [];
      const toLat = (qy) => t.n - qy / 4096 * (t.n - t.s);
      const toLon = (qx) => t.w + qx / 4096 * (t.e - t.w);
      if (d.v === 2 && d.Ln) {
        Object.keys(d.Ln).forEach(k => {
          const depth = +k; if (!depth || depth < 5) return;
          (d.Ln[k] || []).forEach(arr => {
            let x = 0, y = 0, pt = 0;
            for (let i = 0; i < arr.length; i += 2, pt++) {
              x += arr[i]; y += arr[i + 1];
              if (pt % 6 === 3) out.push([toLat(y), toLon(x), depth]);
            }
          });
        });
      }
      if (!out.length && Array.isArray(d.lb)) {
        d.lb.forEach(([qx, qy, k]) => out.push([toLat(qy), toLon(qx), +k]));
      }
      return out;
    }

    // LRU 정리 (최대 DCACHE_MAX장 유지)
    function pruneCache() {
      if (dCache.size <= DCACHE_MAX) return;
      const entries = [...dCache.entries()].filter(([k, v]) => v.st !== 'load' && !(dWaiters.get(k) && dWaiters.get(k).size))
        .sort((a, b) => (a[1].touched || 0) - (b[1].touched || 0));
      let over = dCache.size - DCACHE_MAX;
      for (let i = 0; i < entries.length && over > 0; i++, over--) dCache.delete(entries[i][0]);
    }

    function notifyWaiters(key, entry) {
      const ws = dWaiters.get(key);
      if (!ws) return;
      dWaiters.delete(key);
      ws.forEach(fn => { try { fn(entry); } catch (_) {} });
    }

    function failTile(key, why) {
      const n = (dFails.get(key) || 0) + 1; dFails.set(key, n);
      dCache.delete(key);
      notifyWaiters(key, { st: 'none', why });
      if (n > RETRY_MS.length) { dCache.set(key, { st: 'none', why, touched: Date.now() }); return; }
      setTimeout(() => {
        if (!dCache.has(key) && depthOn && leafletMap && isDetailMode && depthGridLayer && leafletMap.hasLayer(depthGridLayer)) {
          depthGridLayer.redraw();
        }
      }, RETRY_MS[n - 1]);
    }

    function loadNext() {
      while (dActive < DTILE_PAR && dQueue.length) {
        const key = dQueue.shift();
        // 이미 화면에서 빠져 대기자가 없으면(단, rf 백그라운드 갱신 제외) 건너뜀
        if (!dRefresh.has(key) && !(dWaiters.get(key) && dWaiters.get(key).size)) {
          const cur = dCache.get(key);
          if (cur && cur.st === 'load') dCache.delete(key);
          continue;
        }
        const [x, y] = key.split('_');
        dActive++;
        const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const tm = setTimeout(() => { try { ac && ac.abort(); } catch (_) {} }, 55000);
        const rf = dRefresh.has(key);
        fetch(`/api/spotobs?svc=dvec&x=${x}&y=${y}&v=26${profParam(+x, +y)}${fixParam()}${DV_MODE ? '&m=' + DV_MODE : ''}${rf ? '&rf=1' : ''}`, ac ? { signal: ac.signal } : undefined)
          .then(r => r.json())
          .then(d => {
            if (rf) {
              if (d && d.ok && !d.empty && !d.stale && (d.F || d.Ln)) {
                dCache.set(key, { st: 'ok', raw: d, lbl: extractLabels(d), touched: Date.now() });
                if (depthGridLayer && leafletMap && leafletMap.hasLayer(depthGridLayer)) depthGridLayer.redraw();
                scheduleDepthLabels();
              }
              return;
            }
            if (d && d.ok && d.stale && !d.tried && !dRefreshed.has(key)) {
              dRefreshed.add(key);
              setTimeout(() => {
                if (depthOn && leafletMap && isDetailMode) { dRefresh.add(key); dQueue.push(key); loadNext(); }
              }, 4000);
            }
            if (d && d.wait) {
              const e = { st: 'none', why: 'tried_today', touched: Date.now() };
              dCache.set(key, e); notifyWaiters(key, e); return;
            }
            if (d && d.ok && !d.empty && (d.F || d.Ln)) {
              const e = { st: 'ok', raw: d, lbl: extractLabels(d), touched: Date.now() };
              dCache.set(key, e); dFails.delete(key); pruneCache();
              notifyWaiters(key, e);
              scheduleDepthLabels();
            } else if (d && d.ok && d.empty) {
              const e = { st: 'none', touched: Date.now() };
              dCache.set(key, e); notifyWaiters(key, e);
            } else {
              failTile(key, (d && d.error) || (d && d.retry ? 'retry' : 'fail'));
            }
          })
          .catch((e) => { if (!rf) failTile(key, String(e && e.name || e)); })
          .finally(() => { clearTimeout(tm); dRefresh.delete(key); dActive--; loadNext(); });
      }
    }

    function requestVecTile(key, onReady) {
      const cur = dCache.get(key);
      if (cur && cur.st !== 'load') {
        cur.touched = Date.now();
        let canceled = false;
        Promise.resolve().then(() => { if (!canceled) onReady(cur); });
        return () => { canceled = true; };
      }
      let ws = dWaiters.get(key);
      if (!ws) { ws = new Set(); dWaiters.set(key, ws); }
      ws.add(onReady);
      if (!cur) {
        dCache.set(key, { st: 'load', touched: Date.now() });
        dQueue.push(key);
        if (leafletMap) {
          const c = leafletMap.getCenter(), cx = tileX(c.lng), cy = tileY(c.lat);
          dQueue.sort((a, z) => {
            const [ax, ay] = a.split('_'), [zx, zy] = z.split('_');
            return Math.hypot(+ax - cx, +ay - cy) - Math.hypot(+zx - cx, +zy - cy);
          });
        }
        loadNext();
      }
      return () => { const s = dWaiters.get(key); if (s) s.delete(onReady); };
    }

    // 0~4096 타일 좌표(delta-encoded)를 <canvas>의 [ox, oy, subW, subH] 영역에 직접 그리기 (투영/벡터객체 0)
    function drawVecChunk(ctx, d, z, dpr, u0, v0, span, ox, oy, subW, subH) {
      if (!d || d.v !== 2) return;
      const kx = subW / span, ky = subH / span;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, subW, subH);
      ctx.clip();

      // 1) 수심 띠 채우기 (F: [depth, [poly, ...]], poly = [outerRing, hole...])
      if (Array.isArray(d.F)) {
        for (let fi = 0; fi < d.F.length; fi++) {
          const [depth, polys] = d.F[fi];
          const c = DFILL[depth] || ['#0c4a6e', 0.1];
          ctx.fillStyle = c[0];
          ctx.globalAlpha = c[1];
          ctx.beginPath();
          for (let pi = 0; pi < polys.length; pi++) {
            const poly = polys[pi];
            for (let ri = 0; ri < poly.length; ri++) {
              const arr = poly[ri];
              if (arr.length < 6) continue;
              let x = arr[0], y = arr[1];
              ctx.moveTo((x - u0) * kx + ox, (y - v0) * ky + oy);
              for (let i = 2; i < arr.length; i += 2) {
                x += arr[i]; y += arr[i + 1];
                ctx.lineTo((x - u0) * kx + ox, (y - v0) * ky + oy);
              }
              ctx.closePath();
            }
          }
          ctx.fill('evenodd');
        }
      }

      // 2) 등심선 (배율별 순차 표시: 줌 12 → 10·20·30·40m / 줌 13 → +60·80·100m / 줌 14+ → 2·5m 점선 포함 전체)
      if (d.Ln) {
        const allowZ12 = { '10': 1, '20': 1, '30': 1, '40': 1 };
        const allowZ13 = { '10': 1, '20': 1, '30': 1, '40': 1, '60': 1, '80': 1, '100': 1 };
        ctx.strokeStyle = '#ffffff';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const keys = Object.keys(d.Ln);
        for (let ki = 0; ki < keys.length; ki++) {
          const k = keys[ki];
          if (z <= 12 && !allowZ12[k]) continue;
          if (z === 13 && !allowZ13[k]) continue;
          const lines = d.Ln[k];
          if (!lines || !lines.length) continue;
          const depth = +k;
          const strong = k === '10' || k === '20' || k === '30' || k === '40';
          const shallow = depth < 10;
          ctx.lineWidth = (strong ? 1.5 : shallow ? 0.9 : 0.8) * dpr;
          ctx.globalAlpha = strong ? 0.85 : shallow ? 0.6 : 0.42;
          ctx.setLineDash(shallow ? [3 * dpr, 4 * dpr] : []);
          ctx.beginPath();
          for (let li = 0; li < lines.length; li++) {
            const arr = lines[li];
            if (arr.length < 4) continue;
            let x = arr[0], y = arr[1];
            ctx.moveTo((x - u0) * kx + ox, (y - v0) * ky + oy);
            for (let i = 2; i < arr.length; i += 2) {
              x += arr[i]; y += arr[i + 1];
              ctx.lineTo((x - u0) * kx + ox, (y - v0) * ky + oy);
            }
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // 3) 섬·바위 해안선 (흰 실선)
      if (Array.isArray(d.Ld) && d.Ld.length) {
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.0 * dpr;
        ctx.beginPath();
        for (let ri = 0; ri < d.Ld.length; ri++) {
          const arr = d.Ld[ri];
          if (arr.length < 6) continue;
          let x = arr[0], y = arr[1];
          ctx.moveTo((x - u0) * kx + ox, (y - v0) * ky + oy);
          for (let i = 2; i < arr.length; i += 2) {
            x += arr[i]; y += arr[i + 1];
            ctx.lineTo((x - u0) * kx + ox, (y - v0) * ky + oy);
          }
          ctx.closePath();
        }
        ctx.stroke();
      }

      ctx.restore();
    }

    function createDepthGridLayer() {
      const Layer = L.GridLayer.extend({
        createTile(coords, done) {
          const tile = document.createElement('canvas');
          const z = coords.z;
          const dpr = z >= 14 ? Math.min(window.devicePixelRatio || 1, 2) : 1;
          const sz = 256 * dpr;
          tile.width = sz;
          tile.height = sz;
          tile.style.width = '256px';
          tile.style.height = '256px';
          const ctx = tile.getContext('2d');
          const cancels = [];
          tile._depthCancels = cancels;

          if (!ctx || z < DEPTH_MIN_ZOOM) { setTimeout(() => done(null, tile), 0); return tile; }

          if (z >= DTILE_Z) {
            const scale = 1 << (z - DTILE_Z);
            const x13 = Math.floor(coords.x / scale), y13 = Math.floor(coords.y / scale);
            const rx = ((coords.x % scale) + scale) % scale, ry = ((coords.y % scale) + scale) % scale;
            const span = 4096 / scale, u0 = rx * span, v0 = ry * span;
            const key = x13 + '_' + y13;
            const cancel = requestVecTile(key, (entry) => {
              if (entry && entry.st === 'ok' && entry.raw) {
                drawVecChunk(ctx, entry.raw, z, dpr, u0, v0, span, 0, 0, sz, sz);
              }
              done(null, tile);
            });
            if (cancel) cancels.push(cancel);
          } else {
            // z === 12: 2×2 개의 Z13 타일을 한 장의 256×256 이미지 타일에 합성
            const half = sz / 2;
            let left = 4;
            const finishOne = () => { if (--left === 0) done(null, tile); };
            for (let oy = 0; oy < 2; oy++) {
              for (let ox = 0; ox < 2; ox++) {
                const key = (coords.x * 2 + ox) + '_' + (coords.y * 2 + oy);
                const px = ox * half, py = oy * half;
                const cancel = requestVecTile(key, (entry) => {
                  if (entry && entry.st === 'ok' && entry.raw) {
                    drawVecChunk(ctx, entry.raw, z, dpr, 0, 0, 4096, px, py, half, half);
                  }
                  finishOne();
                });
                if (cancel) cancels.push(cancel);
              }
            }
          }
          return tile;
        }
      });
      const layer = new Layer({
        tileSize: 256,
        minZoom: DEPTH_MIN_ZOOM,
        maxZoom: 18,
        keepBuffer: 1,
        updateWhenIdle: true,
        updateWhenZooming: false,
        zIndex: 220
      });
      layer.on('tileunload', (ev) => {
        const cs = ev && ev.tile && ev.tile._depthCancels;
        if (cs) { cs.forEach(fn => fn()); ev.tile._depthCancels = null; }
      });
      return layer;
    }

    // 수심 숫자 라벨: 디바운스(160ms) + 현재 화면 안 Z13 타일만 스캔해 1ms 미만으로 가볍게 배치
    function scheduleDepthLabels() {
      if (dLabelTimer) clearTimeout(dLabelTimer);
      dLabelTimer = setTimeout(placeDepthLabels, 160);
    }
    function placeDepthLabels() {
      dLabelTimer = null;
      if (!leafletMap) return;
      if (!dLabels) dLabels = L.layerGroup().addTo(leafletMap);
      dLabels.clearLayers();
      const z = leafletMap.getZoom();
      if (!depthOn || !isDetailMode || z < DEPTH_MIN_ZOOM) return;
      const b = leafletMap.getBounds().pad(-0.06), c = leafletMap.getCenter();
      const x0 = tileX(b.getWest()), x1 = tileX(b.getEast()), y0 = tileY(b.getNorth()), y1 = tileY(b.getSouth());
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return;
      const cand = {};
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const tl = dCache.get(x + '_' + y);
          if (!tl || tl.st !== 'ok' || !tl.lbl) continue;
          for (let i = 0; i < tl.lbl.length; i++) {
            const p = tl.lbl[i];
            if (z <= 12 && p[2] > 40) continue;
            if (!b.contains([p[0], p[1]])) continue;
            (cand[p[2]] = cand[p[2]] || []).push([c.distanceTo([p[0], p[1]]), p]);
          }
        }
      }
      const placed = [], maxLbl = leafletMap.getSize().x < 520 ? 16 : 30;
      const levels = Object.keys(cand).map(Number).sort((a, z2) => a - z2), KEY = [5, 10, 20, 30, 40];
      levels.forEach(k => cand[k].sort((a, z2) => a[0] - z2[0]));
      const put = (k, gap) => {
        if (placed.length >= maxLbl) return;
        for (const [, p] of cand[k]) {
          const px = leafletMap.latLngToContainerPoint([p[0], p[1]]);
          if (placed.every(q => q.distanceTo(px) > gap)) {
            placed.push(px);
            dLabels.addLayer(L.marker([p[0], p[1]], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'depth-lbl' + (KEY.includes(k) ? '' : ' sm'), html: `${k}m`, iconSize: [30, 14], iconAnchor: [15, 7] }) }));
            return;
          }
        }
      };
      KEY.forEach(k => { if (cand[k]) put(k, 42); });
      levels.filter(k => !KEY.includes(k)).forEach(k => put(k, 64));
      levels.forEach(k => put(k, 160));
    }

    function refreshDepthLayers() {
      if (!leafletMap || !isDetailMode) return;
      updateDepthBtn();
      const on = depthOn && leafletMap.getZoom() >= DEPTH_MIN_ZOOM;
      if (!depthGridLayer) depthGridLayer = createDepthGridLayer();
      const has = leafletMap.hasLayer(depthGridLayer);
      if (on && !has) depthGridLayer.addTo(leafletMap);
      else if (!on && has) leafletMap.removeLayer(depthGridLayer);
      if (!on) {
        if (dLabels) dLabels.clearLayers();
      } else {
        scheduleDepthLabels();
      }
    }

    // 지도 오른쪽 아래 "수심" 켜기/끄기 버튼(확대 12 이상에서만 보임)
    function updateDepthBtn() {
      if (!leafletMap) return;
      if (!depthBtn) {
        const Ctl = L.Control.extend({ onAdd() { const d = L.DomUtil.create('button', 'depth-btn'); d.type = 'button'; L.DomEvent.disableClickPropagation(d);
          d.onclick = () => { depthOn = !depthOn; try { localStorage.setItem('otemp.depthLayer2', depthOn ? '1' : '0'); } catch (_) {} refreshDepthLayers(); }; depthBtn = d; return d; } });
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
          if (leafletMap && !depthHooked) {
            depthHooked = true;
            leafletMap.on('moveend zoomend', refreshDepthLayers);
            // [ADD] 거리 가늠용 축척 막대(미터/킬로미터만) - 왼쪽 아래
            L.control.scale({ position: 'bottomleft', metric: true, imperial: false, maxWidth: 110 }).addTo(leafletMap);
          }
          setTimeout(refreshDepthLayers, 250);
        } catch (_) {}
        return r;
      };
    })();
