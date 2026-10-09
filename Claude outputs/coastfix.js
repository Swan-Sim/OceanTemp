
// [ADD] 거친 수심(GMRT 중 GEBCO 수준) "영점 맞추기": OpenStreetMap 해안선으로 육지/바다를 다시 정하고,
//  해안선에서 수심 0m가 되도록 가까운 바다를 얕게 눌러 줘요(해안에서 멀어질수록 원래 값으로). 작은 섬 옆에 엉뚱한 깊은 구덩이가 생기던 문제 완화.
//  해안선: Overpass API(OSM, ODbL) way["natural"="coastline"]. OSM 규칙상 선의 진행 방향 왼쪽이 육지예요.
async function coastSegments(b) {
  const q = `[out:json][timeout:25];way["natural"="coastline"](${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)});out geom;`;
  const t = await getText('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'otemp.app depth layer' } }, 25000);
  const j = JSON.parse(t), segs = [];
  (j.elements || []).forEach(w => { const g = w.geometry || []; for (let i = 1; i < g.length; i++) if (g[i - 1] && g[i]) segs.push([g[i - 1].lat, g[i - 1].lon, g[i].lat, g[i].lon]); });
  return segs;
}
function coastFix(g, segs) {
  if (!segs.length) return { changed: 0 };
  const lat0 = g.la0 + (g.rows - 1) * g.dla / 2, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  // 조각을 약 300m 칸 바구니에 나눠 담아 가까운 것만 찾기
  const B = 300, key = (x, y) => Math.floor(x / B) + '_' + Math.floor(y / B), bins = new Map();
  const S = segs.map(s => { const x1 = (s[1] - g.lo0) * kx, y1 = (s[0] - g.la0) * ky, x2 = (s[3] - g.lo0) * kx, y2 = (s[2] - g.la0) * ky; return [x1, y1, x2, y2]; });
  S.forEach((s, i) => { const n = Math.max(1, Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / (B / 2)));
    for (let k = 0; k <= n; k++) { const x = s[0] + (s[2] - s[0]) * k / n, y = s[1] + (s[3] - s[1]) * k / n, kk = key(x, y); (bins.get(kk) || bins.set(kk, new Set()).get(kk)).add(i); } });
  const SLOPE = 0.35; // 해안에서 1m 멀어질 때 최대 0.35m 깊어짐(약 19°) - 이보다 깊으면 눌러 줌
  let changed = 0;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const px = c * g.dlo * kx, py = r * g.dla * ky;
    let best = Infinity, side = 0;
    for (let ring = 0; ring <= 6 && best === Infinity; ring++) { // 가까운 바구니부터 넓혀 가며
      const bx = Math.floor(px / B), by = Math.floor(py / B);
      for (let ix = bx - ring; ix <= bx + ring; ix++) for (let iy = by - ring; iy <= by + ring; iy++) {
        if (Math.max(Math.abs(ix - bx), Math.abs(iy - by)) !== ring) continue;
        const set = bins.get(ix + '_' + iy); if (!set) continue;
        set.forEach(i => { const s = S[i], dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1;
          const tt = Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / L2)), qx = s[0] + dx * tt, qy = s[1] + dy * tt, d = Math.hypot(px - qx, py - qy);
          if (d < best) { best = d; side = dx * (py - s[1]) - dy * (px - s[0]); } }); // > 0 이면 선의 왼쪽 = 육지
      }
    }
    if (best === Infinity) continue; // 근처(약 2km)에 해안선 없음 → 그대로
    const i = r * g.cols + c, v = g.z[i];
    if (side > 0) { if (v == null || v < 0) { g.z[i] = 2; changed++; } continue; } // 육지
    const cap = -Math.max(1, best * SLOPE); // 해안 가까운 바다의 최대 깊이(음수)
    if (v == null || v >= 0) { g.z[i] = Math.max(cap, -Math.min(30, best * SLOPE * 0.6)); changed++; } // 원래 육지로 잘못 잡힌 바다
    else if (v < cap) { g.z[i] = Math.round(cap * 10) / 10; changed++; }
  }
  return { changed };
}
