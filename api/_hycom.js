// [ADD] 실제 수심별 수온(모델): 미국 해군 HYCOM 전지구 해양 모델(약 9km 격자)의 3차원 수온을 OPeNDAP로 받아 한 지점의 수심별 수온 + 수온약층 깊이를 계산해요.
//  /api/hycom?lat=33.2&lon=126.5  → { ok, src:'HYCOM', time, depths:[m], temps:[°C], grid:{lat,lon,km}, tc:{top,base,mid,grad,drop}|null }
//  - 키 필요 없음. 격자 좌표·시간 목록은 서버가 직접 읽어서 맞추므로(좌표 규칙을 가정하지 않음) 자료 구조가 조금 달라도 동작해요.
//  - 육지에 가까운 지점은 7×7칸 블록을 한 번에 받아 가장 가까운 바다 칸을 써요(연안은 모델이 거칠어서 실제 값과 다를 수 있어요).
//  - 같은 곳(0.1° 칸)은 6시간 저장. 서버(HYCOM)가 안 되면 ok:false → 앱은 표층 수온으로 만든 대략 추정 프로파일을 써요.
//  주소는 환경변수 HYCOM_BASE로 바꿀 수 있어요(기본: 최신 예측 자료).
const { redisPipeline } = require('./_redis');
const BASE = process.env.HYCOM_BASE || 'https://tds.hycom.org/thredds/dodsC/GLBy0.08/latest';
const VAR = process.env.HYCOM_VAR || 'water_temp';

async function getText(url, ms = 20000) {
  const c = new AbortController(), tm = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'otemp.app depth profile' } }); if (!r.ok) throw new Error('HYCOM HTTP ' + r.status); return await r.text(); }
  finally { clearTimeout(tm); }
}
// ascii 응답에서 "값 목록" 줄들만: 머리줄([...] 크기 표시) 다음의 숫자 줄
function numsAfterHeader(txt) {
  const out = []; txt.split('\n').forEach(l => { if (l.includes('[') || !/^[\s\d.eE+,\-]+$/.test(l)) return; l.split(',').forEach(x => { x = x.trim(); if (x) out.push(Number(x)); }); });
  return out;
}
function dims(dds) { // "Float32 water_temp[time = 12][depth = 40][lat = 4251][lon = 4500];"
  const m = new RegExp(VAR + '((?:\\[[^\\]]+\\])+)').exec(dds); if (!m) throw new Error('dds: ' + VAR + ' 없음');
  const o = {}; (m[1].match(/\[[^\]]+\]/g) || []).forEach(s => { const k = /\[\s*(\w+)\s*=\s*(\d+)/.exec(s); if (k) o[k[1]] = +k[2]; }); return o;
}
const memo = {};
async function axis(name, n) { // 좌표 목록(변하지 않으니 저장해 두고 재사용)
  const key = `hy:ax:${BASE}:${name}:${n}`; if (memo[key]) return memo[key];
  try { const [{ result }] = await redisPipeline([['GET', key]]); if (result) return (memo[key] = JSON.parse(result)); } catch (_) {}
  const arr = numsAfterHeader(await getText(`${BASE}.ascii?${name}[0:1:${n - 1}]`, 25000));
  if (arr.length !== n) throw new Error(`axis ${name}: ${arr.length}/${n}`);
  memo[key] = arr; if (name !== 'time') { try { await redisPipeline([['SET', key, JSON.stringify(arr), 'EX', String(30 * 86400)]]); } catch (_) {} }
  return arr;
}
const nearest = (a, v) => { let lo = 0, hi = a.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m; else hi = m; } return Math.abs(a[lo] - v) <= Math.abs(a[hi] - v) ? lo : hi; };

// 수온약층: 수심 구간별 기울기(°C/m) 중 가장 가파른 곳을 중심으로, 그 절반 이상으로 가파른 이어진 구간을 위·아래 경계로.
//  기울기 0.08°C/m 이상일 때만 "있음"(예: 10m에 0.8°C 이상 떨어짐) - 너무 약하면 null
function thermocline(depths, temps, minGrad = 0.08) {
  const g = []; for (let i = 0; i + 1 < depths.length; i++) if (depths[i] >= 5 && depths[i + 1] <= 300 && temps[i] != null && temps[i + 1] != null) g.push({ i, v: (temps[i] - temps[i + 1]) / (depths[i + 1] - depths[i]) });
  if (!g.length) return null; const mx = g.reduce((m, x) => x.v > m.v ? x : m, g[0]); if (!(mx.v >= minGrad)) return null;
  let a = mx.i, b = mx.i; while (g.some(x => x.i === a - 1 && x.v >= mx.v * 0.5)) a--; while (g.some(x => x.i === b + 1 && x.v >= mx.v * 0.5)) b++;
  return { top: depths[a], base: depths[b + 1], mid: Math.round((depths[mx.i] + depths[mx.i + 1]) / 2), grad: +mx.v.toFixed(2), drop: +(temps[a] - temps[b + 1]).toFixed(1) };
}

async function profile(lat, lon) {
  const dd = dims(await getText(BASE + '.dds')), nt = dd.time, nd = dd.depth, nla = dd.lat, nlo = dd.lon;
  if (!(nt && nd && nla && nlo)) throw new Error('dims ' + JSON.stringify(dd));
  const [la, lo, dep, tm] = await Promise.all([axis('lat', nla), axis('lon', nlo), axis('depth', nd), axis('time', nt)]);
  // 경도 규칙(0~360 또는 -180~180)에 맞추기
  const lon2 = lo[0] >= 0 && lo[lo.length - 1] > 180 ? ((lon % 360) + 360) % 360 : lon;
  const i0 = nearest(la, lat), j0 = nearest(lo, lon2);
  // 시간: 지금과 가장 가까운 시각(단위: 2000-01-01 00:00 UTC부터 시간 — HYCOM 표준. 다르면 마지막 시각을 씀)
  const nowH = (Date.now() - Date.UTC(2000, 0, 1)) / 3600e3; let ti = nt - 1;
  if (tm[0] > 100000 && tm[nt - 1] < 1e7) ti = nearest(tm, nowH);
  const R = 3, ia = Math.max(0, i0 - R), ib = Math.min(nla - 1, i0 + R), ja = Math.max(0, j0 - R), jb = Math.min(nlo - 1, j0 + R);
  const txt = await getText(`${BASE}.ascii?${VAR}[${ti}:1:${ti}][0:1:${nd - 1}][${ia}:1:${ib}][${ja}:1:${jb}]`, 25000);
  const W = jb - ja + 1, H = ib - ia + 1, cells = new Map(); // (행,열) → 수심별 값
  txt.split('\n').forEach(l => { const m = /^\[(\d+)\]\[(\d+)\]\[(\d+)\],\s*(.*)$/.exec(l); if (!m) return; const d = +m[2], r = +m[3];
    m[4].split(',').forEach((x, c) => { const k = r * W + c; let v = Number(x.trim()); (cells.get(k) || cells.set(k, new Array(nd).fill(null)).get(k))[d] = Number.isFinite(v) && v > -29000 ? v : null; }); });
  let best = null;
  cells.forEach((arr, k) => { const valid = arr.filter(v => v != null).length; if (valid < Math.min(8, nd)) return;
    const r = Math.floor(k / W), c = k % W, d2 = ((la[ia + r] - lat) * 111) ** 2 + ((lo[ja + c] - lon2) * 111 * Math.cos(lat * Math.PI / 180)) ** 2; if (!best || d2 < best.d2) best = { arr, d2, la: la[ia + r], lo: lo[ja + c] }; });
  if (!best) return { ok: false, error: 'no_sea_cell' };
  const packed = best.arr.some(v => v != null && Math.abs(v) > 100); // 압축(정수·0.001배+20) 상태로 오면 풀기
  const temps = best.arr.map(v => v == null ? null : +(packed ? v * 0.001 + 20 : v).toFixed(2));
  const keepN = dep.findIndex(d => d > 400); const n = keepN < 0 ? nd : keepN; // 400m까지만
  const depths = dep.slice(0, n).map(d => Math.round(d * 10) / 10), tt = temps.slice(0, n);
  const t = new Date(tm[ti] * 3600e3 + Date.UTC(2000, 0, 1)); const when = tm[0] > 100000 && tm[nt - 1] < 1e7 ? t.toISOString().slice(0, 10) : null;
  return { ok: true, src: 'HYCOM', time: when, depths, temps: tt, grid: { lat: +best.la.toFixed(3), lon: +(best.lo > 180 ? best.lo - 360 : best.lo).toFixed(3), km: +Math.sqrt(best.d2).toFixed(1) }, tc: thermocline(depths, tt) };
}

module.exports = async function handler(req, res) {
  const lat = +req.query.lat, lon = +req.query.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 80 || Math.abs(lon) > 180) return res.status(400).json({ ok: false, error: 'bad_coords' });
  const key = `hy:v1:${lat.toFixed(1)}_${lon.toFixed(1)}`;
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600');
  try { const [{ result }] = await redisPipeline([['GET', key]]); if (result) { const o = JSON.parse(result); if (Date.now() - o.at < 6 * 3600e3) return res.status(200).json(o); } } catch (_) {}
  try {
    const o = await profile(+lat.toFixed(1), +lon.toFixed(1)); o.at = Date.now();
    if (o.ok) { try { await redisPipeline([['SET', key, JSON.stringify(o), 'EX', String(24 * 3600)]]); } catch (_) {} }
    else res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json(o);
  } catch (e) { res.setHeader('Cache-Control', 's-maxage=60'); return res.status(200).json({ ok: false, error: String(e && e.message || e).slice(0, 160) }); }
};
module.exports._t = { thermocline, numsAfterHeader, dims };
