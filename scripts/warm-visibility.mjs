// [ADD] 매일 한 번, 모든 정점의 시야(위성) 자료를 미리 불러 두는 스크립트.
// GitHub Actions(.github/workflows/warm-visibility.yml)가 실행합니다.
// 사이트의 /api/visibility를 정점마다 한 번씩 호출하면, 그 함수가 NOAA에서 받아
// Upstash Redis에 저장해 둡니다 → 방문자는 NOAA를 기다리지 않고 바로 받아요.
// 정점 목록은 사이트와 똑같이 구글 시트 → 실패하면 data/stations.csv 순서로 읽어요.
import { readFile } from 'node:fs/promises';

const SITE = process.env.SITE_URL || 'https://otemp.app';
const SHEET = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSN3HofGgc9HEUOIag-2EQpPnpJ9gZi2DTXLvu1t9LP3WAeAe-IYIFmJ6H_buloREnhfLsbWWRN9S9j/pub?output=csv';
const CONCURRENCY = 2; // NOAA 서버가 동시 요청이 많으면 502를 내서 2개씩만

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; if (row.some(c => c.trim() !== '')) rows.push(row); row = [];
    } else cur += ch;
  }
  row.push(cur); if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}

async function loadStations() {
  let text = null;
  try {
    const r = await fetch(SHEET, { signal: AbortSignal.timeout(15000) });
    if (r.ok) text = await r.text();
  } catch (_) {}
  if (!text || !/lat/i.test(text.split('\n')[0])) text = await readFile(new URL('../data/stations.csv', import.meta.url), 'utf8');
  const [head, ...rows] = parseCsv(text);
  const idx = Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), i]));
  const out = [];
  for (const r of rows) {
    const lat = parseFloat(r[idx.lat]), lon = parseFloat(r[idx.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (/^n/i.test((r[idx.show] || '').trim())) continue;
    out.push({ name: (r[idx.name] || '').trim(), lat, lon });
  }
  // [ADD] 승인된 사용자 등록 포인트도 미리 받아두기
  try {
    const j = await (await fetch(`${SITE}/api/shops?svc=spots`, { signal: AbortSignal.timeout(15000) })).json();
    (j.spots || []).forEach(s => { if (Number.isFinite(+s.lat) && Number.isFinite(+s.lon)) out.push({ name: s.name, lat: +s.lat, lon: +s.lon }); });
  } catch (_) {}
  return out;
}

async function warm(st) {
  const url = `${SITE}/api/visibility?lat=${st.lat.toFixed(3)}&lon=${st.lon.toFixed(3)}&refresh=1`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(65000) }); // 처음 받는 정점은 30일씩 3번이라 조금 더 기다림
    const j = await r.json().catch(() => ({}));
    return { st, ms: Date.now() - t0, status: r.status, ok: !!j.ok, cache: r.headers.get('x-vis-cache'), reason: j.reason || j.error };
  } catch (e) {
    return { st, ms: Date.now() - t0, status: 0, ok: false, reason: e.message };
  }
}

// 국립해양조사원 관측소 목록(한국 정점 짝짓기용)도 미리 만들어 둠
try {
  const r = await fetch(`${SITE}/api/khoa?svc=stations`, { signal: AbortSignal.timeout(130000) });
  const j = await r.json();
  console.log(`KHOA 관측소 목록: ${j.count ?? '?'}곳`);
} catch (e) { console.log('KHOA 관측소 목록 실패:', e.message); }
try {
  const r = await fetch(`${SITE}/api/noaa?svc=stations`, { signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  console.log(`NOAA 관측소 목록: CO-OPS ${j.coops?.length ?? '?'}곳, NDBC ${j.ndbc?.length ?? '?'}곳`);
} catch (e) { console.log('NOAA 관측소 목록 실패:', e.message); }

// [ADD] 지구 바다 색(위성 수온 격자)도 매일 서버에 새로 저장
try {
  const r = await fetch(`${SITE}/api/sst?refresh=1`, { signal: AbortSignal.timeout(60000) });
  console.log(`위성 수온 격자: ${r.status} ${r.headers.get('x-sst-cache') || ''}`);
} catch (e) { console.log('위성 수온 격자 실패:', e.message); }

const stations = await loadStations();
console.log(`정점 ${stations.length}곳 시야 자료 미리 불러오기 시작`);
const results = [];
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < stations.length) {
    const st = stations[next++];
    const res = await warm(st);
    results.push(res);
    console.log(`${res.ok ? 'OK ' : 'NO '} ${String(res.ms).padStart(6)}ms ${res.cache || '-'} ${st.name}${res.reason ? '  (' + res.reason + ')' : ''}`);
  }
}));
const ok = results.filter(r => r.ok).length;
console.log(`완료: ${ok}/${results.length}곳 성공`);

// ───── [ADD] 관측소 실측 수온 3년치 미리 쌓기 (90일 추이의 실측 구간 + "평년(실측 N년 평균)"용) ─────
// 우리 정점에서 25km 안에 있는 관측소만. 한국은 하루치씩 받는 API라 하루 호출 한도(1만)를 지키려고
// 관측소마다 하루 최대 350일씩 나눠서 채워요(처음 며칠이면 3년치가 다 쌓이고, 이후엔 하루 1번씩).
const R = 6371, rad = Math.PI / 180;
const km = (a, b, c, d) => 2 * R * Math.asin(Math.sqrt(Math.sin((c - a) * rad / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin((d - b) * rad / 2) ** 2));
const nearestWithin = (list, st, maxKm, f) => {
  let best = null;
  for (const k of list || []) { if (f && !f(k)) continue; const d = km(st.lat, st.lon, k.lat, k.lon); if (d <= maxKm && (!best || d < best.d)) best = { ...k, d }; }
  return best;
};
try {
  const kh = await (await fetch(`${SITE}/api/khoa?svc=stations`, { signal: AbortSignal.timeout(130000) })).json();
  const nw = await (await fetch(`${SITE}/api/noaa?svc=stations`, { signal: AbortSignal.timeout(60000) })).json();
  const khoaCodes = new Set(), coopsIds = new Set();
  for (const st of stations) {
    const k = nearestWithin(kh.stations, st, 25, s => s.kind !== 'buoy'); if (k) khoaCodes.add(k.code);
    const n = nearestWithin(nw.coops, st, 25, s => s.wt); if (n) coopsIds.add(n.id); // 미국 정점: NOAA 4년치 수온 미리 받아 두기
  }
  console.log(`실측 수온 미리 쌓기: KHOA ${khoaCodes.size}곳, NOAA ${coopsIds.size}곳`);
  for (const code of khoaCodes) {
    const t0 = Date.now();
    try {
      const j = await (await fetch(`${SITE}/api/khoa?svc=wtdaily&obs=${code}&days=1250&maxFetch=350`, { signal: AbortSignal.timeout(70000) })).json();
      console.log(`KHOA ${code}: 쌓인 날 ${j.count ?? '?'}/1250 (${Date.now() - t0}ms)${j.error ? ' ' + j.error : ''}`);
    } catch (e) { console.log(`KHOA ${code} 실패: ${e.message}`); }
  }
  for (const id of coopsIds) {
    try {
      const j = await (await fetch(`${SITE}/api/noaa?svc=wtyears&id=${id}&refresh=1`, { signal: AbortSignal.timeout(70000) })).json();
      console.log(`NOAA ${id}: ${Object.keys(j.days || {}).length}일치`);
    } catch (e) { console.log(`NOAA ${id} 실패: ${e.message}`); }
  }
} catch (e) { console.log('실측 수온 미리 쌓기 실패:', e.message); }
// [ADD] 기상청 부이 정오 수온 3년치 (전국 부이를 한 번에 받는 자료라 한 번 호출로 모든 부이가 같이 쌓여요)
try {
  for (let i = 0; i < 2; i++) {
    const j = await (await fetch(`${SITE}/api/kma?svc=backfill&days=1250&maxFetch=300`, { signal: AbortSignal.timeout(130000) })).json();
    console.log(`기상청 부이 정오 수온: ${j.have ?? '?'}/1250일 (이번에 ${j.fetched ?? '?'}일)${j.error ? ' ' + j.error : ''}`);
    if (!j.fetched) break;
  }
} catch (e) { console.log('기상청 부이 쌓기 실패:', e.message); }

// [ADD] 유럽 등(Copernicus): 정점 40km 안 수온 관측소의 지난 3년 월별 파일 → 일평균 미리 쌓기 (평년용)
try {
  const cj = await (await fetch(`${SITE}/api/cmems?svc=stations`, { signal: AbortSignal.timeout(90000) })).json();
  console.log(`Copernicus 관측소 목록: ${cj.count ?? '?'}곳`);
  const ids = new Map();
  for (const st of stations) {
    const p = nearestWithin(cj.stations || [], st, 40, s => s.p.includes('T'));
    if (p) ids.set(p.id, p);
  }
  console.log(`Copernicus 수온 미리 쌓기: ${ids.size}곳`);
  for (const p of ids.values()) {
    try {
      const q = `id=${encodeURIComponent(p.id)}${p.m ? '&m=' + encodeURIComponent(p.m) : ''}`;
      const j = await (await fetch(`${SITE}/api/cmems?svc=backfill&${q}&months=41&maxFetch=20`, { signal: AbortSignal.timeout(70000) })).json();
      console.log(`Copernicus ${p.name}: ${j.years ?? '?'}년치 (이번에 ${j.fetched ?? '?'}개월)${j.error ? ' ' + j.error : ''}`);
    } catch (e) { console.log(`Copernicus ${p.name} 실패: ${e.message}`); }
  }
} catch (e) { console.log('Copernicus 쌓기 실패:', e.message); }

// [ADD] 정점 실측 수온 모음(처음 화면 정점 색) 새로 만들기
try {
  const j = await (await fetch(`${SITE}/api/spotobs?refresh=1`, { signal: AbortSignal.timeout(90000) })).json();
  console.log(`정점 실측 수온: ${j.count ?? '?'}/${j.of ?? '?'}곳 (${j.ms ?? '?'}ms)`);
} catch (e) { console.log('정점 실측 수온 실패:', e.message); }

// [ADD] 상세 페이지(/ko/s/번호/이름) 자료 미리 받아 두기: 예보·물때·시야 묶음, 월별 평균 수온·시야, 주변 수심 → 방문자는 빈 칸 없이 바로 봐요
//  목록은 사이트맵에서(등록된 모든 포인트 번호). 포인트마다 /api/spotobs?svc=warm&no= 한 번(서버가 2분에 한 번만 받아요).
try {
  const xml = await (await fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(30000) })).text();
  const nos = [...new Set([...xml.matchAll(/\/ko\/s\/(\d+)\//g)].map(m => +m[1]))];
  console.log(`상세 페이지 미리 받기: ${nos.length}곳`);
  let ok = 0, fail = 0, i = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 3 }, async () => { // 3개씩
    while (i < nos.length && Date.now() - t0 < 40 * 60e3) {
      const no = nos[i++];
      try {
        const r = await fetch(`${SITE}/api/spotobs?svc=warm&no=${no}`, { signal: AbortSignal.timeout(65000) });
        const j = await r.json().catch(() => ({}));
        if (j.ok) ok++; else fail++;
        const bad = (j.done || []).filter(x => /:/.test(x) && !/^depth:cached$/.test(x));
        if (bad.length) console.log(`  #${no}: ${bad.join(', ')}`);
      } catch (e) { fail++; console.log(`  #${no} 실패: ${e.message}`); }
    }
  }));
  console.log(`상세 페이지 미리 받기 끝: 성공 ${ok}, 실패 ${fail} (${Math.round((Date.now() - t0) / 1000)}초)`);
} catch (e) { console.log('상세 페이지 미리 받기 실패:', e.message); }
