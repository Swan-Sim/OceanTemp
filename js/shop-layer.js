    // [ADD] 상세 지도에 샵·리브어보드·풀장 표시 - 정점(동그라미)과 같은 크기의 네모, 색만 다르게
    //  다이브샵 = 주황 네모, 리브어보드 = 보라 네모, 풀장 = 파란 네모. 위치(GPS)가 저장된 곳만, 확대 11 이상에서
    //  누르면 연락 버튼·다니는 포인트(풀장은 수심·수온 등). 이름표는 정점과 같이 js/label-layout.js가 겹치지 않게 배치
    //  오른쪽 아래 "샵 ON/OFF"로 켜고 끄기(이 브라우저에 기억)
    (function () {
      const SHOP_MIN_ZOOM = 11;
      const TYPE_NAME = { shop: () => t.shopTypeShop || '다이브샵', liveaboard: () => t.shopLiveaboard || '리브어보드', pool: () => t.shopTypePool || '다이빙 풀장' };
      let on = (() => { try { return localStorage.getItem('otemp.shopLayer') !== '0'; } catch (_) { return true; } })();
      let group = null, btn = null, built = false;
      window.__shopMarkers = {}; // label-layout.js가 이름표 배치에 같이 씀

      function popupHtml(s) {
        const esc = shopEsc, nm = (no) => { const st = stations.find(x => +x.no === +no); return st ? (st.label || st.name) : '#' + no; };
        let body = '';
        if (s.type === 'pool') {
          const f = [];
          if (s.depthMax != null) f.push(`${t.poolDepth || '최대 수심'} ${s.depthMax}m`);
          if (s.waterTemp != null) f.push(`${t.poolTemp || '수온'} ${s.waterTemp}°C`);
          if (s.env) f.push({ in: t.poolIn || '실내', out: t.poolOut || '실외', season: t.poolSeason || '계절 운영' }[s.env] || '');
          body += f.length ? `<div class="sp-pf">${esc(f.filter(Boolean).join(' · '))}</div>` : '';
          if (s.hours) body += `<div class="sp-pf">${esc(s.hours)}</div>`;
          if (s.price) body += `<div class="sp-pf">${esc(s.price)}</div>`;
        }
        const links = shopLinks(s);
        if (links.length) body += `<div class="shop-btns">${links.map(([k, href, label]) => `<a class="shop-btn${k === 'tel' ? ' call' : ''}" ${linkAttrs(s, k, href)}>${SHOP_ICON[k]}<span>${esc(label)}</span></a>`).join('')}</div>`;
        if (s.type !== 'pool' && s.spots && s.spots.length) body += `<div class="sp-spots">${esc(t.shopSpots || '다니는 포인트')}: <b>${esc(s.spots.slice(0, 12).map(nm).join(' · '))}${s.spots.length > 12 ? ' …' : ''}</b></div>`;
        return `<div class="sp-card"><div class="sp-h"><b>${esc(s.name)}</b>${s.paid ? `<span class="shop-badge">${esc(t.shopPartner || '제휴')}</span>` : ''}</div>
          <div class="sp-t">${esc(TYPE_NAME[s.type] ? TYPE_NAME[s.type]() : '')}${s.lang ? ' · ' + esc(langLabel(s.lang)) : ''}</div>
          ${s.note ? `<div class="sp-note">${esc(s.note)}</div>` : ''}${body}
          <a class="shop-report" href="/shop/report/?id=${encodeURIComponent(s.id)}" target="_blank" rel="noopener">${esc(t.shopReport || '이의 제기')}</a></div>`;
      }

      function build(list) {
        if (built || !leafletMap) return; built = true;
        group = L.layerGroup();
        list.filter(s => s.lat != null && s.lon != null).forEach(s => {
          const ty = ['shop', 'liveaboard', 'pool'].includes(s.type) ? s.type : 'shop';
          const icon = L.divIcon({ className: 'lf-marker-wrap lf-shopmk', html: `<div class="lf-sq ${ty}"></div><span class="lf-label">${shopEsc(s.name)}</span>`, iconSize: [20, 20], iconAnchor: [7, 10] });
          const m = L.marker([s.lat, s.lon], { icon, zIndexOffset: 300 }).bindPopup(() => popupHtml(s), { maxWidth: 270, className: 'sp-pop' });
          window.__shopMarkers['s' + s.id] = m; group.addLayer(m);
        });
        sync();
      }
      function sync() {
        if (!leafletMap || !group) return;
        const show = on && leafletMap.getZoom() >= SHOP_MIN_ZOOM, has = leafletMap.hasLayer(group);
        if (show && !has) group.addTo(leafletMap); else if (!show && has) leafletMap.removeLayer(group);
        if (btn) { btn.style.display = leafletMap.getZoom() >= SHOP_MIN_ZOOM && Object.keys(window.__shopMarkers).length ? '' : 'none'; btn.classList.toggle('on', on); btn.textContent = (t.shopLayer || '샵') + (on ? ' ON' : ' OFF'); }
        if (window.layoutStationLabels) window.layoutStationLabels();
      }
      const f = window.showDetailMap;
      if (typeof f === 'function') window.showDetailMap = function () {
        const r = f.apply(this, arguments);
        try {
          if (leafletMap && !btn) {
            const Ctl = L.Control.extend({ onAdd() { const d = L.DomUtil.create('button', 'depth-btn shop-btn-tg'); d.type = 'button'; L.DomEvent.disableClickPropagation(d);
              d.onclick = () => { on = !on; try { localStorage.setItem('otemp.shopLayer', on ? '1' : '0'); } catch (_) {} sync(); }; btn = d; return d; } });
            new Ctl({ position: 'bottomright' }).addTo(leafletMap);
            leafletMap.on('zoomend', sync);
            loadShops().then(build);
          }
          setTimeout(sync, 300);
        } catch (_) {}
        return r;
      };
    })();
