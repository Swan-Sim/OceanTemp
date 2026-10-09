import os, json, sys
os.chdir(os.path.expanduser('~/mnt/WaterTemp'))
here = os.path.dirname(os.path.abspath(sys.argv[0]))

def rep(path, a, b, count=1):
    s = open(path).read()
    if b in s and a not in s:
        print('skip (already)', path, a[:50]); return
    assert s.count(a) == count, (path, a[:70], s.count(a))
    s = s.replace(a, b)
    open(path, 'w').write(s)

# 1) server files
for f in ['cmems.js', '_nc.js']:
    open('api/' + f, 'w').write(open(os.path.join(here, f)).read())

# 2) package.json: HDF5 읽기 라이브러리 (Vercel이 배포할 때 설치)
if not os.path.exists('package.json'):
    open('package.json', 'w').write(json.dumps({
        "name": "otemp", "private": True,
        "description": "Global Ocean Temp Monitor (otemp.app)",
        "engines": {"node": ">=18"},
        "dependencies": {"h5wasm": "0.7.8"}
    }, indent=2) + '\n')

# 3) vercel.json
vj = json.load(open('vercel.json'))
vj.setdefault('functions', {})['api/cmems.js'] = {'maxDuration': 60, 'memory': 1024}
open('vercel.json', 'w').write(json.dumps(vj, indent=2) + '\n')

# 4) live-data.js
L = 'js/live-data.js'
rep(L, """    async function mergeNearbyObs(st) {""",
"""    // ── 유럽 등 그 밖의 바다: Copernicus Marine In Situ (각국 부이·조위관측소 모음) ──
    // 조위 25km, 수온·바람 40km, 파도 60km 안에서 값이 있는 가장 가까운 관측소. 시각은 UTC → 현지 시각으로.
    const EU_TEMP_KM = 40, EU_WAVE_KM = 60;
    const cmemsName = (s) => /^\\d+$/.test(s.name) ? `${s.name} ${t.obsBuoyWord}` : String(s.name).replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    async function cmemsObs(lat, lon, d) {
      const j = await once('cmems-st', () => fetchJSON('/api/cmems?svc=stations', 60000, 0)).catch(() => null);
      const list = j && j.ok ? j.stations : [];
      const tSt = nearestOf(list, lat, lon, EU_TEMP_KM, s => s.p.includes('T'));
      const wSt = nearestOf(list, lat, lon, EU_WAVE_KM, s => s.p.includes('W'));
      const vSt = nearestOf(list, lat, lon, EU_TEMP_KM, s => s.p.includes('V'));
      const sSt = nearestOf(list, lat, lon, OBS_RADIUS_KM, s => s.p.includes('S'));
      const sts = [...new Map([tSt, wSt, vSt, sSt].filter(Boolean).map(s => [s.id, s])).values()];
      if (!sts.length) return null;
      const days = Math.min(8, NOW_PAST_DAYS + 1);
      const rowsById = {};
      await Promise.all(sts.map(s => fetchJSON(`/api/cmems?svc=obs&id=${encodeURIComponent(s.id)}&days=${days}`, 45000, 0)
        .then(o => { rowsById[s.id] = (o && o.ok && o.rows) || []; }).catch(() => { rowsById[s.id] = []; })));
      const offset = Math.round((d.nowLocalMs - Date.now()) / 900e3) * 900e3;
      const okTemp = (x, v) => { if (v == null || v < -2 || v > 35) return false; const m = interpAt(d.temp, x); return m == null || Math.abs(v - m) <= 6; };
      // 각 항목마다 값이 실제로 들어온 관측소 중 가장 가까운 곳 (목록에 항목이 있어도 요즘 값이 없을 수 있음)
      const has = (s, k) => s && (rowsById[s.id] || []).some(r => r[k] != null);
      const byDist = sts.slice().sort((a, b) => a.dist - b.dist);
      const pick = (k, maxKm) => byDist.find(s => s.dist <= maxKm && has(s, k)) || null;
      const T = pick('wt', EU_TEMP_KM), W = pick('wv', EU_WAVE_KM), V = pick('ws', EU_TEMP_KM), S = pick('sl', OBS_RADIUS_KM);
      const raw = [];
      sts.forEach(s => (rowsById[s.id] || []).forEach(r => {
        const x = r.t + offset, o = { x };
        if (s === T && okTemp(x, r.wt)) o.wt = r.wt;
        if (s === W) { o.wv = r.wv; o.per = r.per; }
        if (s === V && r.wd != null) { o.ws = r.ws; o.wd = r.wd; }
        if (s === S) o.tide = r.sl;
        raw.push(o);
      }));
      const used = [...new Set([S, T, V, W].filter(Boolean))];
      if (raw.length < 6 || !used.length) return null;
      return { hourly: toHourly(raw), sources: used.map(s => ({ kind: 'cmems', name: cmemsName(s), dist: s.dist })) };
    }

    async function mergeNearbyObs(st) {""")
rep(L, """      else if (inUsWaters(lat, lon)) r = await noaaObs(lat, lon, d);
      if (!r) { d._obs = { sources: [] }; return false; }""",
"""      else if (inUsWaters(lat, lon)) r = await noaaObs(lat, lon, d);
      else r = await cmemsObs(lat, lon, d);
      if (!r) { d._obs = { sources: [] }; return false; }""")
rep(L, """s.kind === 'ndbc' ? t.obsNdbc(s.name) : t.obsCoops(s.name))""",
"""s.kind === 'ndbc' ? t.obsNdbc(s.name) : s.kind === 'cmems' ? t.obsCmems(s.name) : t.obsCoops(s.name))""")
rep(L, """        return daily.length ? { daily, clim, source: { kind: 'coops', name: p.name, dist: p.dist } } : null;
      }
      return null;""",
"""        return daily.length ? { daily, clim, source: { kind: 'coops', name: p.name, dist: p.dist } } : null;
      }
      // 유럽 등: Copernicus 고정 관측소 수온 (최근 약 30일은 하루 파일, 그 전은 월별 파일)
      const j = await once('cmems-st', () => fetchJSON('/api/cmems?svc=stations', 60000, 0)).catch(() => null);
      const p = nearestOf(j && j.ok ? j.stations : [], lat, lon, EU_TEMP_KM, s => s.p.includes('T'));
      if (!p) return null;
      const q = `id=${encodeURIComponent(p.id)}${p.m ? '&m=' + encodeURIComponent(p.m) : ''}`;
      const r = await fetchJSON(`/api/cmems?svc=wtdaily&${q}&days=${OBS_DAILY_DAYS}`, 55000, 0).catch(() => null);
      const daily = (r && r.ok && r.rows) || [];
      const clim = await fetchJSON(`/api/cmems?svc=wtclim&${q}`, 15000, 0).catch(() => null);
      return daily.length >= 7 ? { daily, clim, source: { kind: 'cmems', name: cmemsName(p), dist: p.dist } } : null;""")

# 5) panel-charts.js: 상태 칩 출처 약칭
rep('js/panel-charts.js',
"""s.kind === 'khoa' ? 'KHOA' : s.kind === 'kma' ? 'KMA' : 'NOAA'""",
"""s.kind === 'khoa' ? 'KHOA' : s.kind === 'kma' ? 'KMA' : s.kind === 'cmems' ? 'Copernicus' : 'NOAA'""")

# 6) i18n
I = 'js/i18n-and-input.js'
rep(I, """obsNdbc: (id) => `NDBC ${id} 부이`,""",
"""obsNdbc: (id) => `NDBC ${id} 부이`, obsCmems: (name) => `Copernicus 해양관측 ${name}`,""")
rep(I, """obsNdbc: (id) => `NDBC buoy ${id}`,""",
"""obsNdbc: (id) => `NDBC buoy ${id}`, obsCmems: (name) => `Copernicus Marine ${name}`,""")

# 7) warm script: 유럽 관측소 3년치 월별 수온 미리 쌓기
W = 'scripts/warm-visibility.mjs'
s = open(W).read()
if 'api/cmems' not in s:
    s += """
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
      const j = await (await fetch(`${SITE}/api/cmems?svc=backfill&${q}&months=36&maxFetch=18`, { signal: AbortSignal.timeout(70000) })).json();
      console.log(`Copernicus ${p.name}: ${j.years ?? '?'}년치 (이번에 ${j.fetched ?? '?'}개월)${j.error ? ' ' + j.error : ''}`);
    } catch (e) { console.log(`Copernicus ${p.name} 실패: ${e.message}`); }
  }
} catch (e) { console.log('Copernicus 쌓기 실패:', e.message); }
"""
    open(W, 'w').write(s)
print('applied')
