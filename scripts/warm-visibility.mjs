// [ADD] 매일 한 번, 모든 정점의 시야(위성) 자료를 미리 불러 두는 스크립트.
// GitHub Actions(.github/workflows/warm-visibility.yml)가 실행합니다.
// 사이트의 /api/visibility를 정점마다 한 번씩 호출하면, 그 함수가 NOAA에서 받아
// Upstash Redis에 저장해 둡니다 → 방문자는 NOAA를 기다리지 않고 바로 받아요.
// 정점 목록은 사이트와 똑같이 구글 시트 → 실패하면 data/stations.csv 순서로 읽어요.
import { readFile } from 'node:fs/promises';

const SITE = process.env.SITE_URL || 'https://oceantemp.vercel.app';
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
  return out;
}

async function warm(st) {
  const url = `${SITE}/api/visibility?lat=${st.lat.toFixed(3)}&lon=${st.lon.toFixed(3)}&refresh=1`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
    const j = await r.json().catch(() => ({}));
    return { st, ms: Date.now() - t0, status: r.status, ok: !!j.ok, cache: r.headers.get('x-vis-cache'), reason: j.reason || j.error };
  } catch (e) {
    return { st, ms: Date.now() - t0, status: 0, ok: false, reason: e.message };
  }
}

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
