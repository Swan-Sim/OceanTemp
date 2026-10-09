// [CHANGE] 이동량은 "해안선 덩어리"마다 따로 재요(작은 섬 하나, 긴 해안은 약 3km씩 나눔).
//  각 덩어리 가운데에 "이만큼 옮기면 맞는다"는 점(기준점)을 두고, 지도 위 어느 곳이든 반경 2.4km 안 기준점들의 값을
//  가까울수록 크게 섞어서 옮겨요. 기준점에서 멀어지면(먼바다) 점점 0으로. 같은 기준점을 모든 칸이 같이 쓰니 칸 경계에서 이어져요.
//  수심 값은 원본 그대로, 위치만 옮김.
const CTL_R = 2400;
async function coastLines(b) {
  const q = `[out:json][timeout:25];way["natural"="coastline"](${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)});out geom;`;
  const t = await getText('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'otemp.app depth layer' } }, 25000);
  const ways = (JSON.parse(t).elements || []).map(w => (w.geometry || []).filter(Boolean).map(p => [p.lat, p.lon])).filter(l => l.length >= 2);
  // 끝점이 이어진 길끼리 합치기(섬 하나 = 한 덩어리)
  const K = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6), lines = ways.slice();
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < lines.length && !merged; i++) for (let j = 0; j < lines.length && !merged; j++) {
      if (i === j) continue; const a = lines[i], c = lines[j];
      if (K(a[a.length - 1]) === K(c[0])) { lines[i] = a.concat(c.slice(1)); lines.splice(j, 1); merged = true; }
    }
  }
  return lines;
}
async function tileControls(x, y) {
  const ck = `tctl:v1:${x}_${y}`;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {}
  const t = tileBox(x, y), P = 0.03, b = { s: t.s - P, n: t.n + P, w: t.w - P, e: t.e + P };
  const lines = await coastLines(b); // 실패하면 저장 안 함
  const kx = Math.cos((t.s + t.n) / 2 * Math.PI / 180) * 111320, ky = 111320;
  // 덩어리 나누기: 둘레 6km 이하는 통째로, 긴 것은 3km씩
  const chunks = [];
  lines.forEach(l => {
    let len = 0; for (let i = 1; i < l.length; i++) len += Math.hypot((l[i][1] - l[i - 1][1]) * kx, (l[i][0] - l[i - 1][0]) * ky);
    if (len <= 6000) { chunks.push(l); return; }
    let cur = [l[0]], acc = 0;
    for (let i = 1; i < l.length; i++) { const d = Math.hypot((l[i][1] - l[i - 1][1]) * kx, (l[i][0] - l[i - 1][0]) * ky); cur.push(l[i]); acc += d;
      if (acc >= 3000) { chunks.push(cur); cur = [l[i]]; acc = 0; } }
    if (cur.length >= 2) chunks.push(cur);
  });
  // 이 칸 안에 가운데가 있는 덩어리만 이 칸이 맡음(이웃 칸과 겹치지 않게)
  const mine = chunks.map(c => ({ c, la: c.reduce((a, p) => a + p[0], 0) / c.length, lo: c.reduce((a, p) => a + p[1], 0) / c.length }))
    .filter(o => o.la >= t.s && o.la < t.n && o.lo >= t.w && o.lo < t.e);
  let ctl = [];
  if (mine.length) {
    const r = await fromGmrt(b);
    if (!r) throw new Error('gmrt');
    for (const o of mine) {
      const segs = []; for (let i = 1; i < o.c.length; i++) segs.push([o.c[i - 1][0], o.c[i - 1][1], o.c[i][0], o.c[i][1]]);
      const g = Object.assign({}, r.grid); // coastShift가 시작점을 바꿔서 복사본에
      const m = coastShift(g, segs);
      if (m) ctl.push({ la: +o.la.toFixed(5), lo: +o.lo.toFixed(5), dx: m.dx, dy: m.dy, n: segs.length });
    }
  }
  try { await redisPipeline([['SET', ck, JSON.stringify(ctl), 'EX', String(180 * 86400)]]); } catch (_) {}
  return ctl;
}
async function warpByShiftField(g, x, y) {
  const ctl = [];
  for (const j of [-1, 0, 1]) for (const i of [-1, 0, 1]) { const c = await tileControls(x + i, y + j).catch(() => null); if (c) ctl.push(...c); } // 하나씩(해안선 서버 보호)
  if (!ctl.length) return null;
  const kx = Math.cos((g.la0 + g.rows * g.dla / 2) * Math.PI / 180) * 111320, ky = 111320;
  const field = (la, lo) => { let sw = 0, sx = 0, sy = 0;
    for (const c of ctl) { const d = Math.hypot((lo - c.lo) * kx, (la - c.la) * ky); if (d >= CTL_R) continue;
      const w = (1 - d / CTL_R) ** 2 * Math.min(1, c.n / 15); sw += w; sx += w * c.dx; sy += w * c.dy; }
    const den = sw + 0.15; return [sx / den, sy / den]; };
  const z0 = g.z.slice();
  const at = (la, lo) => { const fi = (la - g.la0) / g.dla, fj = (lo - g.lo0) / g.dlo; if (fi < 0 || fj < 0 || fi > g.rows - 1 || fj > g.cols - 1) return null;
    const i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j, q = [z0[i * g.cols + j], z0[i * g.cols + j + 1], z0[(i + 1) * g.cols + j], z0[(i + 1) * g.cols + j + 1]];
    if (q.some(v => v == null)) return q[Math.round(a) * 2 + Math.round(b)] ?? q.find(v => v != null) ?? null;
    return q[0] * (1 - a) * (1 - b) + q[1] * (1 - a) * b + q[2] * a * (1 - b) + q[3] * a * b; };
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const la = g.la0 + r * g.dla, lo = g.lo0 + c * g.dlo, [dx, dy] = field(la, lo);
    g.z[r * g.cols + c] = at(la - dy / ky, lo - dx / kx);
  }
  const ctr = field(g.la0 + g.rows * g.dla / 2, g.lo0 + g.cols * g.dlo / 2);
  return [Math.round(ctr[0]), Math.round(ctr[1])];
}

