// [ADD] 지도에서 충분히 확대하면(줌 13 이상) 로그북에서 "지도에 공개"한 사진을 포인트 이름 아래 작은 썸네일로 보여줘요.
//  목록: /api/spotobs?svc=lphotos (포인트별 가장 최근 공개 사진 1장 + 장수) · 사진: svc=lphoto&s=t(썸네일)
//  썸네일을 누르면 큰 사진(window.otPhotoView, js/logbook.js). 화면 안 포인트만, 한 번에 최대 40개.
(function () {
  const MIN_ZOOM = 13, MAX_SHOWN = 40;
  let idx = null, idxAt = 0, loading = null, layer = null, hooked = false;
  const css = document.createElement('style');
  css.textContent = `.ot-pth{width:46px;height:46px;border-radius:8px;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.55);background:#111a30 center/cover no-repeat;position:relative;cursor:pointer}
  .ot-pth:before{content:'';position:absolute;left:5px;top:-11px;border:6px solid transparent;border-bottom-color:#fff;border-top-width:0;filter:drop-shadow(0 -1px 1px rgba(0,0,0,.35))}
  .ot-pth i{position:absolute;right:-5px;bottom:-5px;min-width:16px;height:16px;border-radius:8px;background:#FFB000;color:#111;font:700 10px/16px sans-serif;text-align:center;font-style:normal;padding:0 3px;box-sizing:border-box}`;
  document.head.appendChild(css);
  async function load(force) {
    if (idx && !force && Date.now() - idxAt < 300000) return idx;
    if (!loading) loading = fetch('/api/spotobs?svc=lphotos' + (force ? '&t=' + Date.now() : '')).then(r => r.json()).then(j => { idx = (j && j.spots) || {}; idxAt = Date.now(); return idx; }).catch(() => idx || {}).finally(() => { loading = null; });
    return loading;
  }
  async function refresh(force) {
    if (!leafletMap || typeof isDetailMode === 'undefined' || !isDetailMode) return;
    if (!layer) layer = L.layerGroup().addTo(leafletMap);
    layer.clearLayers();
    if (leafletMap.getZoom() < MIN_ZOOM) return;
    const sp = await load(force); if (!sp || !Object.keys(sp).length) return;
    const b = leafletMap.getBounds().pad(0.05); let n = 0;
    for (const st of (typeof stations !== 'undefined' ? stations : [])) {
      if (n >= MAX_SHOWN) break; const p = st && st.no && sp[st.no]; if (!p || !st.coords || !b.contains([st.coords[1], st.coords[0]])) continue;
      const html = `<div class="ot-pth" style="background-image:url('/api/spotobs?svc=lphoto&id=${p.id}&s=t')">${p.n > 1 ? `<i>${p.n}</i>` : ''}</div>`;
      const m = L.marker([st.coords[1], st.coords[0]], { icon: L.divIcon({ className: '', html, iconSize: [46, 46], iconAnchor: [-4, -20] }), zIndexOffset: -200, keyboard: false });
      m.on('click', (ev) => { if (ev.originalEvent) L.DomEvent.stopPropagation(ev.originalEvent); if (typeof window.otPhotoView === 'function') window.otPhotoView(p.id); });
      m.addTo(layer); n++;
    }
  }
  (function hook() {
    const f = window.showDetailMap; if (typeof f !== 'function') return;
    window.showDetailMap = function () {
      const r = f.apply(this, arguments);
      try { if (leafletMap && !hooked) { hooked = true; leafletMap.on('moveend zoomend', () => refresh()); } setTimeout(refresh, 700); } catch (_) {}
      return r;
    };
  })();
  window.addEventListener('otemp:photos', () => { idx = null; refresh(true); });
})();
