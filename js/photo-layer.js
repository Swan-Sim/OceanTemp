// [ADD] 지도에서 충분히 확대하면(줌 13 이상) 로그북에서 "지도에 공개"한 사진을 포인트 이름 아래 작은 썸네일로 보여줘요.
//  목록: /api/spotobs?svc=lphotos (포인트별 가장 최근 공개 사진 1장 + 장수) · 사진: svc=lphoto&s=t(썸네일)
//  썸네일을 누르면 큰 사진(window.otPhotoView, js/logbook.js). 화면 안 포인트만, 한 번에 최대 40개.
(function () {
  const MIN_ZOOM = 13, MAX_SHOWN = 40;
  let idx = null, idxAt = 0, loading = null, layer = null, hooked = false;
  const css = document.createElement('style');
  css.textContent = `.ot-pth{width:69px;height:69px;border-radius:8px;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.55);background:#111a30 center/cover no-repeat;position:absolute;left:0;top:0;cursor:pointer;pointer-events:auto;box-sizing:border-box}
  .ot-pth:before{content:'';position:absolute;left:5px;top:-11px;border:6px solid transparent;border-bottom-color:#fff;border-top-width:0;filter:drop-shadow(0 -1px 1px rgba(0,0,0,.35))}
  .ot-pth i{position:absolute;right:-5px;bottom:-5px;min-width:16px;height:16px;border-radius:8px;background:#FFB000;color:#111;font:700 12px/16px sans-serif;text-align:center;font-style:normal;padding:0 3px;box-sizing:border-box}`;
  document.head.appendChild(css);
  async function load(force) {
    if (idx && !force && Date.now() - idxAt < 300000) return idx;
    if (!loading) loading = fetch('/api/spotobs?svc=lphotos' + (force ? '&t=' + Date.now() : '')).then(r => r.json()).then(j => { idx = (j && j.spots) || {}; idxAt = Date.now(); return idx; }).catch(() => idx || {}).finally(() => { loading = null; });
    return loading;
  }
  // [CHANGE] 썸네일을 따로 떠 있는 마커로 두지 않고, 포인트 이름표와 같은 마커(div) 안에 넣어요.
  //  자리는 js/label-layout.js 가 이름표+썸네일을 한 덩어리로 보고 잡아요(겹치면 썸네일만 숨김) → 썸네일끼리·이름표와 겹치지 않아요
  let shown = {}; // 정점 id → 썸네일 요소
  async function refresh(force) {
    if (!leafletMap || typeof isDetailMode === 'undefined' || !isDetailMode) return;
    const keep = new Set();
    if (leafletMap.getZoom() >= MIN_ZOOM) {
      const sp = await load(force);
      if (sp && Object.keys(sp).length && typeof leafletMarkersByStationId !== 'undefined') {
        const b = leafletMap.getBounds().pad(0.05); let n = 0;
        for (const st of (typeof stations !== 'undefined' ? stations : [])) {
          if (n >= MAX_SHOWN) break; const p = st && st.no && sp[st.no]; if (!p || !st.coords || !b.contains([st.coords[1], st.coords[0]])) continue;
          const m = leafletMarkersByStationId[st.id], el = m && m.getElement && m.getElement(); if (!el) continue;
          keep.add(String(st.id)); n++;
          let th = shown[st.id]; const url = `/api/spotobs?svc=lphoto&id=${p.id}&s=t`;
          if (th && !th.isConnected) { delete shown[st.id]; th = null; }
          if (!th) { th = document.createElement('div'); th.className = 'ot-pth'; th.style.display = 'none'; el.appendChild(th); shown[st.id] = th;
            th.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); if (typeof window.otPhotoView === 'function') window.otPhotoView(th.dataset.pid); }); }
          if (th.dataset.pid !== String(p.id)) { th.dataset.pid = p.id; th.style.backgroundImage = `url('${url}')`; }
          th.innerHTML = p.n > 1 ? `<i>${p.n}</i>` : '';
        }
      }
    }
    Object.keys(shown).forEach(id => { if (!keep.has(String(id))) { try { shown[id].remove(); } catch (_) {} delete shown[id]; } });
    if (typeof window.layoutStationLabels === 'function') window.layoutStationLabels();
  }
  // 포인트 이름표를 눌러도 그 포인트가 선택되게
  function labelClick(ev) {
    const lab = ev.target && ev.target.closest && ev.target.closest('.lf-label'); if (!lab) return;
    const wrap = lab.closest('.lf-marker-wrap'); if (!wrap || typeof leafletMarkersByStationId === 'undefined') return;
    for (const id of Object.keys(leafletMarkersByStationId)) {
      const m = leafletMarkersByStationId[id], el = m.getElement && m.getElement();
      if (el === wrap) { const st = (typeof stations !== 'undefined' ? stations : []).find(x => String(x.id) === String(id)); if (st && typeof selectStation === 'function') { ev.stopPropagation(); selectStation(st); } return; }
    }
  }
  (function hook() {
    const f = window.showDetailMap; if (typeof f !== 'function') return;
    window.showDetailMap = function () {
      const r = f.apply(this, arguments);
      try { if (leafletMap && !hooked) { hooked = true; leafletMap.on('moveend zoomend', () => refresh()); leafletMap.on('layerremove', () => { Object.keys(shown).forEach(id => { if (!shown[id].isConnected) delete shown[id]; }); }); leafletMap.getContainer().addEventListener('click', labelClick, true); } setTimeout(refresh, 700); } catch (_) {}
      return r;
    };
  })();
  window.addEventListener('otemp:photos', () => { idx = null; refresh(true); });
})();
