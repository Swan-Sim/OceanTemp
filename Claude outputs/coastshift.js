// [CHANGE] 거친 수심 "영점 맞추기" = 값을 고치지 않고 격자 전체를 옮기기(평행 이동)만 해요.
//  OpenStreetMap 해안선(선의 왼쪽이 육지)을 기준으로, 격자를 동서남북 ±1.5km 안에서 50m씩 옮겨 보며
//  "해안선 위는 얕고, 해안에서 바다 쪽 300m는 깊은" 위치를 찾아 그만큼 옮겨요. 수심 값 자체는 원래 자료 그대로예요.
function coastShift(g, segs) {
  if (!segs.length) return null;
  const lat0 = g.la0 + (g.rows - 1) * g.dla / 2, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  // 해안선 위 점(약 60m 간격)과, 그 점에서 바다 쪽(선의 오른쪽)으로 300m 떨어진 점
  const coast = [], sea = [];
  segs.forEach(s => {
    const x1 = s[1] * kx, y1 = s[0] * ky, x2 = s[3] * kx, y2 = s[2] * ky, L = Math.hypot(x2 - x1, y2 - y1); if (!L) return;
    const nx = (y2 - y1) / L, ny = -(x2 - x1) / L; // 오른쪽(바다) 방향
    for (let d = 0; d < L; d += 60) { const x = x1 + (x2 - x1) * d / L, y = y1 + (y2 - y1) * d / L; coast.push([x, y]); sea.push([x + nx * 300, y + ny * 300]); }
  });
  if (coast.length < 5) return null;
  const step = Math.max(1, Math.floor(coast.length / 600)); // 점이 너무 많으면 골고루 줄이기
  const C = coast.filter((_, i) => i % step === 0), Sx = sea.filter((_, i) => i % step === 0);
  const z = (x, y) => { // 미터 좌표 → 격자 값(쌍선형, 밖이면 NaN, 빈 칸=육지 +2)
    const fi = (y / ky - g.la0) / g.dla, fj = (x / kx - g.lo0) / g.dlo; if (fi < 0 || fj < 0 || fi > g.rows - 1 || fj > g.cols - 1) return NaN;
    const i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j, G = (r, c) => { const v = g.z[r * g.cols + c]; return v == null ? 2 : v; };
    return G(i, j) * (1 - a) * (1 - b) + G(i, j + 1) * (1 - a) * b + G(i + 1, j) * a * (1 - b) + G(i + 1, j + 1) * a * b; };
  const score = (dx, dy) => { // 작을수록 좋음: 해안선 위 수심(얕을수록) - 0.5 × 바다 쪽 300m 수심(깊을수록)
    let a = 0, n = 0, w = 0, m = 0;
    for (let k = 0; k < C.length; k++) { const v = z(C[k][0] - dx, C[k][1] - dy), u = z(Sx[k][0] - dx, Sx[k][1] - dy);
      if (!isNaN(v)) { a += Math.max(0, -v); n++; } if (!isNaN(u)) { w += Math.max(0, -u); m++; } }
    return n < 5 || m < 5 ? Infinity : a / n - 0.5 * w / m; };
  const base = score(0, 0); let best = { dx: 0, dy: 0, s: base };
  for (let dx = -1500; dx <= 1500; dx += 100) for (let dy = -1500; dy <= 1500; dy += 100) { const s = score(dx, dy); if (s < best.s) best = { dx, dy, s }; }
  for (let dx = best.dx - 100; dx <= best.dx + 100; dx += 25) for (let dy = best.dy - 100; dy <= best.dy + 100; dy += 25) { const s = score(dx, dy); if (s < best.s) best = { dx, dy, s }; }
  // 확실히 나아질 때만 옮김(점수 차 3m 이상)
  if (!(base - best.s >= 3) || (!best.dx && !best.dy)) return { dx: 0, dy: 0, moved: false };
  g.la0 += best.dy / ky; g.lo0 += best.dx / kx;
  return { dx: best.dx, dy: best.dy, moved: true };
}
