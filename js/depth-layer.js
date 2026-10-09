    // [ADD] 지도(위성) 위에 수심을 "지도처럼" 이어서 깔기 - api/_depth.js 수심 벡터 타일(줌 13 격자, 한 장 약 4~5km)
    //  서버가 등심선·수심 띠를 미리 다각형/선으로 만들어 저장해 두고(180일, CDN 30일), 앱은 그리기만 해서 빠르고 확대해도 선명해요
    //  자료: 한국 국립해양조사원 150m · 유럽 EMODnet 115m · 미국 NOAA(약 90m 간격으로 뽑음) · 그 밖 GMRT
    //  - 확대 12 이상에서 화면에 걸친 타일을 받아(서버 180일 저장) 반투명 수심 색 + 10m 간격 등심선(30·40·60m 진하게) + 숫자
    //  - 타일마다 경계 밖까지 조금 더 받아 계산한 뒤 경계에서 잘라 그려서 이음새가 안 보여요
    //  - 선과 숫자는 그림이 아니라 지도 위 선·글자라 확대해도 선명해요
    //  - 오른쪽 아래 "수심" 버튼으로 켜고 끄기(이 브라우저에 기억)
    const DEPTH_MIN_ZOOM = 12, DTILE_Z = 13, DTILE_MAX = 500, DTILE_PAR = 6;
    let dRenderer = null; // 칸이 많아도 가볍게: 등심선·띠는 캔버스 한 장에 그림
    const dRend = () => dRenderer || (dRenderer = L.canvas({ padding: 0.5 }));
    const dTiles = new Map(); // "x_y" → { st: 'load'|'ok'|'none', grp, lbl: [[위도, 경도, 수심]] }
    let dQueue = [], dActive = 0, dLabels = null;
    let depthOn = (() => { try { return localStorage.getItem('otemp.depthLayer') !== '0'; } catch (_) { return true; } })();
    let depthHooked = false, depthBtn = null;

    const tileX = (lon) => Math.floor((lon + 180) / 360 * 2 ** DTILE_Z);
    const tileY = (lat) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** DTILE_Z); };

    // 서버가 미리 만들어 둔 벡터(다각형·선)를 그대로 그리기만 해요 - 일러스트처럼 단색 띠가 깊을수록 겹쳐 진해짐
    const DFILL = { 1: ['#a5f3fc', 0.10], 5: ['#7dd3fc', 0.12], 10: ['#38bdf8', 0.09], 20: ['#0ea5e9', 0.09], 30: ['#0284c7', 0.09], 40: ['#0369a1', 0.09], 50: ['#075985', 0.09], 60: ['#0c4a6e', 0.1], 80: ['#082f49', 0.1], 100: ['#041e33', 0.12], 120: ['#03182b', 0.12], 150: ['#021224', 0.14] };
    // 서버 압축 형식(v2): 좌표 = 타일 안 0~4096 정수, 앞 점과의 차이만 → [위도, 경도]로 되돌리기
    // [ADD] 위성 사진 섬이 등고선보다 약 200m 북쪽에 있어서, 그려진 수심(띠·등고선·해안선·숫자)을 전체적으로 남쪽으로 내려요. 값을 바꾸려면 아래 숫자(미터)만 고치세요.
    const SH = 0 /* 남쪽 이동은 서버에서 먼저 처리 */;
    function decodeTile(d) {
      const t = d.tile, dec = (a) => { const o = []; let x = 0, y = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; o.push([t.n - y / 4096 * (t.n - t.s) - SH, t.w + x / 4096 * (t.e - t.w)]); } return o; };
      return { fills: (d.F || []).map(([dd, polys]) => ({ d: dd, p: polys.map(poly => poly.map(dec)) })),
        lines: Object.fromEntries(Object.entries(d.Ln || {}).map(([k, ls]) => [k, ls.map(dec)])),
        land: (d.Ld || []).map(dec),
        lbl: (d.lb || []).map(([x, y, k]) => [t.n - y / 4096 * (t.n - t.s) - SH, t.w + x / 4096 * (t.e - t.w), k]) };
    }
    // [ADD] 두 단계 그리기: 'lite'(먼 화면·처음 받자마자: 점을 1/3로 줄이고 10·20·30·40m 선만) → 'full'(확대 14 이상, 가만히 있을 때 바꿔 끼움: 모든 선·숫자)
    const decim = (a, k) => k <= 1 ? a : a.filter((p, i) => i % k === 0 || i === a.length - 1);
    function buildTile(d, full) {
      const layers = [], K = full ? 1 : 3, SF = full ? 0.3 : 1.5;
      const cz = d.coarse; // 거친 자료(해외 일부): 서버에서 해안선에 맞춰 평행 이동한 뒤라 다른 지역과 같은 모양으로 그림
      (d.fills || []).forEach(f => { const c = DFILL[f.d] || ['#0c4a6e', 0.1], pp = full ? f.p : f.p.map(poly => poly.map(r => decim(r, K)).filter(r => r.length >= 3)).filter(poly => poly.length); if (pp.length) layers.push(L.polygon(pp, { stroke: false, fillColor: c[0], fillOpacity: c[1], interactive: false, smoothFactor: SF, renderer: dRend() })); });
      const LN = {}; Object.keys(d.lines || {}).forEach(k => { if (full || ['10', '20', '30', '40'].includes(k)) LN[k] = full ? d.lines[k] : d.lines[k].map(l => decim(l, 2)).filter(l => l.length > 1); });
      Object.keys(LN).forEach(k => {
        const strong = k === '10' || k === '20' || k === '30' || k === '40'; // [CHANGE] 다이빙 계획에 중요한 10·20·30·40m를 진하게
        const shallow = +k < 10; // [ADD] 2·5m: 가는 점선
        layers.push(L.polyline(LN[k], { color: '#fff', weight: strong ? 1.6 : shallow ? 0.9 : 0.8, opacity: strong ? 0.85 : shallow ? 0.6 : 0.4, dashArray: shallow ? '3 4' : null, interactive: false, smoothFactor: SF, renderer: dRend() }));
      });
      // [CHANGE] 숫자 후보: 모든 등심선(10m 간격) 위 점들 - 화면에서 몇 m 선인지 바로 알 수 있게
      const lbl = []; Object.keys(LN).forEach(k => (LN[k] || []).forEach(ln => ln.forEach((p, i) => { if (i % (full ? 6 : 3) === (full ? 3 : 1)) lbl.push([p[0], p[1], +k]); })));
      // [CHANGE] 섬·바위(OSM 해안선, 반지름 15m 이상): 서버가 섬 안쪽은 수심 띠·등심선에서 빼 두었어요. 여기선 해안선만 흰 선으로(안쪽은 투명 → 위성 사진 그대로)
      const land = full ? (d.land || []) : (d.land || []).map(r => decim(r, 2)).filter(r => r.length > 2);
      land.forEach(r => layers.push(L.polygon(r, { stroke: true, color: '#fff', weight: 1, opacity: 0.85, fill: false, interactive: false, smoothFactor: 0.3, renderer: dRend() })));
      const inLand = (la, lo) => land.some(r => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > lo) !== (b[1] > lo) && la < (b[0] - a[0]) * (lo - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; });
      const lb2 = land.length ? lbl.filter(p => !inLand(p[0], p[1])) : lbl;
      return { grp: L.layerGroup(layers), lbl: lb2.length ? lb2 : (land.length ? [] : (d.lbl || [])) };
    }

    // [ADD] 포인트 현지 지형(관리자 입력)이 이 타일에 걸리면 주소에 짧은 표시를 붙여요(서버 api/_depth.js profSig와 같은 계산) - 바꾸면 바로 새로 그림
    function profParam(x, y) {
      const n = 2 ** 13, lon = (v) => v / n * 360 - 180, lat = (v) => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
      const b = { s: lat(y + 1), n: lat(y), w: lon(x), e: lon(x + 1) }, E = 0.02;
      const str = (typeof stations !== 'undefined' ? stations : []).filter(st => st.prof && st.no && st.coords && st.coords[1] >= b.s - E && st.coords[1] <= b.n + E && st.coords[0] >= b.w - E && st.coords[0] <= b.e + E)
        .map(st => { const q = st.prof; return `${st.no}:${q.top}/${q.r}/${(q.secs || []).map(x => [x.a0, x.a1, x.deg, x.max].join(',')).join(';')}/${q.els ? [q.els.deg, q.els.max].join(',') : ''}`; }).sort().join('|');
      if (!str) return '';
      let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
      return '&p=' + h.toString(36);
    }
    // [ADD] 관리자 "최소 수심 구역"이 바뀌면 주소가 바뀌게(서버 api/_site.js depthFix, 계정 js/account.js가 읽어 옴)
    const fixParam = () => { const f = window.otDepthFix || [], o = window.otDepthOff || {}, off = (o.prof ? 'p' : '') + (o.fix ? 'f' : '') + (o.land ? 'l' : ''); if (!f.length && !off) return ''; const str = f.map(x => `${x.la}/${x.lo}/${x.r}/${x.min}`).sort().join(',') + '#' + off; let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return '&f=' + h.toString(36); };
    let lastFix = fixParam();
    window.addEventListener('otemp:site', () => { const n = fixParam(); if (n === lastFix) return; lastFix = n; dTiles.forEach(tl => { if (tl.grp && leafletMap) leafletMap.removeLayer(tl.grp); }); dTiles.clear(); dQueue = []; refreshDepthLayers(); });
    // [ADD] 시안 보기: 주소에 ?dv=1·2·3을 붙이면 옛 방식으로 그린 수심 지도를 따로 불러와요(1 섬 육지·방향 경사 전 · 2 거친 수심 원래 위치 전 · 3 현지 지형 입력 전)
    const DV_MODE = (() => { try { const v = new URLSearchParams(location.search).get('dv'); return ['1', '2', '3'].includes(v) ? v : ''; } catch (_) { return ''; } })();
    // [ADD] 타일 그림 방식 바꿔 끼우기: 확대 14 이상이면 full, 아니면 lite. 한 번 만든 그림은 보관(다시 줌아웃하면 가벼운 걸로 즉시 교체)
    function setMode(tl, m) {
      if (!tl.raw || tl.mode === m) return;
      const old = tl.grp, wasOn = !!(old && leafletMap && leafletMap.hasLayer(old)); if (wasOn) leafletMap.removeLayer(old);
      const c = tl['c_' + m] || (tl['c_' + m] = buildTile(tl.raw, m === 'full'));
      tl.grp = c.grp; tl.lbl = c.lbl; tl.mode = m;
      if (leafletMap && (wasOn || (depthOn && isDetailMode && leafletMap.getZoom() >= DEPTH_MIN_ZOOM))) tl.grp.addTo(leafletMap);
    }
    let syncTimer = null;
    function syncModes() {
      clearTimeout(syncTimer);
      if (!leafletMap || !depthOn) return;
      const m = leafletMap.getZoom() >= 14 ? 'full' : 'lite', vb = leafletMap.getBounds().pad(0.3), todo = [];
      dTiles.forEach(tl => { if (!tl.raw || tl.mode === m) return; const t = tl.raw.tile; if (m === 'full' && t && !vb.intersects(L.latLngBounds([t.s, t.w], [t.n, t.e]))) return; todo.push(tl); });
      if (!todo.length) return;
      let i = 0;
      const step = () => { const t0 = performance.now(); while (i < todo.length && performance.now() - t0 < 10) setMode(todo[i++], m); placeDepthLabels(); if (i < todo.length) syncTimer = setTimeout(step, 30); };
      syncTimer = setTimeout(step, m === 'full' ? 300 : 0); // 가까이 볼 땐 지도가 멈춘 뒤(0.3초)에 교체
    }
    function loadNext() {
      while (dActive < DTILE_PAR && dQueue.length) {
        const key = dQueue.shift(), [x, y] = key.split('_');
        dActive++;
        fetch(`/api/spotobs?svc=dvec&x=${x}&y=${y}&v=26${profParam(+x, +y)}${fixParam()}${DV_MODE ? '&m=' + DV_MODE : ''}`).then(r => r.json()).then(d => {
          if (d && d.ok && !d.empty && (d.F || d.fills || d.lines)) { if (d.v === 2) d = Object.assign({}, d, decodeTile(d)); const tl = { st: 'ok', raw: d, coarse: !!d.coarse, lbl: [] }; dTiles.set(key, tl); setMode(tl, 'lite'); placeDepthLabels(); syncModes(); }
          else if (d && d.retry) { dTiles.delete(key); } // 국립해양조사원 일시 실패 → 다음 이동 때 다시
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
      // 숫자: 10·20·30·40m는 늘(화면 가운데에서 가장 가까운 곳에 하나씩, 서로 40px 넘게) 먼저 놓고,
      //  나머지 수심(50·60…150m)은 빈자리(60px 넘게)에 하나씩, 그다음 여유가 있으면 수심마다 하나 더(160px 넘게)
      const b = leafletMap.getBounds().pad(-0.06), c = leafletMap.getCenter(), cand = {};
      dTiles.forEach(tl => { if (tl.st !== 'ok') return; tl.lbl.forEach(p => { if (!b.contains([p[0], p[1]])) return; (cand[p[2]] = cand[p[2]] || []).push([c.distanceTo([p[0], p[1]]), p]); }); });
      const placed = [], levels = Object.keys(cand).map(Number).sort((a, z) => a - z), KEY = [5, 10, 20, 30, 40]; // [ADD] 5m도 먼저(얕은 만에서 숫자가 보이게)
      levels.forEach(k => cand[k].sort((a, z) => a[0] - z[0]));
      const put = (k, gap) => { for (const [, p] of cand[k]) { const px = leafletMap.latLngToContainerPoint([p[0], p[1]]);
        if (placed.every(q => q.distanceTo(px) > gap)) { placed.push(px);
          dLabels.addLayer(L.marker([p[0], p[1]], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'depth-lbl' + (KEY.includes(k) ? '' : ' sm'), html: `${k}m`, iconSize: [30, 14], iconAnchor: [15, 7] }) })); return; } } };
      KEY.forEach(k => { if (cand[k]) put(k, 40); });
      levels.filter(k => !KEY.includes(k)).forEach(k => put(k, 60));
      levels.forEach(k => put(k, 160));
    }

    function refreshDepthLayers() {
      if (!leafletMap || !isDetailMode) return;
      updateDepthBtn();
      const on = depthOn && leafletMap.getZoom() >= DEPTH_MIN_ZOOM;
      dTiles.forEach(tl => { if (!tl.grp) return; const has = leafletMap.hasLayer(tl.grp); if (on && !has) tl.grp.addTo(leafletMap); else if (!on && has) leafletMap.removeLayer(tl.grp); });
      if (!on) { placeDepthLabels(); return; }
      const z = leafletMap.getZoom(), b = leafletMap.getBounds().pad(z >= 14 ? 0.6 : z >= 13 ? 0.3 : 0.1), x0 = tileX(b.getWest()), x1 = tileX(b.getEast()), y0 = tileY(b.getNorth()), y1 = tileY(b.getSouth());
      const want = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) want.push(x + '_' + y);
      if (want.length > 400) return; // [FIX] 예전엔 60칸 넘으면(확대 12~13) 아예 안 받아서 빈칸이 생겼어요
      const ctx = tileX(leafletMap.getCenter().lng), cty = tileY(leafletMap.getCenter().lat); // 화면 가운데 칸부터 받기
      const add = want.filter(k => !dTiles.has(k)); add.forEach(k => dTiles.set(k, { st: 'load' }));
      // 아직 시작 안 한 이전 대기 칸도 유지(안 그러면 '받는 중'으로 남아 영영 안 받아짐), 가운데 칸부터
      const dist = (k) => { const [x, y] = k.split('_').map(Number); return Math.hypot(x - ctx, y - cty); };
      dQueue = [...new Set(dQueue.concat(add))].sort((a, z) => dist(a) - dist(z));
      loadNext();
      // 오래된 타일 정리(화면에서 먼 것부터)
      if (dTiles.size > DTILE_MAX) {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        [...dTiles.keys()].map(k => { const [x, y] = k.split('_').map(Number); return [k, Math.hypot(x - cx, y - cy)]; }).sort((a, z) => z[1] - a[1])
          .slice(0, dTiles.size - DTILE_MAX).forEach(([k]) => { const tl = dTiles.get(k); if (tl.st === 'load') return; if (tl.grp) leafletMap.removeLayer(tl.grp); dTiles.delete(k); });
      }
      placeDepthLabels();
      syncModes();
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
          if (leafletMap && !depthHooked) { depthHooked = true; leafletMap.on('moveend zoomend', refreshDepthLayers);
            // [ADD] 거리 가늠용 축척 막대(미터/킬로미터만) - 왼쪽 아래
            L.control.scale({ position: 'bottomleft', metric: true, imperial: false, maxWidth: 110 }).addTo(leafletMap); }
          setTimeout(refreshDepthLayers, 500);
        } catch (_) {}
        return r;
      };
    })();
