// [ADD] 연안 수심 정밀화 모듈 (방안 1 + 방안 2 + 방안 3)
//  - 방안 1: EMODnet 2024 WCS (Float32 GeoTIFF) + NOAA NCEI DEM Mosaic ~30m 고해상도 exportImage (Float32 GeoTIFF)
//  - 방안 2: AWS Terrarium 30m 육지 DEM 경사각 + OSM 해안 지형 태그(cliff/bare_rock vs beach/sand/shoal/mud)로
//            해안 조각별 직벽(steepness=1) ↔ 완만(steepness=0) 자동 판별 및 연안 0~180m / 거친 자료 보간
//  - 방안 3: Allen Coral Atlas(5m 리프 지형 WFS) 기반 열대·아열대 얕은 수심(0~15m) 및 리프 외곽 드롭오프 보완
const zlib = require('zlib');

const cl = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

// ── 순수 Node.js PNG 디코더 (8-bit Gray/GA/RGB/RGBA, 비인터레이스) ──
function parsePng(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let o = 8, w = 0, h = 0, bit = 0, ct = 0;
  const idat = [];
  while (o + 12 <= buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); bit = buf[o + 16]; ct = buf[o + 17]; }
    else if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0;
  if (!bpp || bit !== 8 || !w || !h) throw new Error(`unsupported png ct=${ct} bit=${bit}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp, out = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s0 = y * (stride + 1) + 1, d0 = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[s0 + x];
      const a = x >= bpp ? out[d0 + x - bpp] : 0;
      const b = y > 0 ? out[d0 - stride + x] : 0;
      const c = (x >= bpp && y > 0) ? out[d0 - stride + x - bpp] : 0;
      out[d0 + x] = (v + (f === 1 ? a : f === 2 ? b : f === 3 ? ((a + b) >> 1) : f === 4 ? paeth(a, b, c) : 0)) & 255;
    }
  }
  return { w, h, bpp, data: out };
}

// ── 순수 Node.js Float32 GeoTIFF 디코더 (BE/LE, tiled/stripped, uncompressed/deflate) ──
function parseTiffF32(buf) {
  if (!buf || buf.length < 16) throw new Error('not tiff');
  const be = buf[0] === 0x4d && buf[1] === 0x4d;
  if (!be && !(buf[0] === 0x49 && buf[1] === 0x49)) throw new Error('bad tiff magic');
  const u16 = (o) => be ? buf.readUInt16BE(o) : buf.readUInt16LE(o);
  const u32 = (o) => be ? buf.readUInt32BE(o) : buf.readUInt32LE(o);
  const ifd = u32(4), n = u16(ifd), tags = {};
  const readArr = (tp, cnt, valOff) => {
    const sz = tp === 3 ? 2 : tp === 4 ? 4 : 1;
    const off = cnt * sz <= 4 ? valOff : u32(valOff);
    const arr = [];
    for (let i = 0; i < cnt; i++) arr.push(tp === 3 ? u16(off + i * 2) : tp === 4 ? u32(off + i * 4) : buf[off + i]);
    return arr;
  };
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12, id = u16(o), tp = u16(o + 2), cnt = u32(o + 4);
    tags[id] = readArr(tp, cnt, o + 8);
  }
  const w = tags[256] && tags[256][0], h = tags[257] && tags[257][0];
  const comp = (tags[259] && tags[259][0]) || 1;
  const bps = (tags[258] && tags[258][0]) || 32;
  if (!w || !h || bps !== 32) throw new Error(`unsupported tiff w=${w} h=${h} bps=${bps}`);
  const out = new Float32Array(w * h);
  const decodeBuf = (off, len) => {
    const sub = buf.subarray(off, off + len);
    if (comp === 1) return sub;
    if (comp === 8 || comp === 32946) return zlib.inflateSync(sub);
    throw new Error('tiff comp ' + comp);
  };
  if (tags[322] && tags[324]) {
    const tw = tags[322][0], th = tags[323][0], offs = tags[324], bcs = tags[325], txN = Math.ceil(w / tw);
    for (let ti = 0; ti < offs.length; ti++) {
      const tb = decodeBuf(offs[ti], bcs[ti]);
      const tx = (ti % txN) * tw, ty = Math.floor(ti / txN) * th;
      for (let r = 0; r < th && ty + r < h; r++) for (let c = 0; c < tw && tx + c < w; c++) {
        const bo = (r * tw + c) * 4;
        out[(ty + r) * w + (tx + c)] = be ? tb.readFloatBE(bo) : tb.readFloatLE(bo);
      }
    }
  } else if (tags[273]) {
    const rps = (tags[278] && tags[278][0]) || h, offs = tags[273], bcs = tags[279];
    for (let si = 0; si < offs.length; si++) {
      const sb = decodeBuf(offs[si], bcs[si]), y0 = si * rps;
      for (let r = 0; r < rps && y0 + r < h; r++) for (let c = 0; c < w; c++) {
        const bo = (r * w + c) * 4;
        out[(y0 + r) * w + c] = be ? sb.readFloatBE(bo) : sb.readFloatLE(bo);
      }
    }
  } else throw new Error('tiff no data');
  return { w, h, data: out };
}

function tiffToGrid(tiff, b, isNoData) {
  const rows = tiff.h, cols = tiff.w;
  const dla = (b.n - b.s) / rows, dlo = (b.e - b.w) / cols;
  const z = new Array(rows * cols).fill(null);
  let sea = 0;
  for (let r = 0; r < rows; r++) {
    const dstR = rows - 1 - r; // TIFF 위쪽=북 → grid 아래쪽=남
    for (let c = 0; c < cols; c++) {
      const v = tiff.data[r * cols + c];
      if (!Number.isFinite(v) || Math.abs(v) > 12000 || (isNoData && isNoData(v))) continue;
      const rv = Math.round(v * 10) / 10;
      z[dstR * cols + c] = rv;
      if (rv < 0) sea++;
    }
  }
  if (sea < 4) return null;
  return { la0: b.s + dla * 0.5, lo0: b.w + dlo * 0.5, dla, dlo, rows, cols, z };
}

// ── 방안 1A: EMODnet 2024 WCS (Float32 GeoTIFF, 유럽 + 카리브해 ~115m) ──
async function fromEmodnetWcs(b, getBuf) {
  const f = (v) => v.toFixed(5);
  const step = 1 / 960; // 1/16 arc-min ≈ 0.0010417° (~115m)
  const url = `https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=1.0.0&request=GetCoverage&coverage=emodnet:mean&bbox=${f(b.w)},${f(b.s)},${f(b.e)},${f(b.n)}&crs=EPSG:4326&format=GeoTIFF&resx=${step.toFixed(7)}&resy=${step.toFixed(7)}`;
  const buf = await getBuf(url, {}, 16000);
  if (!buf || buf.length < 64 || (buf[0] !== 0x4d && buf[0] !== 0x49)) return null;
  const tiff = parseTiffF32(buf);
  const grid = tiffToGrid(tiff, b, (v) => v === 0 || v <= -9999);
  if (!grid) return null;
  return { src: 'emodnet', res: 115, grid };
}

// ── 방안 1B: NOAA NCEI DEM Mosaic 고해상도(~30m, 단 1회 Float32 GeoTIFF exportImage) ──
async function fromNoaaHiRes(b, getText, getBuf) {
  // 1) 9점 해상도 프로브: 실제 고해상도(<=100m, CUDEM/LiDAR/멀티빔)가 있는 구역만 사용
  const probe = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    probe.push([b.w + (b.e - b.w) * (0.2 + j * 0.3), b.s + (b.n - b.s) * (0.2 + i * 0.3)]);
  }
  const body = new URLSearchParams({
    f: 'json', geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true',
    geometry: JSON.stringify({ points: probe, spatialReference: { wkid: 4326 } })
  });
  const pj = JSON.parse(await getText('https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/getSamples', { method: 'POST', body }, 12000));
  const sam = (pj.samples || []).filter(s => Number.isFinite(+s.resolution) && +s.resolution > 0);
  if (sam.length < 5) return { coarse: true };
  // 중간값 기준 해상도(일부 육지 구석이 거칠어도 연안 해양이 정밀하면 통과)
  const ress = sam.map(s => +s.resolution * 111320).sort((a, z) => a - z);
  const resM = ress[Math.floor(ress.length / 2)];
  if (!(resM <= 100)) return { coarse: true };

  // 2) 목표 ~30m 간격(최대 160×160)으로 Float32 GeoTIFF 1회 다운로드
  const latMid = (b.s + b.n) / 2;
  const widthM = (b.e - b.w) * 111320 * Math.cos(latMid * Math.PI / 180);
  const heightM = (b.n - b.s) * 111320;
  const targetM = Math.max(25, Math.min(40, resM * 1.5));
  const cols = Math.max(64, Math.min(160, Math.round(widthM / targetM)));
  const rows = Math.max(64, Math.min(160, Math.round(heightM / targetM)));
  const f = (v) => v.toFixed(6);
  const url = `https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/exportImage?bbox=${f(b.w)},${f(b.s)},${f(b.e)},${f(b.n)}&bboxSR=4326&imageSR=4326&size=${cols},${rows}&format=tiff&pixelType=F32&noData=-99999&f=image`;
  const buf = await getBuf(url, {}, 18000);
  if (!buf || buf.length < 64 || (buf[0] !== 0x4d && buf[0] !== 0x49)) return null;
  const tiff = parseTiffF32(buf);
  const grid = tiffToGrid(tiff, b, (v) => v <= -90000);
  if (!grid) return null;
  return { src: 'noaa', res: Math.max(3, Math.round(Math.max(resM, targetM))), hiRes: true, grid };
}

// ── 격자 쌍선형 업샘플링 (150m/450m 격자를 ~35m 작업 격자로 세분화 → 연안 직벽·5m 리프 표현 가능) ──
function upsampleGrid(g, targetM = 35, maxDim = 180) {
  const latMid = g.la0 + (g.rows - 1) * g.dla / 2;
  const cellM = Math.max(g.dla * 111320, g.dlo * 111320 * Math.cos(latMid * Math.PI / 180));
  if (!(cellM > targetM * 1.35) || g.rows < 2 || g.cols < 2) return g;
  const factor = Math.min(
    Math.ceil(cellM / targetM),
    Math.max(1, Math.floor((maxDim - 1) / Math.max(g.rows - 1, g.cols - 1)))
  );
  if (factor <= 1) return g;
  const R = (g.rows - 1) * factor + 1, C = (g.cols - 1) * factor + 1;
  const z = new Array(R * C);
  for (let r = 0; r < R; r++) {
    const fi = r / factor, i = Math.min(g.rows - 2, Math.floor(fi)), a = fi - i;
    for (let c = 0; c < C; c++) {
      const fj = c / factor, j = Math.min(g.cols - 2, Math.floor(fj)), b = fj - j;
      const q0 = g.z[i * g.cols + j], q1 = g.z[i * g.cols + j + 1], q2 = g.z[(i + 1) * g.cols + j], q3 = g.z[(i + 1) * g.cols + j + 1];
      if (q0 != null && q1 != null && q2 != null && q3 != null) {
        z[r * C + c] = q0 * (1 - a) * (1 - b) + q1 * (1 - a) * b + q2 * a * (1 - b) + q3 * a * b;
      } else {
        const w = [(1 - a) * (1 - b), (1 - a) * b, a * (1 - b), a * b], q = [q0, q1, q2, q3];
        let s = 0, sw = 0;
        for (let k = 0; k < 4; k++) if (q[k] != null) { s += q[k] * w[k]; sw += w[k]; }
        z[r * C + c] = sw > 0.35 ? s / sw : null;
      }
    }
  }
  return { la0: g.la0, lo0: g.lo0, dla: g.dla / factor, dlo: g.dlo / factor, rows: R, cols: C, z };
}

// ── 방안 2A: AWS Terrarium 30m 육지 DEM (Z=13 PNG, 256×256) ──
async function fetchTerrariumDem(x, y, tileBox, getBuf) {
  try {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/${x}/${y}.png`;
    const buf = await getBuf(url, {}, 10000);
    const png = parsePng(buf);
    if (png.bpp < 3) return null;
    const elev = new Float32Array(png.w * png.h);
    for (let i = 0; i < png.w * png.h; i++) {
      const o = i * png.bpp;
      elev[i] = png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768;
    }
    return { w: png.w, h: png.h, box: tileBox(x, y), elev };
  } catch (_) { return null; }
}

function demAt(dem, lat, lon) {
  if (!dem) return null;
  const b = dem.box;
  if (lat < b.s || lat > b.n || lon < b.w || lon > b.e) return null;
  const fx = (lon - b.w) / (b.e - b.w) * (dem.w - 1);
  const fy = (b.n - lat) / (b.n - b.s) * (dem.h - 1);
  const c = Math.max(0, Math.min(dem.w - 2, Math.floor(fx)));
  const r = Math.max(0, Math.min(dem.h - 2, Math.floor(fy)));
  const a = fx - c, d = fy - r, e = dem.elev, W = dem.w;
  return e[r * W + c] * (1 - a) * (1 - d) + e[r * W + c + 1] * a * (1 - d) + e[(r + 1) * W + c] * (1 - a) * d + e[(r + 1) * W + c + 1] * a * d;
}

// ── 방안 2B: OSM 해안 지형 태그 (절벽/바위 vs 해변/모래/갯벌) ──
async function fetchCoastTags(x, y, tileBox, redisPipeline, overpass) {
  const ck = `ctag:v1:${x}_${y}`;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {}
  const t = tileBox(x, y), P = 0.008, b = { s: t.s - P, n: t.n + P, w: t.w - P, e: t.e + P };
  const bb = `${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)}`;
  const q = `[out:json][timeout:15];(way["natural"~"^(cliff|bare_rock|beach|sand|shoal|mud)$"](${bb});rel["natural"~"^(beach|sand|shoal|mud)$"](${bb}););out geom qt 250;`;
  const steep = [], gentle = [];
  const q4 = (v) => Math.round(v * 1e4) / 1e4;
  try {
    const j = await overpass(q, 14000);
    const pushGeom = (geom, arr) => {
      if (!geom || !geom.length) return;
      const step = Math.max(1, Math.floor(geom.length / 20));
      for (let i = 0; i < geom.length; i += step) if (geom[i]) arr.push(q4(geom[i].lat), q4(geom[i].lon));
    };
    (j.elements || []).forEach(el => {
      const nat = el.tags && el.tags.natural;
      const dst = (nat === 'cliff' || nat === 'bare_rock') ? steep : gentle;
      if (el.geometry) pushGeom(el.geometry, dst);
      else if (el.members) el.members.forEach(m => m.geometry && pushGeom(m.geometry, dst));
    });
    const out = { s: steep.slice(0, 600), g: gentle.slice(0, 600) };
    try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String(180 * 86400)]]); } catch (_) {}
    return out;
  } catch (_) {
    return { s: [], g: [] }; // Overpass 실패 시에도 DEM 경사만으로 정상 동작
  }
}

// 각 해안선 조각별 직벽도 steepness ∈ [0, 1] 계산 (0 = 완만한 백사장, 1 = 수직 절벽)
function computeSegmentSteepness(segs, dem, tags, lat0) {
  const out = new Float32Array(segs.length).fill(0.45);
  if (!segs.length) return out;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  const stPts = (tags && tags.s) || [], gnPts = (tags && tags.g) || [];
  const nearTag = (arr, la, lo, maxM) => {
    for (let i = 0; i + 1 < arr.length; i += 2) {
      if (Math.hypot((arr[i + 1] - lo) * kx, (arr[i] - la) * ky) <= maxM) return true;
    }
    return false;
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const mla = (s[0] + s[2]) * 0.5, mlo = (s[1] + s[3]) * 0.5;
    const dx = (s[3] - s[1]) * kx, dy = (s[2] - s[0]) * ky, L = Math.hypot(dx, dy);
    let st = 0.45;
    if (dem && L > 0.5) {
      // OSM 해안선: 진행 방향 왼쪽(-dy, +dx)이 육지, 오른쪽(+dy, -dx)이 바다
      const nx = -dy / L, ny = dx / L;
      const e0 = demAt(dem, mla, mlo);
      if (e0 != null) {
        const eSea = demAt(dem, mla - (ny * 35) / ky, mlo - (nx * 35) / kx);
        const seaRef = eSea != null ? Math.max(0, Math.min(3, eSea)) : 0;
        let maxDeg = 0;
        // 30m DEM에서 직벽(문섬·섶섬·울릉도 등)은 해안선 픽셀 자체(dist=0)가 이미 수십 m로 솟아 있음 → dist+35m 기준 해수면 경사 계산
        for (const dist of [0, 35, 75, 130]) {
          const ed = dist === 0 ? e0 : demAt(dem, mla + (ny * dist) / ky, mlo + (nx * dist) / kx);
          if (ed != null && ed > seaRef) {
            const deg = Math.atan2(ed - seaRef, dist + 35) * 180 / Math.PI;
            if (deg > maxDeg) maxDeg = deg;
          }
        }
        // 4° 이하(완만한 백사장·평지) → 0.0 / 24° 이상(직벽·화산섬 급경사) → 1.0
        st = cl((maxDeg - 4) / 20);
      }
    }
    if (stPts.length && nearTag(stPts, mla, mlo, 130)) st = Math.max(st, 0.85);
    if (gnPts.length && nearTag(gnPts, mla, mlo, 150)) st = Math.min(st, 0.15);
    out[i] = st;
  }
  return out;
}

// 거리 변환(Chamfer)
function chamfer(D, R, C, ax, ay, V) {
  const ad = Math.hypot(ax, ay);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const i = r * C + c; let v = D[i];
    const tk = (j, w) => { if (D[j] + w < v) { v = D[j] + w; if (V) V[i] = V[j]; } };
    if (c > 0) tk(i - 1, ax);
    if (r > 0) { tk(i - C, ay); if (c > 0) tk(i - C - 1, ad); if (c < C - 1) tk(i - C + 1, ad); }
    D[i] = v;
  }
  for (let r = R - 1; r >= 0; r--) for (let c = C - 1; c >= 0; c--) {
    const i = r * C + c; let v = D[i];
    const tk = (j, w) => { if (D[j] + w < v) { v = D[j] + w; if (V) V[i] = V[j]; } };
    if (c < C - 1) tk(i + 1, ax);
    if (r < R - 1) { tk(i + C, ay); if (c < C - 1) tk(i + C + 1, ad); if (c > 0) tk(i + C - 1, ad); }
    D[i] = v;
  }
  return D;
}

// ── 방안 2C: 동적 연안 경사 보정 (거친 GMRT + 중해상도 KHOA 150m / EMODnet 115m 연안 0~180m) ──
function applyCoastalSlope(g, segs, steepArr, opts = {}) {
  if (!segs || !segs.length) return 0;
  const coarse = !!opts.coarse;
  const refineZone = opts.refineZone || 180; // KHOA/EMODnet 연안 보간 폭(m)
  const searchMax = coarse ? 1500 : (refineZone + 120);
  const lat0 = g.la0 + (g.rows - 1) * g.dla / 2;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  const S = segs.map(s => [(s[1] - g.lo0) * kx, (s[0] - g.la0) * ky, (s[3] - g.lo0) * kx, (s[2] - g.la0) * ky]);
  const B = coarse ? 250 : 120, NB = Math.ceil(searchMax / B);
  const bins = new Map(), key = (a, b) => a * 65536 + b;
  S.forEach((s, i) => {
    const n = Math.max(1, Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / (B / 2)));
    for (let k = 0; k <= n; k++) {
      const kk = key(Math.floor((s[0] + (s[2] - s[0]) * k / n) / B), Math.floor((s[1] + (s[3] - s[1]) * k / n) / B));
      const L = bins.get(kk) || bins.set(kk, []).get(kk);
      if (L[L.length - 1] !== i) L.push(i);
    }
  });

  const R = g.rows, C = g.cols, N = R * C, ax = g.dlo * kx, ay = g.dla * ky;
  const D = new Float32Array(N).fill(Infinity);
  const SD = new Int8Array(N);
  const ST = new Float32Array(N).fill(0.45);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const px = c * ax, py = r * ay, bx = Math.floor(px / B), by = Math.floor(py / B);
    let best = Infinity, side = 0, bestIdx = -1;
    for (let ix = bx - NB; ix <= bx + NB; ix++) for (let iy = by - NB; iy <= by + NB; iy++) {
      const L = bins.get(key(ix, iy)); if (!L) continue;
      for (const i of L) {
        const s = S[i], dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1;
        const tt = Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / L2));
        const d = Math.hypot(px - s[0] - dx * tt, py - s[1] - dy * tt);
        if (d < best) { best = d; side = dx * (py - s[1]) - dy * (px - s[0]); bestIdx = i; }
      }
    }
    const idx = r * C + c;
    D[idx] = best; SD[idx] = side > 0 ? 1 : 0;
    if (bestIdx >= 0 && steepArr) ST[idx] = steepArr[bestIdx];
  }

  let changed = 0;
  if (!coarse) {
    // ── 중해상도(KHOA 150m / EMODnet 115m): 연안 0~refineZone(m)만 육지 경사·OSM 태그로 정밀 보간, 바깥은 실측 100% 유지 ──
    const band = Math.max(ax, ay) * 1.4;
    const ZREF = new Float32Array(N).fill(NaN), DREF = new Float32Array(N).fill(Infinity);
    for (let i = 0; i < N; i++) {
      const v = g.z[i];
      if (!SD[i] && v != null && v < 0 && D[i] >= refineZone && D[i] <= refineZone + band) {
        DREF[i] = 0; ZREF[i] = -v;
      }
    }
    chamfer(DREF, R, C, ax, ay, ZREF);
    for (let i = 0; i < N; i++) {
      const d = D[i]; if (!(d < refineZone)) continue;
      const v = g.z[i];
      if (SD[i]) continue; // 육지 쪽은 기존 값 유지
      const zRef = ZREF[i];
      if (!Number.isFinite(zRef) || !(zRef > 0.5)) continue;
      if (v == null || v >= 0) {
        // 해안선 바깥(바다)인데 격자 간격 때문에 육지로 뭉개진 좁은 띠도 부드럽게 물로 연결
        const t = cl(d / refineZone), s = ST[i];
        const curve = s >= 0.5 ? 1 - Math.pow(1 - t, 1 + (s - 0.5) * 3.6) : Math.pow(t, 1 + (0.5 - s) * 0.9);
        g.z[i] = -Math.max(0.5, zRef * curve); changed++; continue;
      }
      const orig = -v, t = cl(d / refineZone), s = ST[i];
      // 직벽(s=1): 1-(1-t)^2.8 (절벽 앞에서 급락) / 완만(s=0): t^1.45 (얕은 비치) / 중간(s=0.5): 선형
      const curve = s >= 0.5 ? 1 - Math.pow(1 - t, 1 + (s - 0.5) * 3.6) : Math.pow(t, 1 + (0.5 - s) * 0.9);
      const shaped = Math.max(0.5, zRef * curve);
      // 바깥쪽 30% 구간은 실측값과 매끄럽게 블렌딩 (경계 단차 0)
      const blend = cl((1 - t) / 0.35);
      const nv = -(orig + (shaped - orig) * blend);
      if (Math.abs(nv - v) > 0.05) { g.z[i] = nv; changed++; }
    }
    return changed;
  }

  // ── 거친 자료(GMRT ~450m): 육지 경사 + OSM cliff/beach 태그 + 1km 내 깊은 바다 유무로 직벽/완만 동적 결정 ──
  chamfer(D, R, C, ax, ay, ST);
  const SHORE_W = 500, SHORE_W2 = 1400, NEAR_D = 10, WALL_D = 50, DEEP_D = 100, FAR0 = 1800, FAR1 = 2800;
  const taperW = (o) => SHORE_W + (SHORE_W2 - SHORE_W) * cl((o - 30) / 30);

  // 주변 1km 안 최대 수심 (깊은 바다가 있어야 직벽 형성 가능)
  const rc = Math.max(1, Math.round(1000 / ax)), rr = Math.max(1, Math.round(1000 / ay));
  const M0 = new Float32Array(N), M1 = new Float32Array(N), M = new Float32Array(N);
  for (let i = 0; i < N; i++) { const v = g.z[i]; M0[i] = v != null && v < 0 ? -v : 0; }
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { let m = 0; for (let k = Math.max(0, c - rc); k <= Math.min(C - 1, c + rc); k++) m = Math.max(m, M0[r * C + k]); M1[r * C + c] = m; }
  for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) { let m = 0; for (let k = Math.max(0, r - rr); k <= Math.min(R - 1, r + rr); k++) m = Math.max(m, M1[k * C + c]); M[r * C + c] = m; }

  const OF = new Float32Array(N).fill(NaN), DF = new Float32Array(N).fill(Infinity), band = Math.max(ax, ay) * 1.3;
  for (let i = 0; i < N; i++) {
    const v = g.z[i]; if (SD[i] || v == null || v >= 0) continue;
    const o = -v, s = ST[i];
    const d10 = 25 + (1 - s) * 135; // 직벽 25m ~ 완만 160m
    const run = 40 + (1 - s) * 140; // 벽 경사 폭: 직벽 40m ~ 완만 180m
    const dw = d10 + run;
    if (D[i] >= dw && D[i] <= dw + band) { DF[i] = 0; OF[i] = o; }
  }
  chamfer(DF, R, C, ax, ay, OF);

  for (let i = 0; i < N; i++) {
    const d = D[i]; if (!(d < FAR1)) continue;
    const v = g.z[i];
    if (SD[i] && d < SHORE_W2) { if (d < SHORE_W && (v == null || v < 0)) { g.z[i] = 2; changed++; } continue; }
    if (v == null || v >= 0) { if (d < SHORE_W) { g.z[i] = -Math.max(0.5, 10 * d / SHORE_W); changed++; } continue; }
    const o = -v, s = ST[i];
    // 완만(비치) 곡선: 모래 해변은 벽 없이 부드럽게 깊어짐
    const f0 = Math.min(1, d / taperW(o));
    const fBeach = Math.pow(f0, 1 + (1 - s) * 0.25);
    const zBeach = Math.max(0.5, o * (fBeach + (1 - fBeach) * cl((o - 70) / 50)));

    // 직벽/급경사 곡선: 육지 경사(s)가 클수록 해안선 바로 앞에서 10m → 50m로 급락
    const d10 = 25 + (1 - s) * 135;
    const run = 40 + (1 - s) * 140;
    const dw = d10 + run;
    let zWall;
    if (d <= d10) zWall = NEAR_D * Math.pow(d / d10, 0.85);
    else if (d <= dw) zWall = NEAR_D + (WALL_D - NEAR_D) * (d - d10) / run;
    else {
      const of = OF[i];
      zWall = o >= DEEP_D ? o : !(of < WALL_D) ? Math.max(WALL_D, o) : Math.max(WALL_D, WALL_D + (DEEP_D - WALL_D) * (o - of) / (DEEP_D - of));
      zWall = o + (zWall - o) * (1 - cl((d - FAR0) / (FAR1 - FAR0)));
    }
    // 실제 직벽 가중치 = (주변에 깊은 바다 존재) × (육지 경사·OSM 태그 직벽도)
    const deepW = cl((M[i] - 30) / 35);
    const wallW = deepW * cl((s - 0.22) / 0.58);
    const nv = -Math.max(0.5, zBeach + (zWall - zBeach) * wallW);
    if (Math.abs(nv - v) > 0.05) { g.z[i] = nv; changed++; }
  }
  return changed;
}

// ── 방안 3: Allen Coral Atlas 5m 리프 지형 WFS (열대·아열대 |lat|<=32°, 얕은 수심 0~15m + 드롭오프) ──
const ACA_CODE = {
  'Reef Crest': 1,
  'Inner Reef Flat': 2, 'Outer Reef Flat': 2, 'Terrestrial Reef Flat': 2,
  'Shallow Lagoon': 3,
  'Deep Lagoon': 4,
  'Back Reef Slope': 5,
  'Plateau': 6,
  'Sheltered Reef Slope': 7,
  'Reef Slope': 8
};

async function fetchAcaGeomorphic(x, y, tileBox, redisPipeline, getText) {
  const t = tileBox(x, y), latMid = (t.s + t.n) / 2;
  if (Math.abs(latMid) > 32) return []; // 산호초 위도대 밖은 생략
  const ck = `aca:v1:${x}_${y}`;
  try { const [{ result }] = await redisPipeline([['GET', ck]]); if (result) return JSON.parse(result); } catch (_) {}
  const P = 0.005, b = { s: t.s - P, n: t.n + P, w: t.w - P, e: t.e + P };
  const url = `https://allencoralatlas.org/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=coral-atlas:geomorphic_data_verbose&outputFormat=application/json&srsName=EPSG:4326&bbox=${b.w.toFixed(4)},${b.s.toFixed(4)},${b.e.toFixed(4)},${b.n.toFixed(4)},EPSG:4326&maxFeatures=250`;
  try {
    const txt = await getText(url, {}, 12000);
    const j = JSON.parse(txt);
    const q5 = (v) => Math.round(v * 1e5) / 1e5;
    const simp = (ring) => {
      const out = [];
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], la = q5(p[1]), lo = q5(p[0]);
        const prev = out.length >= 2 ? [out[out.length - 2], out[out.length - 1]] : null;
        if (!prev || Math.abs(prev[0] - la) > 6e-5 || Math.abs(prev[1] - lo) > 6e-5) out.push(la, lo);
      }
      return out.length >= 6 ? out : null;
    };
    const polys = [];
    (j.features || []).forEach(f => {
      const code = ACA_CODE[f.properties && f.properties.class_name];
      if (!code || !f.geometry) return;
      const g = f.geometry;
      const mp = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
      mp.forEach(poly => {
        if (!poly || !poly[0]) return;
        const outer = simp(poly[0]);
        if (outer) polys.push([code, outer]);
      });
    });
    const out = polys.slice(0, 320);
    try { await redisPipeline([['SET', ck, JSON.stringify(out), 'EX', String(180 * 86400)]]); } catch (_) {}
    return out;
  } catch (_) {
    return [];
  }
}

// ACA 5m 리프 지형 → 얕은 수심(0~15m) & 외곽 리프 드롭오프 보정
function applyAcaShallow(g, acaPolys) {
  if (!acaPolys || !acaPolys.length) return 0;
  const R = g.rows, C = g.cols, N = R * C;
  const lat0 = g.la0 + (R - 1) * g.dla / 2;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  const ax = g.dlo * kx, ay = g.dla * ky;

  // 각 격자 칸에 ACA 지형 코드 래스터화 (스캔라인)
  const cls = new Uint8Array(N);
  // 우선순위: 외곽 경사(7,8) < 플래토(6) < 백리프(5) < 라군(4,3) < 리프플랫(2) < 리프크레스트(1)
  const sorted = acaPolys.slice().sort((a, b) => b[0] - a[0]);
  for (let pi = 0; pi < sorted.length; pi++) {
    const [code, flat] = sorted[pi];
    const m = flat.length >> 1; if (m < 3) continue;
    let s0 = 90, n0 = -90;
    for (let k = 0; k < flat.length; k += 2) { if (flat[k] < s0) s0 = flat[k]; if (flat[k] > n0) n0 = flat[k]; }
    const r0 = Math.max(0, Math.floor((s0 - g.la0) / g.dla));
    const r1 = Math.min(R - 1, Math.ceil((n0 - g.la0) / g.dla));
    for (let r = r0; r <= r1; r++) {
      const la = g.la0 + r * g.dla, xs = [];
      for (let i = 0, j = m - 1; i < m; j = i++) {
        const y1 = flat[i * 2], x1 = flat[i * 2 + 1], y2 = flat[j * 2], x2 = flat[j * 2 + 1];
        if ((y1 > la) !== (y2 > la)) xs.push(x1 + (la - y1) / (y2 - y1) * (x2 - x1));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let xi = 0; xi + 1 < xs.length; xi += 2) {
        const c0 = Math.max(0, Math.ceil((xs[xi] - g.lo0) / g.dlo));
        const c1 = Math.min(C - 1, Math.floor((xs[xi + 1] - g.lo0) / g.dlo));
        for (let c = c0; c <= c1; c++) cls[r * C + c] = code;
      }
    }
  }

  // 리프 플랫/크레스트(1,2) 경계로부터의 거리(m) → 외곽 리프 슬로프(7,8) 드롭오프 깊이 계산용
  const DFlat = new Float32Array(N).fill(Infinity);
  let hasFlat = false;
  for (let i = 0; i < N; i++) { if (cls[i] === 1 || cls[i] === 2) { DFlat[i] = 0; hasFlat = true; } }
  if (hasFlat) chamfer(DFlat, R, C, ax, ay);

  let changed = 0;
  for (let i = 0; i < N; i++) {
    const code = cls[i]; if (!code) continue;
    const v = g.z[i]; if (v == null || v >= 0) continue; // 육지는 유지
    const cur = -v;
    let nv = cur;
    if (code === 1) nv = Math.min(cur, 1.0); // Reef Crest (~1m)
    else if (code === 2) nv = Math.min(cur, 1.8); // Reef Flat (~1.5~2m)
    else if (code === 3) nv = cur > 6 ? 4.0 : Math.min(cur, 4.5); // Shallow Lagoon (~3~5m)
    else if (code === 4) nv = cur > 16 ? 10.0 : cur; // Deep Lagoon (~8~12m)
    else if (code === 5) nv = cur > 15 ? 7.5 : cur; // Back Reef Slope (~5~12m)
    else if (code === 6) nv = cur > 22 ? 14.0 : cur; // Plateau (~10~18m)
    else if (code === 7) { // Sheltered Reef Slope: 완만한 리프 경사 (5m → 22m)
      const d = hasFlat && Number.isFinite(DFlat[i]) ? DFlat[i] : 60;
      const target = 4.5 + 17.5 * cl(d / 110);
      nv = Math.max(cur, target);
    } else if (code === 8) { // Reef Slope (Outer drop-off): 급경사 리프 월 (4m → 32m)
      const d = hasFlat && Number.isFinite(DFlat[i]) ? DFlat[i] : 50;
      const target = 4.0 + 28.0 * cl(d / 85);
      nv = Math.max(cur, target);
    }
    if (Math.abs(-nv - v) > 0.05) { g.z[i] = -nv; changed++; }
  }
  return changed;
}

module.exports = {
  parsePng, parseTiffF32, fromEmodnetWcs, fromNoaaHiRes,
  upsampleGrid, fetchTerrariumDem, demAt, fetchCoastTags,
  computeSegmentSteepness, applyCoastalSlope,
  fetchAcaGeomorphic, applyAcaShallow
};
