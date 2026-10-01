// [ADD] Copernicus Marine 실측 파일(NetCDF4 = HDF5) 읽기 도우미. h5wasm(웹어셈블리 HDF5)을 써요.
// 파일 하나(하루치 또는 한 달치)를 받아서 시각별 수온·파고·주기·바람·조위로 간추립니다.
let _h5 = null;
async function h5() {
  if (!_h5) _h5 = import('h5wasm/node').then(async m => { const mod = m.default && m.default.File ? m.default : m; const r = await mod.ready; return { File: mod.File, FS: r.FS }; });
  return _h5;
}

const T1950 = Date.UTC(1950, 0, 1);
const GOOD_QC = new Set([0, 1, 2]); // 0 검사 안 함, 1 좋음, 2 아마 좋음

// 변수 하나에서 [시각 수 × 깊이 수] 값 중 쓸 열(깊이) 하나 고르기: 값이 충분한 열 중 가장 얕은 곳
function pickColumn(file, name, nt, depthOf) {
  let ds; try { ds = file.get(name); } catch (_) { return null; }
  if (!ds || !ds.shape) return null;
  const v = ds.value, nd = ds.shape.length > 1 ? ds.shape[1] : 1;
  let q = null; try { const qd = file.get(name + '_QC'); q = qd && qd.value; } catch (_) {}
  const ok = (i) => { const x = v[i]; return Number.isFinite(x) && Math.abs(x) < 1e30 && (!q || GOOD_QC.has(q[i])); };
  const cols = [];
  for (let j = 0; j < nd; j++) { let n = 0; for (let i = 0; i < nt; i++) if (ok(i * nd + j)) n++; if (n) cols.push({ j, n, dep: depthOf(j) }); }
  if (!cols.length) return null;
  const maxN = Math.max(...cols.map(c => c.n));
  const good = cols.filter(c => c.n >= maxN * 0.3).sort((a, b) => Math.abs(a.dep) - Math.abs(b.dep));
  const j = good[0].j;
  return (i) => ok(i * nd + j) ? v[i * nd + j] : null;
}

// 반환: [{ t(UTC ms), wt, wv, per, ws, wd, sl }]
async function parseNc(buf) {
  const { File, FS } = await h5();
  // h5wasm(node)은 실제 디스크를 쓰는데 Vercel에서는 /tmp만 쓸 수 있어요
  const path = require('os').tmpdir() + '/cm_' + Math.random().toString(36).slice(2) + '.nc';
  FS.writeFile(path, new Uint8Array(buf));
  let f;
  try {
    f = new File(path, 'r');
    const time = f.get('TIME').value;
    const nt = time.length;
    let tq = null; try { tq = f.get('TIME_QC').value; } catch (_) {}
    let deph = null, dShape = null;
    try { const d = f.get('DEPH'); deph = d.value; dShape = d.shape; } catch (_) {}
    const depthOf = (j) => {
      if (!deph) return 0;
      if (dShape.length < 2) return Number.isFinite(deph[j]) && Math.abs(deph[j]) < 1e30 ? deph[j] : 0;
      const nd = dShape[1]; for (let i = 0; i < nt; i++) { const x = deph[i * nd + j]; if (Number.isFinite(x) && Math.abs(x) < 1e30) return x; }
      return 0;
    };
    const col = (names) => { for (const n of names) { const c = pickColumn(f, n, nt, depthOf); if (c) return c; } return null; };
    const wt = col(['TEMP']), wv = col(['VHM0', 'VAVH', 'VH110', 'VHZA']), per = col(['VTPK', 'VTM02', 'VTZA']);
    const ws = col(['WSPD']), wd = col(['WDIR']), sl = col(['SLEV']);
    const rows = [];
    for (let i = 0; i < nt; i++) {
      if (tq && !GOOD_QC.has(tq[i])) continue;
      const t = Math.round(T1950 + time[i] * 86400e3);
      if (!Number.isFinite(t)) continue;
      const r = { t };
      const put = (k, fn, digits) => { if (!fn) return; const x = fn(i); if (x != null) r[k] = +x.toFixed(digits); };
      put('wt', wt, 2); put('wv', wv, 2); put('per', per, 1); put('ws', ws, 1); put('wd', wd, 0); put('sl', sl, 3);
      if (Object.keys(r).length > 1) rows.push(r);
    }
    rows.sort((a, b) => a.t - b.t);
    return rows;
  } finally {
    try { f && f.close(); } catch (_) {}
    try { FS.unlink(path); } catch (_) {}
  }
}

module.exports = { parseNc };
