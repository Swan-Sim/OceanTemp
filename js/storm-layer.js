// [ADD] 태풍·허리케인 표시 - 지구본(선·기호)과 상세 지도(경로·예보원·강풍 반경) + 고른 포인트가 예보 경로 300km 안이면 경고 띠
//  자료: /api/storms (JMA·NHC·GDACS 합침, 서버 30분 캐시). 30분마다 다시 받아요. 오른쪽 아래 "🌀 태풍" 버튼으로 켜고 끄기(이 브라우저에 기억)
(function () {
  const NEAR_KM = 300, REFRESH = 30 * 60e3;
  let data = { storms: [] }, on = (() => { try { return localStorage.getItem('otemp.storms') !== '0'; } catch (_) { return true; } })();
  let gGroup = null, mapLayer = null, btn = null, warnEl = null;
  const L_ = () => (typeof lang === 'undefined' ? 'en' : lang);
  const TX = {
    ko: { btn: (n) => `🌀 태풍 ${n}`, typhoon: '태풍', hurricane: '허리케인', tc: '열대저기압', warn: (s, km, when) => `${s} 접근 중 · 예보 경로가 이 포인트에서 약 ${km}km${when ? ` (${when}쯤 가장 가까움)` : ''}. 현지 샵 안내를 꼭 확인하세요.`, now: '현재', fc: (h) => `+${h}시간`, p: '중심기압', w: '최대풍속', move: '이동', storm: '폭풍 반경', gale: '강풍 반경', num: (n) => `${n}호` },
    en: { btn: (n) => `🌀 Storms ${n}`, typhoon: 'Typhoon', hurricane: 'Hurricane', tc: 'Tropical cyclone', warn: (s, km, when) => `${s} approaching · forecast track passes about ${km} km from this spot${when ? ` (closest around ${when})` : ''}. Check with local dive shops.`, now: 'Now', fc: (h) => `+${h}h`, p: 'Pressure', w: 'Max wind', move: 'Moving', storm: 'Storm radius', gale: 'Gale radius', num: (n) => `No.${n}` },
    ja: { btn: (n) => `🌀 台風 ${n}`, typhoon: '台風', hurricane: 'ハリケーン', tc: '熱帯低気圧', warn: (s, km, when) => `${s}が接近中 · 予報進路はこのポイントから約${km}km${when ? `（${when}頃に最接近）` : ''}。現地ショップの案内を確認してください。`, now: '現在', fc: (h) => `+${h}時間`, p: '中心気圧', w: '最大風速', move: '進行', storm: '暴風域', gale: '強風域', num: (n) => `${n}号` },
    es: { btn: (n) => `🌀 Ciclones ${n}`, typhoon: 'Tifón', hurricane: 'Huracán', tc: 'Ciclón tropical', warn: (s, km, when) => `${s} se acerca · la trayectoria prevista pasa a unos ${km} km de este punto${when ? ` (más cerca hacia ${when})` : ''}. Consulta con los centros de buceo locales.`, now: 'Ahora', fc: (h) => `+${h} h`, p: 'Presión', w: 'Viento máx.', move: 'Rumbo', storm: 'Radio de tormenta', gale: 'Radio de temporal', num: (n) => `n.º ${n}` },
    zh: { btn: (n) => `🌀 颱風 ${n}`, typhoon: '颱風', hurricane: '颶風', tc: '熱帶氣旋', warn: (s, km, when) => `${s}接近中 · 預報路徑距此潛點約 ${km} km${when ? `（約 ${when} 最接近）` : ''}。請務必確認當地潛店資訊。`, now: '現在', fc: (h) => `+${h} 小時`, p: '中心氣壓', w: '最大風速', move: '移動', storm: '暴風半徑', gale: '強風半徑', num: (n) => `第 ${n} 號` }
  };
  const T = () => TX[L_()] || TX.en;
  const kind = (s) => s.src === 'nhc' ? T().hurricane : (s.cat === 'TY' || s.cat === 'STS' || s.cat === 'TS') ? T().typhoon : T().tc;
  const label = (s) => `${kind(s)}${s.num ? ' ' + T().num(s.num) : ''} ${s.name}`;
  const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  // 점과 선분(위경도) 사이 최소 거리(km) - 짧은 구간이라 평면 근사
  function segKm(lat, lon, a, b) { const cl = Math.cos(lat * Math.PI / 180); const ax = (a[1] - lon) * cl, ay = a[0] - lat, bx = (b[1] - lon) * cl, by = b[0] - lat; const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy; let t = l2 ? -(ax * dx + ay * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(ax + t * dx, ay + t * dy) * 111.32; }
  // 포인트에서 태풍 예보 경로까지 가장 가까운 거리 → { s, km, h } 또는 null
  window.stormNear = function (st) {
    if (!st || !st.coords || !data.storms.length) return null; const lat = st.coords[1], lon = st.coords[0]; let best = null;
    data.storms.forEach(s => { const pts = [[s.lat, s.lon, 0], ...s.forecast.map(f => [f.lat, f.lon, f.h])]; for (let i = 0; i < pts.length; i++) { let d = km(lat, lon, pts[i][0], pts[i][1]); let h = pts[i][2];
      if (i > 0) { const sd = segKm(lat, lon, pts[i - 1], pts[i]); if (sd < d) { d = sd; h = (pts[i - 1][2] + pts[i][2]) / 2; } }
      const r = (i > 0 && pts[i] && s.forecast[i - 1] && s.forecast[i - 1].storm) || s.radii.storm || 0; // 폭풍 반경만큼 가까워진 걸로
      if (!best || d - r < best.km) best = { s, km: Math.max(0, Math.round(d - r)), h }; } });
    return best && best.km <= NEAR_KM ? best : null;
  };

  // ── 지구본 ──
  function drawGlobe() {
    if (typeof globeGroup === 'undefined' || !globeGroup || typeof THREE === 'undefined') return;
    if (gGroup) { globeGroup.remove(gGroup); gGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); gGroup = null; }
    if (!on || !data.storms.length) { if (window.requestGlobeRender) requestGlobeRender(); return; }
    gGroup = new THREE.Group(); const R = GLOBE_RADIUS + 0.6;
    const line = (pts, color, dashed) => { if (pts.length < 2) return; const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => latLonToSpherePos(p[0], p[1], R))); const m = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: .9 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity: .85 }); const l = new THREE.Line(g, m); if (dashed) l.computeLineDistances(); gGroup.add(l); };
    const ring = (lat, lon, rkm, color, op) => { if (!rkm) return; const n = 48, pts = []; for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI, dl = rkm / 111.32, la = lat + dl * Math.cos(a), lo = lon + dl * Math.sin(a) / Math.cos(lat * Math.PI / 180); pts.push([la, lo]); } const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => latLonToSpherePos(p[0], p[1], R))); gGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: op }))); };
    data.storms.forEach(s => {
      line(s.track, 0xffffff, false);
      line([[s.lat, s.lon], ...s.forecast.map(f => [f.lat, f.lon])], 0xffd27a, true);
      s.forecast.forEach(f => ring(f.lat, f.lon, f.r, 0xffd27a, .45));
      ring(s.lat, s.lon, s.radii.storm, 0xf87171, .9); ring(s.lat, s.lon, s.radii.gale, 0xfbbf24, .7);
      // 기호 + 이름(캔버스 스프라이트)
      const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
      x.font = 'bold 26px sans-serif'; x.textBaseline = 'middle'; x.fillStyle = 'rgba(0,0,0,.55)'; const txt = `🌀 ${s.num ? s.num + ' ' : ''}${s.name}`; const w = x.measureText(txt).width + 16; x.fillRect(0, 10, Math.min(256, w), 44); x.fillStyle = '#fff'; x.fillText(txt, 8, 32);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false })); sp.scale.set(14, 3.5, 1); const p = latLonToSpherePos(s.lat, s.lon, R + 1.5); sp.position.copy(p); sp.center.set(0, .5); gGroup.add(sp);
    });
    globeGroup.add(gGroup); if (window.requestGlobeRender) requestGlobeRender();
  }
  // ── 상세 지도 ──
  function drawMap() {
    const map = typeof leafletMap !== 'undefined' ? leafletMap : null; if (!map) return;
    if (!mapLayer) mapLayer = L.layerGroup(); mapLayer.clearLayers();
    if (!on || !data.storms.length) { if (map.hasLayer(mapLayer)) map.removeLayer(mapLayer); return; }
    const t = T();
    data.storms.forEach(s => {
      if (s.track.length > 1) L.polyline(s.track, { color: '#fff', weight: 2, opacity: .8, interactive: false }).addTo(mapLayer);
      const fc = [[s.lat, s.lon], ...s.forecast.map(f => [f.lat, f.lon])];
      if (fc.length > 1) L.polyline(fc, { color: '#ffd27a', weight: 2, dashArray: '6 5', opacity: .9, interactive: false }).addTo(mapLayer);
      s.forecast.forEach(f => { if (f.r) L.circle([f.lat, f.lon], { radius: f.r * 1000, color: '#ffd27a', weight: 1, dashArray: '4 4', fill: false, interactive: false }).addTo(mapLayer);
        L.circleMarker([f.lat, f.lon], { radius: 4, color: '#ffd27a', fillColor: '#0B1120', fillOpacity: 1, weight: 1.5 }).bindTooltip(`${t.fc(f.h)}${f.pressure ? ` · ${f.pressure}hPa` : ''}${f.wind ? ` · ${f.wind}m/s` : ''}`, { direction: 'top' }).addTo(mapLayer); });
      if (s.radii.gale) L.circle([s.lat, s.lon], { radius: s.radii.gale * 1000, color: '#fbbf24', weight: 1, fillColor: '#fbbf24', fillOpacity: .08, interactive: false }).addTo(mapLayer);
      if (s.radii.storm) L.circle([s.lat, s.lon], { radius: s.radii.storm * 1000, color: '#f87171', weight: 1.5, fillColor: '#f87171', fillOpacity: .15, interactive: false }).addTo(mapLayer);
      const info = [`<b>${label(s)}</b>`, s.pressure ? `${t.p} ${s.pressure}hPa` : '', s.wind ? `${t.w} ${s.wind}m/s${s.gust ? ` (gust ${s.gust})` : ''}` : '', s.move && (s.move.dir || s.move.kmh) ? `${t.move} ${s.move.dir || ''} ${s.move.kmh ? s.move.kmh + 'km/h' : ''}` : '', s.radii.storm ? `${t.storm} ${s.radii.storm}km` : '', s.radii.gale ? `${t.gale} ${s.radii.gale}km` : ''].filter(Boolean).join('<br>');
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="st-eye">🌀</div><div class="st-name">${s.num ? s.num + ' ' : ''}${s.name}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }), zIndexOffset: 900 }).bindPopup(info).addTo(mapLayer);
    });
    if (!map.hasLayer(mapLayer)) mapLayer.addTo(map);
  }
  // ── 버튼·경고 띠 ──
  function paintBtn() {
    if (!btn) { btn = document.createElement('button'); btn.id = 'btn-storms'; btn.type = 'button'; btn.onclick = () => { on = !on; try { localStorage.setItem('otemp.storms', on ? '1' : '0'); } catch (_) {} drawGlobe(); drawMap(); paintBtn(); paintWarn(); }; document.body.appendChild(btn); }
    const n = data.storms.length; btn.style.display = n ? '' : 'none'; btn.textContent = T().btn(n); btn.classList.toggle('on', on); btn.title = data.storms.map(label).join(', ');
  }
  function paintWarn() {
    const st = typeof selectedStation !== 'undefined' ? selectedStation : null, near = on && st ? window.stormNear(st) : null;
    if (!warnEl) { warnEl = document.createElement('div'); warnEl.id = 'storm-warn'; const nm = document.getElementById('st-name'); if (nm && nm.parentElement) nm.parentElement.insertBefore(warnEl, nm.nextSibling); else document.body.appendChild(warnEl); }
    if (!near) { warnEl.style.display = 'none'; return; }
    const when = near.h ? new Date(Date.now() + near.h * 3600e3).toLocaleString(L_(), { month: 'numeric', day: 'numeric', hour: 'numeric' }) : '';
    warnEl.textContent = `🌀 ${T().warn(label(near.s), near.km, when)}`; warnEl.style.display = '';
  }
  async function load() {
    try { const j = await fetch('/api/storms').then(r => r.json()); data = { storms: (j && j.storms) || [] }; } catch (_) { data = { storms: [] }; }
    drawGlobe(); drawMap(); paintBtn(); paintWarn();
    if (typeof window.sportLayerRefresh === 'function') try { window.sportLayerRefresh(); } catch (_) {}
  }
  const css = document.createElement('style');
  css.textContent = `#btn-storms{position:fixed;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 88px);z-index:58;height:30px;padding:0 12px;border-radius:999px;border:1px solid rgba(248,113,113,.55);background:rgba(11,17,32,.85);color:#fca5a5;font-size:12.5px;font-weight:700;cursor:pointer;backdrop-filter:blur(6px)} #btn-storms.on{background:rgba(127,29,29,.75);color:#fff}
  body.detail-mode #btn-storms{bottom:calc(env(safe-area-inset-bottom,0px) + 120px)}
  #storm-warn{display:none;margin:4px 0 2px;padding:6px 10px;border-radius:8px;background:rgba(127,29,29,.5);border:1px solid rgba(248,113,113,.6);color:#fee2e2;font-size:12.5px;line-height:1.4}
  .st-eye{font-size:26px;line-height:40px;text-align:center;animation:st-spin 6s linear infinite;filter:drop-shadow(0 0 4px rgba(0,0,0,.8))} @keyframes st-spin{to{transform:rotate(-360deg)}} @media (prefers-reduced-motion:reduce){.st-eye{animation:none}}
  .st-name{position:absolute;left:50%;top:38px;transform:translateX(-50%);white-space:nowrap;font-size:12px;font-weight:700;color:#fff;background:rgba(127,29,29,.8);padding:1px 6px;border-radius:6px}`;
  document.head.appendChild(css);
  // 지도가 열릴 때·정점이 바뀔 때 따라가기
  const f = window.showDetailMap; if (typeof f === 'function') window.showDetailMap = function () { const r = f.apply(this, arguments); setTimeout(drawMap, 300); return r; };
  const u = window.updateLeafletSelection; if (typeof u === 'function') window.updateLeafletSelection = function () { const r = u.apply(this, arguments); paintWarn(); return r; };
  document.addEventListener('DOMContentLoaded', () => { setTimeout(load, 4000); setInterval(load, REFRESH); });
  window.stormsData = () => data; window.stormsOn = () => on;
})();
