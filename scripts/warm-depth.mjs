// [ADD] 밤마다 등록된 모든 포인트 주변 "수심 지도 타일"을 미리 그려 서버(Redis)에 저장해 두는 스크립트.
// GitHub Actions(.github/workflows/warm-depth.yml)가 실행해요.
//  - 사이트의 /api/spotobs?svc=dvec&x=..&y=.. (줌 13 타일, 한 장 약 4~5km)를 호출하면 서버가 계산해서 저장 → 방문자는 바로 받아요.
//  - 순서: 1) 모든 포인트가 든 타일 먼저  2) 그 둘레 8칸. 이미 저장된 타일은 금방 끝나서, 며칠에 걸쳐 이어서 채워져요.
//  - 외부 서버(해안선·수심)가 바쁘면 그 타일은 건너뛰고 다음 날 다시 해요. 시간 한도(기본 300분)에 닿으면 깔끔하게 멈춰요.
import { readFile } from 'node:fs/promises';

const SITE = process.env.SITE_URL || 'https://otemp.app';
const CONCURRENCY = +process.env.CONCURRENCY || 3;
const BUDGET_MS = (+process.env.BUDGET_MIN || 300) * 60e3;
const RING = process.env.RING === undefined ? 1 : +process.env.RING; // 포인트 타일에서 몇 칸 둘레까지(1 = 3×3)
const Z = 8192; // 2^13

const tx = (lon) => Math.floor((lon + 180) / 360 * Z);
const ty = (lat) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Z); };

async function loadSpots() {
  const out = [];
  try {
    const j = await (await fetch(`${SITE}/api/shops?svc=spots`, { signal: AbortSignal.timeout(20000) })).json();
    (j.spots || []).forEach(s => { if (Number.isFinite(+s.lat) && Number.isFinite(+s.lon) && Math.abs(+s.lat) < 85) out.push({ lat: +s.lat, lon: +s.lon }); });
  } catch (e) { console.error('포인트 목록 실패:', e.message); }
  if (out.length < 10) { // 대체: 저장소의 data/stations.csv(위도·경도 열)
    try { const t = await readFile(new URL('../data/stations.csv', import.meta.url), 'utf8'); const [h, ...rows] = t.split(/\r?\n/).filter(Boolean);
      const cols = h.split(',').map(x => x.trim().toLowerCase()), a = cols.indexOf('lat'), o = cols.indexOf('lon');
      rows.forEach(l => { const c = l.split(','); const la = parseFloat(c[a]), lo = parseFloat(c[o]); if (Number.isFinite(la) && Number.isFinite(lo)) out.push({ lat: la, lon: lo }); }); } catch (_) {}
  }
  return out;
}

function planTiles(spots) {
  const seen = new Set(), pass1 = [], pass2 = [];
  spots.forEach(s => { const x = tx(s.lon), y = ty(s.lat), k = x + '_' + y; if (!seen.has(k)) { seen.add(k); pass1.push([x, y]); } });
  spots.forEach(s => { const x = tx(s.lon), y = ty(s.lat);
    for (let dy = -RING; dy <= RING; dy++) for (let dx = -RING; dx <= RING; dx++) { const k = (x + dx) + '_' + (y + dy); if (!seen.has(k)) { seen.add(k); pass2.push([x + dx, y + dy]); } } });
  return pass1.concat(pass2);
}

const stamp = new Date().toISOString().slice(0, 10);
async function warm([x, y]) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${SITE}/api/spotobs?svc=dvec&x=${x}&y=${y}&w=${stamp}`, { signal: AbortSignal.timeout(75000) });
    const j = await r.json().catch(() => ({}));
    return { x, y, ms: Date.now() - t0, ok: !!j.ok, pending: !!(j.tmp || j.retry || j.landErr), empty: !!j.empty, err: j.error };
  } catch (e) { return { x, y, ms: Date.now() - t0, ok: false, pending: true, err: String(e.message || e).slice(0, 80) }; }
}

const spots = await loadSpots();
const tiles = planTiles(spots);
console.log(`포인트 ${spots.length}곳 → 수심 타일 ${tiles.length}장(둘레 ${RING}칸)`);
const t0 = Date.now(); let i = 0, done = 0, empty = 0, pending = 0, failed = 0, slow = 0;
async function worker() {
  while (i < tiles.length && Date.now() - t0 < BUDGET_MS) {
    const t = tiles[i++], r = await warm(t); done++;
    if (r.empty) empty++; else if (!r.ok) failed++; else if (r.pending) pending++;
    if (r.ms > 20000) slow++;
    if (!r.ok || r.pending) console.log(`  · ${r.x}_${r.y} 다시 시도 필요: ${r.err || 'tmp'} (${Math.round(r.ms / 1000)}s)`);
    if (done % 50 === 0) console.log(`  ${done}/${tiles.length} · 걸린 시간 ${Math.round((Date.now() - t0) / 60000)}분`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`끝: ${done}/${tiles.length}장 확인 · 바다 없음 ${empty} · 임시 저장(다음에 다시) ${pending} · 실패 ${failed} · 20초 넘은 것 ${slow}${i < tiles.length ? ' · 시간 한도로 멈춤(내일 이어서)' : ''}`);
// 실패가 많아도 작업 자체는 성공으로 끝내요(내일 이어서 하므로)
