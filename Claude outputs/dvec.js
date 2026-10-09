
// [ADD] 수심 타일을 서버에서 미리 "그림(벡터)"으로 만들어 두기 - 앱은 받은 다각형·선을 그대로 그리기만 해요(계산·로딩 거의 없음)
//  fills: 수심 0·10·20·30·40·50·60·80·100m 이상 구역 다각형(아래에서부터 겹쳐 칠하면 깊을수록 진해짐, 일러스트처럼 단색 띠)
//  lines: 10m 간격 등심선, lbl: 30·40·60m 선 위 숫자 후보. 좌표는 [위도, 경도] 소수 5자리. 180일 저장 + CDN 30일
const FILL_T = [1, 10, 20, 30, 40, 50, 60, 80, 100];
function clipRing(ring, t) { // Sutherland–Hodgman: 타일 네모 안쪽만
  const edges = [[p => p[0] >= t.s, (a, b) => ix(a, b, 0, t.s)], [p => p[0] <= t.n, (a, b) => ix(a, b, 0, t.n)], [p => p[1] >= t.w, (a, b) => ix(a, b, 1, t.w)], [p => p[1] <= t.e, (a, b) => ix(a, b, 1, t.e)]];
  function ix(a, b, k, v) { const r = (v - a[k]) / (b[k] - a[k]); return k === 0 ? [v, a[1] + (b[1] - a[1]) * r] : [a[0] + (b[0] - a[0]) * r, v]; }
  let out = ring;
  for (const [inside, cut] of edges) {
    const inp = out; out = []; if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) { const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); } else if (inside(prev)) out.push(cut(prev, cur)); }
  }
  return out;
}
const q5 = (v) => Math.round(v * 1e5) / 1e5;
function thin(pts, tol) { // 가까운 점 빼기(약 2m)
  const out = []; for (const p of pts) { const r = [q5(p[0]), q5(p[1])], l = out[out.length - 1]; if (!l || Math.abs(l[0] - r[0]) > tol || Math.abs(l[1] - r[1]) > tol) out.push(r); }
  return out;
}
async function depthVec(x, y) {
  x = parseInt(x, 10); y = parseInt(y, 10);
  const ck = 'dvec:v1:' + x + '_' + y;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {}
  const d = await depthTile(x, y);
  if (!d || !d.ok) return d;
  const t = d.tile;
  let out = { ok: true, x, y, tile: t, src: d.src, empty: true };
  if (d.grid) {
    const g = d.grid, U = 2, R = (g.rows - 1) * U + 1, C = (g.cols - 1) * U + 1;
    const gz = (i, j) => { const v = g.z[i * g.cols + j]; return v == null ? (d.nullLand ? 3 : 1) : v; };
    const laN = g.la0 + (g.rows - 1) * g.dla, dla = g.dla / U, dlo = g.dlo / U;
    // 수심(양수) 격자, 위쪽 줄 = 북쪽(d3-contour 방향)
    const V = new Float64Array(R * C);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const fi = (R - 1 - r) / U, fj = c / U, i = Math.min(g.rows - 2, Math.floor(fi)), j = Math.min(g.cols - 2, Math.floor(fj)), a = fi - i, b = fj - j;
      V[r * C + c] = -(gz(i, j) * (1 - a) * (1 - b) + gz(i, j + 1) * (1 - a) * b + gz(i + 1, j) * a * (1 - b) + gz(i + 1, j + 1) * a * b);
    }
    const toLL = (p) => [laN - (p[1] - 0.5) * dla, g.lo0 + (p[0] - 0.5) * dlo];
    const { contours } = require('./_contours');
    const maxD = Math.max(...V);
    const fills = contours().size([C, R]).thresholds(FILL_T.filter(v => v <= maxD))(Array.from(V)).map(mp => ({
      d: mp.value,
      p: mp.coordinates.map(poly => poly.map(ring => thin(clipRing(ring.map(toLL), t), 1.5e-5)).filter(r => r.length >= 3)).filter(poly => poly.length && poly[0].length >= 3)
    })).filter(f => f.p.length);
    // 등심선: 마칭 스퀘어 조각 → 이어 붙이기 → 조각 가운데가 타일 안인 것만
    const lines = {}, lbl = [];
    const P = (r, c) => [laN - r * dla, g.lo0 + c * dlo];
    const keep = (s) => { const la = (s[0][0] + s[1][0]) / 2, lo = (s[0][1] + s[1][1]) / 2; return la >= t.s && la < t.n && lo >= t.w && lo < t.e; };
    for (let L = 10; L <= Math.min(100, maxD); L += 10) {
      const lv = L + 0.013, segs = [];
      for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
        const v = [V[r * C + c], V[r * C + c + 1], V[(r + 1) * C + c + 1], V[(r + 1) * C + c]], cn = [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c]], pts = [];
        for (let e = 0; e < 4; e++) { const a = v[e], b = v[(e + 1) % 4]; if ((a - lv) * (b - lv) < 0) { const k = (lv - a) / (b - a), p = cn[e], q = cn[(e + 1) % 4]; pts.push(P(p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k)); } }
        if (pts.length === 2) { if (keep(pts)) segs.push(pts); } else if (pts.length === 4) [[pts[0], pts[1]], [pts[2], pts[3]]].forEach(s => { if (keep(s)) segs.push(s); });
      }
      if (!segs.length) continue;
      const ln = joinSegs(segs).map(l => thin(l, 1.5e-5)).filter(l => l.length >= 2);
      lines[L] = ln;
      if (L === 30 || L === 40 || L === 60) { let n = 0; ln.forEach(l => l.forEach((p, i) => { if (i % 8 === 4 && n < 40) { lbl.push([p[0], p[1], L]); n++; } })); }
    }
    out = { ok: true, x, y, tile: t, src: d.src, srcShort: d.srcShort, res: d.res, fills, lines, lbl };
  }
  try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String(180 * 86400)]]); } catch (_) {}
  return out;
}
function joinSegs(segs) {
  const K = (p) => p[0].toFixed(8) + ',' + p[1].toFixed(8), ends = new Map(), used = new Uint8Array(segs.length), lines = [];
  segs.forEach((s, i) => [0, 1].forEach(e => { const k = K(s[e]); (ends.get(k) || ends.set(k, []).get(k)).push([i, e]); }));
  const nextFrom = (pt) => { const l = ends.get(K(pt)) || []; for (const [i, e] of l) if (!used[i]) { used[i] = 1; return segs[i][1 - e]; } return null; };
  segs.forEach((s, i) => { if (used[i]) return; used[i] = 1; const line = [s[0], s[1]];
    for (let p = nextFrom(line[line.length - 1]); p; p = nextFrom(line[line.length - 1])) line.push(p);
    for (let p = nextFrom(line[0]); p; p = nextFrom(line[0])) line.unshift(p);
    lines.push(line); });
  return lines;
}

