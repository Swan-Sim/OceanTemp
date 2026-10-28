// [ADD] 태풍·허리케인 표시 - 지구본(선·기호)과 상세 지도(경로·예보원·강풍 반경) + 고른 포인트가 예보 경로 300km 안이면 경고 띠
//  자료: /api/storms (JMA·NHC·GDACS 합침, 서버 30분 캐시). 30분마다 다시 받아요. 오른쪽 아래 "🌀 태풍" 버튼으로 켜고 끄기(이 브라우저에 기억)
(function () {
  const NEAR_KM = 300, REFRESH = 30 * 60e3;
  let data = { storms: [] }, on = (() => { try { return localStorage.getItem('otemp.storms') !== '0'; } catch (_) { return true; } })();
  let gGroup = null, mapLayer = null, moveLayer = null, globeDirty = false, viewMs = null, btn = null, warnEl = null;
  const L_ = () => (typeof lang === 'undefined' ? 'en' : lang);
  const TX = {
    ko: { btn: (n) => `🌀 태풍 ${n}`, typhoon: '태풍', hurricane: '허리케인', tc: '열대저기압', warn: (s, km, when) => `${s} 접근 중 · 예보 경로가 이 포인트에서 약 ${km}km${when ? ` (${when}쯤 가장 가까움)` : ''}. 현지 샵 안내를 꼭 확인하세요.`, now: '현재', fc: (h) => `+${h}시간`, p: '중심기압', w: '최대풍속', move: '이동', storm: '폭풍 반경', gale: '강풍 반경', num: (n) => `${n}호` },
    en: { btn: (n) => `🌀 Storms ${n}`, typhoon: 'Typhoon', hurricane: 'Hurricane', tc: 'Tropical cyclone', warn: (s, km, when) => `${s} approaching · forecast track passes about ${km} km from this spot${when ? ` (closest around ${when})` : ''}. Check with local dive shops.`, now: 'Now', fc: (h) => `+${h}h`, p: 'Pressure', w: 'Max wind', move: 'Moving', storm: 'Storm radius', gale: 'Gale radius', num: (n) => `No.${n}` },
    ja: { btn: (n) => `🌀 台風 ${n}`, typhoon: '台風', hurricane: 'ハリケーン', tc: '熱帯低気圧', warn: (s, km, when) => `${s}が接近中 · 予報進路はこのポイントから約${km}km${when ? `（${when}頃に最接近）` : ''}。現地ショップの案内を確認してください。`, now: '現在', fc: (h) => `+${h}時間`, p: '中心気圧', w: '最大風速', move: '進行', storm: '暴風域', gale: '強風域', num: (n) => `${n}号` },
    es: { btn: (n) => `🌀 Ciclones ${n}`, typhoon: 'Tifón', hurricane: 'Huracán', tc: 'Ciclón tropical', warn: (s, km, when) => `${s} se acerca · la trayectoria prevista pasa a unos ${km} km de este punto${when ? ` (más cerca hacia ${when})` : ''}. Consulta con los centros de buceo locales.`, now: 'Ahora', fc: (h) => `+${h} h`, p: 'Presión', w: 'Viento máx.', move: 'Rumbo', storm: 'Radio de tormenta', gale: 'Radio de temporal', num: (n) => `n.º ${n}` },
    zh: { btn: (n) => `🌀 颱風 ${n}`, typhoon: '颱風', hurricane: '颶風', tc: '熱帶氣旋', warn: (s, km, when) => `${s}接近中 · 預報路徑距此潛點約 ${km} km${when ? `（約 ${when} 最接近）` : ''}。請務必確認當地潛店資訊。`, now: '現在', fc: (h) => `+${h} 小時`, p: '中心氣壓', w: '最大風速', move: '移動', storm: '暴風半徑', gale: '強風半徑', num: (n) => `第 ${n} 號` }
  };
  const T = () => TX[L_()] || TX.en;
  // [ADD] 예보 경로가 없는 태풍(약해졌거나 온대저기압으로 바뀌어 기관 예보가 끝남) 안내
  // [ADD] 예보 기관을 아직 못 붙인 해역(인도양·남반구 등): 현재 위치만 있어요
  const NOTRACK = { ko: '이 해역은 예상 경로 자료가 아직 없어요(현재 위치만 표시) · 현지 기상청 발표를 확인하세요', en: 'No forecast track available for this basin yet (current position only) · check the local met agency', ja: 'この海域の予報進路データはまだありません（現在位置のみ）· 現地気象機関の発表を確認してください', es: 'Aún no hay trayectoria prevista para esta cuenca (solo posición actual) · consulta el servicio meteorológico local', zh: '此海域尚無預報路徑資料（僅顯示目前位置）· 請確認當地氣象機構發布' };
  // [ADD] 상세 페이지(기관별 경로 비교·영향 포인트) 링크
  const MORE = { ko: '기관별 경로 비교·영향 포인트 보기 ›', en: 'Compare agency tracks & spots in the path ›', ja: '機関別進路の比較・影響ポイント ›', es: 'Comparar trayectorias y puntos afectados ›', zh: '比較各機構路徑與受影響潛點 ›' };
  const ENDED = { ko: '공식 예보 종료 · 약해졌거나 온대저기압으로 바뀌어 예상 경로가 없어요', en: 'Official forecasts ended · weakened or became extratropical, no forecast track', ja: '公式予報終了 · 衰弱または温帯低気圧化したため予報進路はありません', es: 'Pronósticos oficiales finalizados · se debilitó o se volvió extratropical, sin trayectoria prevista', zh: '官方預報已結束 · 已減弱或轉為溫帶氣旋，無預報路徑' };
  // [ADD] 기관별 예보 경로 색: JMA 노랑 · KMA 하늘 · NHC 주황. 둘 이상이면 겹치는지(확실) 갈라지는지(불확실) 한 줄로
  const AG = { jma: { c: '#ffd27a', hex: 0xffd27a, n: { ko: '일본 기상청', en: 'JMA (Japan)', ja: '気象庁', es: 'JMA (Japón)', zh: '日本氣象廳' } }, kma: { c: '#7dd3fc', hex: 0x7dd3fc, n: { ko: '한국 기상청', en: 'KMA (Korea)', ja: '韓国気象庁', es: 'KMA (Corea)', zh: '韓國氣象廳' } }, nhc: { c: '#fb923c', hex: 0xfb923c, n: { ko: '미국 NHC', en: 'NOAA NHC', ja: '米NHC', es: 'NOAA NHC', zh: '美國 NHC' } },
    jtwc: { c: '#c4b5fd', hex: 0xc4b5fd, n: { ko: '미국 JTWC', en: 'JTWC (US Navy)', ja: '米JTWC', es: 'JTWC (EE. UU.)', zh: '美國 JTWC' } }, cwa: { c: '#86efac', hex: 0x86efac, n: { ko: '대만 기상서', en: 'CWA (Taiwan)', ja: '台湾中央気象署', es: 'CWA (Taiwán)', zh: '中央氣象署' } } }; // [ADD] JTWC·대만
  const agName = (k) => (AG[k] && (AG[k].n[L_()] || AG[k].n.en)) || k;
  const tracksOf = (s) => Object.entries(s.tracks || {}).filter(([, v]) => v && v.length);
  // 두 기관 예보가 같은 시각(±3h)에 얼마나 떨어졌는지(최대 km)
  function spread(s) { const tr = tracksOf(s); if (tr.length < 2) return null; let mx = 0; for (let i = 0; i < tr.length; i++) for (let j = i + 1; j < tr.length; j++) tr[i][1].forEach(a => { const b = tr[j][1].reduce((best, p) => (best == null || Math.abs(p.h - a.h) < Math.abs(best.h - a.h)) ? p : best, null); if (b && Math.abs(b.h - a.h) <= 3) mx = Math.max(mx, km(a.lat, a.lon, b.lat, b.lon)); }); return Math.round(mx); }
  const agree = (s) => { const sp = spread(s); if (sp == null) return ''; const t = { ko: sp <= 150 ? `기관 예보 일치 (차이 ${sp}km) · 신뢰도 높음` : sp <= 400 ? `기관 예보 다소 갈림 (차이 ${sp}km)` : `기관 예보 크게 갈림 (차이 ${sp}km) · 불확실`, en: sp <= 150 ? `Agencies agree (${sp} km apart) · high confidence` : sp <= 400 ? `Agencies differ somewhat (${sp} km)` : `Agencies disagree (${sp} km) · low confidence`, ja: sp <= 150 ? `各機関の予報が一致（差 ${sp}km）・信頼度高` : sp <= 400 ? `予報がやや分かれる（差 ${sp}km）` : `予報が大きく分かれる（差 ${sp}km）・不確実`, es: sp <= 150 ? `Las agencias coinciden (${sp} km) · alta confianza` : sp <= 400 ? `Las agencias difieren algo (${sp} km)` : `Las agencias discrepan (${sp} km) · baja confianza`, zh: sp <= 150 ? `各機構預報一致（差 ${sp}km）・可信度高` : sp <= 400 ? `預報略有分歧（差 ${sp}km）` : `預報分歧大（差 ${sp}km）・不確定` }; return t[L_()] || t.en; };
  const kind = (s) => s.src === 'nhc' ? T().hurricane : (s.cat === 'TY' || s.cat === 'STS' || s.cat === 'TS') ? T().typhoon : T().tc;
  const label = (s) => `${kind(s)}${s.num ? ' ' + T().num(s.num) : ''} ${L_() === 'ko' && s.nameKo ? s.nameKo : s.name}`;
  const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  // 점과 선분(위경도) 사이 최소 거리(km) - 짧은 구간이라 평면 근사
  function segKm(lat, lon, a, b) { const cl = Math.cos(lat * Math.PI / 180); const ax = (a[1] - lon) * cl, ay = a[0] - lat, bx = (b[1] - lon) * cl, by = b[0] - lat; const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy; let t = l2 ? -(ax * dx + ay * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(ax + t * dx, ay + t * dy) * 111.32; }
  // 포인트에서 태풍 예보 경로까지 가장 가까운 거리 → { s, km, h } 또는 null
  window.stormNear = function (st) {
    if (!st || !st.coords || !data.storms.length) return null; const lat = st.coords[1], lon = st.coords[0]; let best = null;
    data.storms.forEach(s => { const trs = tracksOf(s).map(([, v]) => v); if (!trs.length) trs.push(s.forecast || []); trs.forEach(fc => { const pts = [[s.lat, s.lon, 0], ...fc.map(f => [f.lat, f.lon, f.h])]; for (let i = 0; i < pts.length; i++) { let d = km(lat, lon, pts[i][0], pts[i][1]); let h = pts[i][2];
      if (i > 0) { const sd = segKm(lat, lon, pts[i - 1], pts[i]); if (sd < d) { d = sd; h = (pts[i - 1][2] + pts[i][2]) / 2; } }
      const r = (i > 0 && fc[i - 1] && fc[i - 1].storm) || s.radii.storm || 0; // 폭풍 반경만큼 가까워진 걸로
      if (!best || d - r < best.km) best = { s, km: Math.max(0, Math.round(d - r)), h }; } }); });
    return best && best.km <= NEAR_KM ? best : null;
  };

  // ── 태풍 구름 그림(캔버스로 그려요): 북반구는 반시계 방향으로 감기는 나선, 남반구는 시계 방향. 세기(풍속)에 따라 크기·진하기가 달라져요 ──
  const cloudCache = {};
  function stormCloud(south, level, mode) { // level 0~3 (TD · TS · STS/TY · 강한 TY) - 위성 구름처럼 또렷한 나선 팔. mode 'globe'=중심 진하게, 'map'=가장자리 옅게(지형이 보이게)
    const key = (south ? 's' : 'n') + level + (mode || ''); if (cloudCache[key]) return cloudCache[key]; const G = mode === 'globe', M = mode === 'map';
    const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d'); const cx = S / 2, cy = S / 2;
    const alpha = [.6, .72, .86, .96][level], arms = [2, 3, 4, 5][level], tight = [.34, .30, .27, .24][level], core = [.12, .16, .21, .26][level] * (G ? 1.25 : 1);
    x.translate(cx, cy); if (!south) x.scale(-1, 1); x.translate(-cx, -cy); // 북반구: 팔이 바깥으로 갈수록 시계 방향(반시계로 돌면 안으로 감기는 모양). 남반구는 거울상
    const rnd = (i) => (Math.sin(i * 12.9898 + level * 78.233) * 43758.5453) % 1; // 고정 난수(모양이 매번 같게)
    let g = x.createRadialGradient(cx, cy, 6, cx, cy, S * core); g.addColorStop(0, `rgba(255,255,255,${G ? 1 : alpha})`); g.addColorStop(.75, `rgba(255,255,255,${alpha * (G ? .95 : .8)})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, S * core, 0, Math.PI * 2); x.fill(); if (G) { x.fill(); }
    for (let a = 0; a < arms; a++) { const a0 = a / arms * Math.PI * 2 + rnd(a) * .4;
      for (let i = 0; i < 360; i++) { const t = i / 360, th = a0 + t * Math.PI * 2.4, r = (S * core * .45) * Math.exp((th - a0) * tight); if (r > S * .47) break;
        const jit = (Math.abs(rnd(i * 7 + a)) - .5) * 18 * (1 + t), px = cx + (r + jit) * Math.cos(th), py = cy - (r + jit) * Math.sin(th), w = 7 + 18 * t + Math.abs(rnd(i * 3 + a)) * 7;
        const fa = alpha * (1 - t * (M ? .9 : .75)) * (.42 + Math.abs(rnd(i * 5 + a)) * .3) * (M ? 1 - t * .35 : 1); g = x.createRadialGradient(px, py, 0, px, py, w); g.addColorStop(0, `rgba(255,255,255,${fa})`); g.addColorStop(.62, `rgba(255,255,255,${fa * .85})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.arc(px, py, w, 0, Math.PI * 2); x.fill(); } }
    if (level >= 2) { x.save(); x.globalCompositeOperation = 'destination-out'; const e = 10 + level * 5; g = x.createRadialGradient(cx, cy, 0, cx, cy, e); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(.65, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, e, 0, Math.PI * 2); x.fill(); x.restore(); }
    x.save(); x.globalCompositeOperation = 'destination-in'; g = x.createRadialGradient(cx, cy, S * (M ? .16 : .3), cx, cy, S * .5); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(M ? .5 : 1, M ? 'rgba(0,0,0,.45)' : 'rgba(0,0,0,0)'); if (M) g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, S, S); x.restore();
    cloudCache[key] = c; return c;
  }
  const urlCache = {}; const cloudUrl = (south, level) => { const k = (south ? 's' : 'n') + level; return urlCache[k] || (urlCache[k] = stormCloud(south, level, 'map').toDataURL('image/png')); };
  const levelOf = (s) => { const w = s.wind || 0; return w >= 44 ? 3 : w >= 25 ? 2 : w >= 17 ? 1 : 0; };
  const cloudKm = (s) => Math.max(150, Math.min(900, (s.radii.gale || s.radii.storm * 1.8 || (120 + (s.wind || 15) * 8)) * 1.6)); // 구름 반지름(km): 강풍 반경의 1.6배쯤(위성 구름대가 더 넓어요)
  // [ADD] 실시간 현황 표에서 고른 시각에 태풍이 있을 자리 - 예보 경로를 따라 직선 보간. 지금·과거는 현재 위치
  function posAt(s, ms) {
    const at = Date.parse(s.at) || data.at || Date.now(); if (ms == null || ms <= at) return { lat: s.lat, lon: s.lon, h: 0 };
    const fcs = (s.forecast && s.forecast.length) ? s.forecast : ((tracksOf(s)[0] || [])[1] || []);
    const pts = [{ t: at, lat: s.lat, lon: s.lon }].concat(fcs.map(f => ({ t: (f.t && Date.parse(f.t)) || at + (f.h || 0) * 3600e3, lat: f.lat, lon: f.lon })).filter(p => p.lat != null && p.t > at)).sort((a, b) => a.t - b.t);
    const h = Math.round((ms - at) / 3600e3), last = pts[pts.length - 1]; if (ms >= last.t) return { lat: last.lat, lon: last.lon, h };
    for (let i = 1; i < pts.length; i++) if (ms <= pts[i].t) { const a = pts[i - 1], b = pts[i], k = (ms - a.t) / (b.t - a.t || 1); return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, h }; }
    return { lat: s.lat, lon: s.lon, h: 0 };
  }
  const hTag = (p) => p.h > 0 ? ` <span class="st-h">+${p.h}h</span>` : '';
  // ── 지구본 ──
  function drawGlobe() {
    if (typeof globeGroup === 'undefined' || !globeGroup || typeof THREE === 'undefined') return;
    if (gGroup) { globeGroup.remove(gGroup); gGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); gGroup = null; }
    if (!on || !data.storms.length) { if (window.requestGlobeRender) requestGlobeRender(); return; }
    gGroup = new THREE.Group(); const R = GLOBE_RADIUS + 0.6;
    const line = (pts, color, dashed) => { if (pts.length < 2) return; const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => latLonToSpherePos(p[0], p[1], R))); const m = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: .9 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity: .85 }); const l = new THREE.Line(g, m); if (dashed) l.computeLineDistances(); gGroup.add(l); };
    const ring = (lat, lon, rkm, color, op) => { if (!rkm) return; const n = 48, pts = []; for (let i = 0; i <= n; i++) { const a = i / n * 2 * Math.PI, dl = rkm / 111.32, la = lat + dl * Math.cos(a), lo = lon + dl * Math.sin(a) / Math.cos(lat * Math.PI / 180); pts.push([la, lo]); } const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => latLonToSpherePos(p[0], p[1], R))); gGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: op }))); };
    data.storms.forEach(s => {
      const pv = posAt(s, viewMs);
      line(s.track, 0xffffff, false);
      const trs = tracksOf(s); if (!trs.length && s.forecast && s.forecast.length) trs.push([s.src, s.forecast]);
      trs.forEach(([k, fc]) => { const hex = (AG[k] || AG.jma).hex; line([[s.lat, s.lon], ...fc.map(f => [f.lat, f.lon])], hex, true); fc.forEach(f => ring(f.lat, f.lon, f.r, hex, .4)); });
      ring(pv.lat, pv.lon, s.radii.storm, 0xf87171, .9); ring(pv.lat, pv.lon, s.radii.gale, 0xfbbf24, .7);
      // 구름 그림(반구·세기별) - 지구본에 납작하게 붙여요. 크기는 강풍 반경 기준
      { const tex = new THREE.CanvasTexture(stormCloud(s.lat < 0, levelOf(s), 'globe')); const rk = cloudKm(s), size = rk / 111.32 * (Math.PI / 180) * GLOBE_RADIUS * 2;
        const geo = new THREE.PlaneGeometry(size, size), mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 1, depthWrite: false }); const mesh = new THREE.Mesh(geo, mat); // 지구본은 구름을 또렷하게(지형보다 태풍이 중요)
        const p = latLonToSpherePos(pv.lat, pv.lon, GLOBE_RADIUS + 0.9); mesh.position.copy(p); mesh.lookAt(p.clone().multiplyScalar(2)); mesh.userData.spin = s.lat < 0 ? -1 : 1; gGroup.add(mesh); }
      // 기호 + 이름(캔버스 스프라이트)
      const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
      x.font = 'bold 26px sans-serif'; x.textBaseline = 'middle'; x.fillStyle = 'rgba(0,0,0,.55)'; const txt = `🌀 ${s.num ? s.num + ' ' : ''}${s.name}${pv.h > 0 ? ' +' + pv.h + 'h' : ''}`; const w = x.measureText(txt).width + 16; x.fillRect(0, 10, Math.min(256, w), 44); x.fillStyle = '#fff'; x.fillText(txt, 8, 32);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false })); sp.scale.set(14, 3.5, 1); const p = latLonToSpherePos(pv.lat, pv.lon, R + 1.5); sp.position.copy(p); sp.center.set(0, .5); gGroup.add(sp);
    });
    globeGroup.add(gGroup); if (window.requestGlobeRender) requestGlobeRender();
    // 구름을 천천히 돌려요(북반구 반시계·남반구 시계). 지구본이 보일 때만 1초에 몇 번
    if (!drawGlobe._spin) { drawGlobe._spin = true; let last = 0; const tick = (ts) => { requestAnimationFrame(tick); if (!gGroup || document.hidden || (typeof isDetailMode !== 'undefined' && isDetailMode) || ts - last < 120) return; last = ts; gGroup.children.forEach(m => { if (m.userData && m.userData.spin) m.rotateZ(.025 * m.userData.spin); }); if (window.requestGlobeRender) requestGlobeRender(); }; requestAnimationFrame(tick); }
  }
  // ── 상세 지도 ──
  function drawMap() {
    const map = typeof leafletMap !== 'undefined' ? leafletMap : null; if (!map) return;
    if (!mapLayer) mapLayer = L.layerGroup(); mapLayer.clearLayers();
    if (!moveLayer) { moveLayer = L.layerGroup(); if (!map.getPane('stcloud')) { const pn = map.createPane('stcloud'); pn.style.zIndex = 450; pn.style.pointerEvents = 'none'; } map.on('zoomend', () => { if (map.hasLayer(moveLayer)) drawMoving(); }); }
    if (!on || !data.storms.length) { if (map.hasLayer(mapLayer)) map.removeLayer(mapLayer); if (map.hasLayer(moveLayer)) map.removeLayer(moveLayer); return; }
    const t = T();
    data.storms.forEach(s => {
      if (s.track.length > 1) L.polyline(s.track, { color: '#fff', weight: 2, opacity: .8, interactive: false }).addTo(mapLayer);
      const trs = tracksOf(s); if (!trs.length && s.forecast && s.forecast.length) trs.push([s.src, s.forecast]);
      trs.forEach(([k, fcs]) => { const col = (AG[k] || AG.jma).c, fc = [[s.lat, s.lon], ...fcs.map(f => [f.lat, f.lon])];
        if (fc.length > 1) L.polyline(fc, { color: col, weight: 2, dashArray: '6 5', opacity: .9, interactive: false }).addTo(mapLayer);
        fcs.forEach(f => { if (f.r) L.circle([f.lat, f.lon], { radius: f.r * 1000, color: col, weight: 1, dashArray: '4 4', fill: false, interactive: false }).addTo(mapLayer);
          L.circleMarker([f.lat, f.lon], { radius: 4, color: col, fillColor: '#0B1120', fillOpacity: 1, weight: 1.5 }).bindTooltip(`${agName(k)} ${t.fc(f.h)}${f.pressure ? ` · ${f.pressure}hPa` : ''}${f.wind ? ` · ${f.wind}m/s` : ''}`, { direction: 'top' }).addTo(mapLayer); }); });
    });
    if (!map.hasLayer(mapLayer)) mapLayer.addTo(map);
    drawMoving();
  }
  // 시각 따라 움직이는 것만(구름·현재 반경·기호) 다시 그려요 - 표를 넘길 때, 확대/축소할 때. 구름은 제자리에서 돌기만(이미지 자체를 회전)
  function drawMoving() {
    const map = typeof leafletMap !== 'undefined' ? leafletMap : null; if (!map || !moveLayer) return; moveLayer.clearLayers(); if (!on || !data.storms.length) return;
    const t = T(), z = map.getZoom();
    data.storms.forEach(s => {
      const p = posAt(s, viewMs), rk = cloudKm(s), south = s.lat < 0;
      const mpp = 40075016.686 * Math.cos(p.lat * Math.PI / 180) / (256 * Math.pow(2, z)), px = Math.max(24, Math.round(rk * 2000 / mpp)); // 구름 지름(px) = 반지름(km)×2 / (m/px)
      L.marker([p.lat, p.lon], { pane: 'stcloud', interactive: false, keyboard: false, icon: L.divIcon({ className: 'st-cloud-box', html: `<img class="st-cloud ${south ? 'south' : 'north'}" src="${cloudUrl(south, levelOf(s))}" style="width:${px}px;height:${px}px" alt="">`, iconSize: [px, px], iconAnchor: [px / 2, px / 2] }) }).addTo(moveLayer);
      if (s.radii.gale) L.circle([p.lat, p.lon], { radius: s.radii.gale * 1000, color: '#fbbf24', weight: 1, fillColor: '#fbbf24', fillOpacity: .08, interactive: false }).addTo(moveLayer);
      if (s.radii.storm) L.circle([p.lat, p.lon], { radius: s.radii.storm * 1000, color: '#f87171', weight: 1.5, fillColor: '#f87171', fillOpacity: .15, interactive: false }).addTo(moveLayer);
      const info = [`<b>${label(s)}</b>${p.h > 0 ? ` <span class="st-h">${t.fc(p.h)}</span>` : ''}`, s.pressure ? `${t.p} ${s.pressure}hPa` : '', s.wind ? `${t.w} ${s.wind}m/s${s.gust ? ` (gust ${s.gust})` : ''}` : '', s.move && (s.move.dir || s.move.kmh) ? `${t.move} ${s.move.dir || ''} ${s.move.kmh ? s.move.kmh + 'km/h' : ''}` : '', s.radii.storm ? `${t.storm} ${s.radii.storm}km` : '', s.radii.gale ? `${t.gale} ${s.radii.gale}km` : '', tracksOf(s).map(([k]) => `<span style="color:${(AG[k] || AG.jma).c}">━ ━</span> ${agName(k)}`).join(' · '), agree(s) ? `<b>${agree(s)}</b>` : '', s.ended ? `<span style="color:#94a3b8">${ENDED[L_()] || ENDED.en}</span>` : '', s.noTrack ? `<span style="color:#94a3b8">${NOTRACK[L_()] || NOTRACK.en}</span>` : '', s.slug ? `<a href="/${L_()}/t/${encodeURIComponent(s.slug)}" style="color:#ffd27a;font-weight:700">${(MORE[L_()] || MORE.en)}</a>` : ''].filter(Boolean).join('<br>');
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="st-eye">🌀</div><div class="st-name">${s.num ? s.num + ' ' : ''}${s.name}${hTag(p)}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }), zIndexOffset: 900 }).bindPopup(info).addTo(moveLayer);
    });
    if (!map.hasLayer(moveLayer)) moveLayer.addTo(map);
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
    const ag = agree(near.s); warnEl.textContent = `🌀 ${T().warn(label(near.s), near.km, when)}${ag ? ' ' + ag : ''} `; warnEl.style.display = '';
    if (near.s.slug) { const a = document.createElement('a'); a.href = `/${L_()}/t/${encodeURIComponent(near.s.slug)}`; a.textContent = MORE[L_()] || MORE.en; a.style.cssText = 'color:#ffd27a;font-weight:700;text-decoration:underline'; warnEl.appendChild(a); }
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
  .st-eye{font-size:20px;line-height:40px;text-align:center;filter:drop-shadow(0 0 4px rgba(0,0,0,.8))}
  .st-cloud{display:block;opacity:.5;animation:st-spin 70s linear infinite;transform-origin:50% 50%;mix-blend-mode:screen;will-change:transform} /* 지도에선 지형이 더 중요하니 반투명 */ .st-cloud.south{animation-direction:reverse} @keyframes st-spin{from{transform:rotate(0)}to{transform:rotate(-360deg)}} .st-cloud-box{background:none;border:0} .st-h{color:#fde68a;font-weight:600;margin-left:3px} @media (prefers-reduced-motion:reduce){.st-cloud{animation:none}}
  .st-name{position:absolute;left:50%;top:38px;transform:translateX(-50%);white-space:nowrap;font-size:12px;font-weight:700;color:#fff;background:rgba(127,29,29,.8);padding:1px 6px;border-radius:6px}`;
  document.head.appendChild(css);
  // 지도가 열릴 때·정점이 바뀔 때 따라가기
  const f = window.showDetailMap; if (typeof f === 'function') window.showDetailMap = function () { const r = f.apply(this, arguments); setTimeout(drawMap, 300); return r; };
  const u = window.updateLeafletSelection; if (typeof u === 'function') window.updateLeafletSelection = function () { const r = u.apply(this, arguments); paintWarn(); return r; };
  // [ADD] 실시간 현황 표를 넘기면 그 시각의 자리로(예보 경로 보간, 이름 옆에 +N h). 지금 근처(±20분)·과거면 현재 위치. 정점을 바꾸면 지금으로
  window.stormSetTime = function (ms) { viewMs = ms; if (window.stormSetTime._raf) return; window.stormSetTime._raf = requestAnimationFrame(() => { window.stormSetTime._raf = 0; if (typeof isDetailMode !== 'undefined' && isDetailMode) { drawMoving(); globeDirty = true; } else drawGlobe(); }); };
  const fd = window.windDialSetTime; if (typeof fd === 'function') window.windDialSetTime = function (x) { try { const st = typeof selectedStation !== 'undefined' ? selectedStation : null, d = st && st._hourlyCache; const real = d && typeof x === 'number' ? x - Math.round((d.nowLocalMs - Date.now()) / 60000) * 60000 : null; const nv = real != null && Math.abs(real - Date.now()) > 20 * 60e3 ? real : null; if (nv !== viewMs) window.stormSetTime(nv); } catch (_) {} return fd.apply(this, arguments); };
  const fs = window.selectStation; if (typeof fs === 'function') window.selectStation = function () { const r = fs.apply(this, arguments); if (viewMs != null) window.stormSetTime(null); return r; };
  const fg = window.switchToGlobe; if (typeof fg === 'function') window.switchToGlobe = function () { const r = fg.apply(this, arguments); if (globeDirty) { globeDirty = false; drawGlobe(); } return r; };
  document.addEventListener('DOMContentLoaded', () => { setTimeout(load, 4000); setInterval(load, REFRESH); });
  window.stormsData = () => data; window.stormsOn = () => on;
})();
