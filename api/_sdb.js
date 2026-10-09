// [ADD] 위성사진 수심(SDB) 시험판 - Sentinel-2 위성사진(10m)에서 얕은 바다(0~20m) 수심을 직접 계산해요.
//  근거: 맑은 물에서는 파란색(B02)과 초록색(B03)이 물속에서 약해지는 정도가 달라서, 깊을수록 둘의 비율이 규칙적으로 변해요(Stumpf 2003 로그 비율법).
//  순서: ① Copernicus Data Space(Sentinel Hub)에서 지난 N개월 위성사진을 "구름·거품·반사광을 빼고 픽셀마다 중앙값"으로 합친 한 장을 받음
//        ② 깊은 바다 값을 빼서 물 효과만 남기고 → 로그 비율 → ③ 같은 자리의 GMRT 수심(거친 자료)과 맞춰서 비율을 미터로 환산(몇 군데만 맞추면 전체가 따라옴)
//  환경변수: CDSE_CLIENT_ID, CDSE_CLIENT_SECRET (Vercel에만 있고 코드엔 없음). 모르는 키는 로그·응답에 안 찍어요.
const zlib = require('zlib');
const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
let tok = { v: '', exp: 0 };

async function token() {
  if (tok.v && Date.now() < tok.exp - 30e3) return tok.v;
  const id = process.env.CDSE_CLIENT_ID, sec = process.env.CDSE_CLIENT_SECRET;
  if (!id || !sec) throw new Error('no_cdse_keys');
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: sec }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('cdse_token_' + r.status + ' ' + String(j.error_description || j.error || '').slice(0, 120));
  tok = { v: j.access_token, exp: Date.now() + (+j.expires_in || 600) * 1000 };
  return tok.v;
}

// 픽셀마다: 구름(SCL 0·1·3·8·9·10·11)·거품/육지/반사광(근적외선 B08 > 0.05)인 날은 빼고, 남은 날들의 B02·B03·B04 중앙값 + 남은 날 수(개수)
const EVALSCRIPT = `//VERSION=3
function setup(){return{input:[{bands:["B02","B03","B04","B08","SCL","dataMask"]}],mosaicking:"ORBIT",output:{bands:4,sampleType:"UINT16"}}}
function med(a){a.sort(function(x,y){return x-y});var n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2}
function evaluatePixel(ss){var b=[],g=[],r=[];
 for(var i=0;i<ss.length;i++){var s=ss[i];if(!s.dataMask)continue;var c=s.SCL;
  if(c===0||c===1||c===3||c===8||c===9||c===10||c===11)continue;
  if(s.B08>0.05)continue;
  b.push(s.B02);g.push(s.B03);r.push(s.B04);}
 var n=b.length;if(n<1)return[0,0,0,0];
 return[Math.round(med(b)*10000),Math.round(med(g)*10000),Math.round(med(r)*10000),n]}`;

async function fetchComposite(box, w, h, months, cloud) {
  const to = new Date(), from = new Date(Date.now() - months * 30.4 * 86400e3);
  const body = { input: { bounds: { bbox: [box.w, box.s, box.e, box.n], properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { timeRange: { from: from.toISOString(), to: to.toISOString() }, maxCloudCoverage: cloud } }] },
    output: { width: w, height: h, responses: [{ identifier: 'default', format: { type: 'image/png' } }] }, evalscript: EVALSCRIPT };
  const t = await token();
  const r = await fetch(PROCESS_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', Accept: 'image/png' }, body: JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.ok) throw new Error('sentinelhub_' + r.status + ' ' + buf.toString('utf8').replace(/\s+/g, ' ').slice(0, 300));
  return buf;
}

// ── PNG 읽기(8·16비트, 회색/RGB/RGBA, 줄 섞기 없음) ──
function pngDecode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not_png');
  let p = 8, W = 0, H = 0, depth = 0, ct = 0, il = 0; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { W = d.readUInt32BE(0); H = d.readUInt32BE(4); depth = d[8]; ct = d[9]; il = d[12]; }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break; p += 12 + len; }
  if (il) throw new Error('png_interlaced'); if (depth !== 8 && depth !== 16) throw new Error('png_depth_' + depth);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]; if (!ch) throw new Error('png_ct_' + ct);
  const bpp = ch * depth / 8, stride = W * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(H * stride);
  for (let y = 0; y < H; y++) { const f = raw[y * (stride + 1)], s0 = y * (stride + 1) + 1, o0 = y * stride;
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? out[o0 + x - bpp] : 0, b = y ? out[o0 - stride + x] : 0, c = x >= bpp && y ? out[o0 - stride + x - bpp] : 0; let v = raw[s0 + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : pb <= pc ? b : c; }
      out[o0 + x] = v & 255; } }
  const chans = []; for (let k = 0; k < ch; k++) chans.push(new Float32Array(W * H));
  for (let i = 0; i < W * H; i++) for (let k = 0; k < ch; k++) chans[k][i] = depth === 16 ? out.readUInt16BE((i * ch + k) * 2) : out[i * ch + k];
  return { W, H, ch: chans };
}
// ── PNG 쓰기(RGB 8비트) ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngEncode(W, H, rgb) {
  const raw = Buffer.alloc(H * (W * 3 + 1)); for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'ascii'); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

const median = (a) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); const n = s.length; return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const pct = (a, p) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

// 위성 한 장(B,G,N) + 같은 격자의 거친 수심(ref, m, 양수=물, 없음=NaN) → 수심 격자(m, 없음=NaN) + 설명
//  minN: 이 픽셀에서 쓸 수 있는 날이 이보다 적으면 값 없음.  maxZ: 이보다 깊으면 "깊음"(= maxZ)으로.
function analyze(img, ref, opt) {
  opt = opt || {}; const minN = opt.minN || 3, maxZ = opt.maxZ || 22, NSC = 1000;
  const { W, H } = img, [Bc, Gc, , Nc] = img.ch, n = W * H;
  const ok = new Uint8Array(n); let nOk = 0; for (let i = 0; i < n; i++) if (Nc[i] >= minN && Gc[i] > 0 && Bc[i] > 0) { ok[i] = 1; nOk++; }
  if (nOk < 200) return { err: 'few_pixels', nOk };
  // 깊은 바다 기준값: 거친 수심이 30m보다 깊은 픽셀의 중앙값, 없으면 초록이 가장 어두운 4%
  let dB = [], dG = []; if (ref) for (let i = 0; i < n; i++) if (ok[i] && ref[i] > 30) { dB.push(Bc[i] / 1e4); dG.push(Gc[i] / 1e4); }
  let deepBy = 'ref>30m';
  if (dB.length < 60) { const gs = []; for (let i = 0; i < n; i++) if (ok[i]) gs.push(Gc[i]); const th = pct(gs, 0.04); dB = []; dG = []; for (let i = 0; i < n; i++) if (ok[i] && Gc[i] <= th) { dB.push(Bc[i] / 1e4); dG.push(Gc[i] / 1e4); } deepBy = 'darkest4%'; }
  const Bd = median(dB), Gd = median(dG);
  const X = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { if (!ok[i]) continue; const b = (Bc[i] / 1e4 - Bd) * NSC, g = (Gc[i] / 1e4 - Gd) * NSC; if (b > 1.05 && g > 1.05) X[i] = Math.log(b) / Math.log(g); }
  // 비율 → 미터: 거친 수심 1.5~18m인 픽셀을 비율 순서로 24칸 나눠 칸마다 중앙값을 잡고 직선(최소제곱)으로 맞춤
  const pairs = []; if (ref) for (let i = 0; i < n; i++) if (X[i] === X[i] && ref[i] >= 1.5 && ref[i] <= 18) pairs.push([X[i], ref[i]]);
  let m1 = NaN, m0 = NaN, r2 = NaN, rmse = NaN, fitN = pairs.length;
  if (pairs.length >= 200) {
    pairs.sort((a, b) => a[0] - b[0]); const K = 24, per = Math.floor(pairs.length / K), px = [], py = [];
    for (let k = 0; k < K; k++) { const seg = pairs.slice(k * per, k === K - 1 ? pairs.length : (k + 1) * per); px.push(median(seg.map(s => s[0]))); py.push(median(seg.map(s => s[1]))); }
    const mx = px.reduce((a, b) => a + b) / K, my = py.reduce((a, b) => a + b) / K; let sxy = 0, sxx = 0, syy = 0;
    for (let k = 0; k < K; k++) { sxy += (px[k] - mx) * (py[k] - my); sxx += (px[k] - mx) ** 2; syy += (py[k] - my) ** 2; }
    m1 = sxy / sxx; m0 = my - m1 * mx; r2 = sxy * sxy / (sxx * syy);
    let se = 0; for (const [x, y] of pairs) se += (m0 + m1 * x - y) ** 2; rmse = Math.sqrt(se / pairs.length);
  }
  if (!(m1 > 0)) return { err: 'no_calibration', nOk, fitN, deepBy, Bd, Gd };
  const Z = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (ok[i]) { const x = X[i]; Z[i] = x !== x ? maxZ : Math.max(0, Math.min(maxZ, m0 + m1 * x)); }
  // 잡음 줄이기: ① 반경 r 중앙값(점잡음·물결 반짝임 제거, 경계는 유지) ② 3×3 평균(부드럽게)
  const r = opt.smooth == null ? 2 : Math.max(0, Math.min(5, Math.round(opt.smooth)));
  let M = Z;
  if (r > 0) { M = new Float32Array(n).fill(NaN); const buf = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (Z[i] !== Z[i]) continue; buf.length = 0;
      for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const v = Z[yy * W + xx]; if (v === v) buf.push(v); } }
      buf.sort((p, q) => p - q); M[i] = buf[buf.length >> 1]; } }
  const S = new Float32Array(n).fill(NaN);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (M[i] !== M[i]) continue; let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue; const v = M[yy * W + xx]; if (v === v) { s += v; c++; } }
    S[i] = c ? s / c : M[i]; }
  const nm = []; for (let i = 0; i < n; i++) if (ok[i]) nm.push(Nc[i]);
  return { Z: S, info: { px: nOk, scenes_median: median(nm), scenes_max: Math.max(...nm), deepBy, deepBlue: +Bd.toFixed(4), deepGreen: +Gd.toFixed(4), fitPixels: fitN, depth_m_per_ratio: +m1.toFixed(2), offset_m: +m0.toFixed(2), r2: +r2.toFixed(3), rmse_vs_ref_m: +rmse.toFixed(2) } };
}

// ── 그림: 깊이 → 색(0m 연한 하늘색 → 30m 진한 남색), 5·10·20m 등심선, 가운데 포인트 십자 ──
const RAMP = [[0, [205, 242, 255]], [3, [150, 220, 245]], [6, [95, 185, 232]], [10, [55, 140, 210]], [15, [32, 100, 175]], [20, [20, 65, 135]], [30, [10, 35, 85]]];
function color(d) { if (d !== d) return null; for (let k = 1; k < RAMP.length; k++) if (d <= RAMP[k][0]) { const [d0, c0] = RAMP[k - 1], [d1, c1] = RAMP[k], f = (d - d0) / (d1 - d0); return [0, 1, 2].map(j => Math.round(c0[j] + (c1[j] - c0[j]) * f)); } return RAMP[RAMP.length - 1][1]; }
function panel(Zs, W, H, S, land, cross) { // Zs: 깊이(NaN=값 없음), land: 육지 표시할 칸
  const w = W * S, h = H * S, rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = Math.floor(y / S) * W + Math.floor(x / S), d = Zs[i]; let c = color(d);
    if (!c) c = land && land[i] ? [196, 176, 128] : [90, 90, 96];
    else { // 등심선: 오른쪽·아래 칸과 5m 구간이 다르면 선
      const xr = Math.floor(x / S) < W - 1 ? Zs[i + 1] : d, yd = Math.floor(y / S) < H - 1 ? Zs[i + W] : d; const lv = (v) => v === v ? (v >= 20 ? 3 : v >= 10 ? 2 : v >= 5 ? 1 : 0) : -1;
      if ((x % S === S - 1 && lv(xr) !== lv(d) && lv(xr) >= 0) || (y % S === S - 1 && lv(yd) !== lv(d) && lv(yd) >= 0)) c = [255, 255, 255]; }
    const o = (y * w + x) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; }
  if (cross) { const cx = Math.round(cross[0] * S), cy = Math.round(cross[1] * S); for (let k = -9; k <= 9; k++) for (const [x, y] of [[cx + k, cy], [cx, cy + k]]) if (x >= 0 && y >= 0 && x < w && y < h) { const o = (y * w + x) * 3; rgb[o] = 255; rgb[o + 1] = 40; rgb[o + 2] = 40; } }
  return { w, h, rgb };
}
function sideBySide(a, b) { const w = a.w + 8 + b.w, h = a.h, rgb = Buffer.alloc(w * h * 3, 30); for (let y = 0; y < h; y++) { a.rgb.copy(rgb, y * w * 3, y * a.w * 3, (y + 1) * a.w * 3); b.rgb.copy(rgb, (y * w + a.w + 8) * 3, y * b.w * 3, (y + 1) * b.w * 3); } return { w, h, rgb }; }

// 위성사진 실제 색(B04·B03·B02 반사율 → 밝기 늘리기). 값 없는 칸은 회색
function trueColor(img, S) {
  const { W, H } = img, [B, G, R, N] = img.ch, w = W * S, h = H * S, rgb = Buffer.alloc(w * h * 3), f = (v) => Math.max(0, Math.min(255, Math.round(255 * Math.pow(Math.max(v, 0) / 1e4 / 0.14, 0.55))));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = Math.floor(y / S) * W + Math.floor(x / S), o = (y * w + x) * 3; if (!(N[i] > 0)) { rgb[o] = rgb[o + 1] = rgb[o + 2] = 90; continue; } rgb[o] = f(R[i]); rgb[o + 1] = f(G[i]); rgb[o + 2] = f(B[i]); }
  return { w, h, rgb };
}
module.exports = { trueColor, fetchComposite, pngDecode, pngEncode, analyze, panel, sideBySide, token };
