import os, json, sys
os.chdir(os.path.expanduser('~/mnt/WaterTemp'))
here = os.path.dirname(os.path.abspath(sys.argv[0]))

def rep(path, a, b, count=1):
    s = open(path).read()
    assert s.count(a) == count, (path, a[:70], s.count(a))
    s = s.replace(a, b)
    open(path, 'w').write(s)

# 1) server
open('api/khoa.js', 'w').write(open(os.path.join(here, 'khoa.js')).read())
open('api/noaa.js', 'w').write(open(os.path.join(here, 'noaa.js')).read())

# 2) live-data.js: KHOA helpers + non-blocking merge after hourly fetch
s = open('js/live-data.js').read()
if 'mergeNearbyObs' not in s:
    s += open(os.path.join(here, 'live_add.js')).read()
    open('js/live-data.js', 'w').write(s)
rep('js/live-data.js',
"""      const result = { temp, tide, waves, wind, extremes, nowLocalMs, from, to };
      station._hourlyCache = result;
      return result;""",
"""      const result = { temp, tide, waves, wind, extremes, nowLocalMs, from, to };
      station._hourlyCache = result;
      // [ADD] 한국·미국 정점이면 근처 관측소 실측을 뒤이어 불러와 지금까지 칸을 실측으로 바꿔요(표는 먼저 그려짐)
      mergeNearbyObs(station).then(ok => {
        if (!ok) return;
        if (selectedStation === station && typeof updateChart === 'function') {
          const el = document.getElementById('st-temp'); if (el) el.innerText = formatTemp(station.curTemp);
          updateChart();
        }
      }).catch(e => console.warn('[obs] 실측 합치기 실패:', e));
      return result;""")

# 3) panel-charts.js: obs markers + note
rep('js/panel-charts.js',
"""        rows.temp += cell(tp ? tempVal(tp.y) : '–', tp ? 'color:rgba(255,255,255,0.9);font-weight:700;' : 'color:#4B5565;');""",
"""        rows.temp += cell(tp ? (tp.obs ? `<span class="nt-obs">${tempVal(tp.y)}</span>` : tempVal(tp.y)) : '–', tp ? 'color:rgba(255,255,255,0.9);font-weight:700;' : 'color:#4B5565;');""")
rep('js/panel-charts.js',
"""        rows.wind += cell(w ? Math.round(w.speed) : '–', w ? `color:${windColor(w.speed)};font-weight:600;` : 'color:#4B5565;');""",
"""        rows.wind += cell(w ? (w.obs ? `<span class="nt-obs">${Math.round(w.speed)}</span>` : Math.round(w.speed)) : '–', w ? `color:${windColor(w.speed)};font-weight:600;` : 'color:#4B5565;');""")
rep('js/panel-charts.js',
"""        `<div class="nt-note">${t.tideNote}</div>`;""",
"""        `<div class="nt-note">${d._obs && d._obs.sources.length ? t.obsNote(obsSourceText(d._obs.sources), !!d._tidePred) : t.tideNote}</div>`;""")
rep('js/panel-charts.js',
"""      let status = `<span class="nt-live" title="${t.nowSource}">● ${t.statusLive}</span>`;""",
"""      let status = `<span class="nt-live" title="${d && d._obs && d._obs.sources.length ? t.obsSource(obsSourceText(d._obs.sources)) : t.nowSource}">● ${t.statusLive}</span>`;""")

rep('js/panel-charts.js',
"""        rows.wave += cell(wv ? wv.height.toFixed(1) : '–', wv ? waveCellStyle(wv.height) : 'color:#4B5565;');""",
"""        rows.wave += cell(wv ? (wv.obs ? `<span class="nt-obs">${wv.height.toFixed(1)}</span>` : wv.height.toFixed(1)) : '–', wv ? waveCellStyle(wv.height) : 'color:#4B5565;');""")

# 4) i18n
rep('js/i18n-and-input.js',
"""        visNoChl: "엽록소 자료가 없어 원인은 나눌 수 없어요",""",
"""        visNoChl: "엽록소 자료가 없어 원인은 나눌 수 없어요",
        // [ADD] 근처 관측소 실측 (국립해양조사원 / NOAA)
        obsNote: (src, pred) => `<span class="nt-obsdot"></span> 점 = 실측: ${src} · 이후 칸은 예보${pred ? ' (조석은 NOAA 예측)' : ''}`,
        obsSource: (src) => `지금까지: 실측 - ${src} · 이후: 예보 모델 (Open-Meteo)`,
        obsKhoa: (name) => `국립해양조사원 ${name}`, obsCoops: (name) => `NOAA ${name}`, obsNdbc: (id) => `NDBC ${id} 부이`,""")
rep('js/i18n-and-input.js',
"""        visNoChl: "No chlorophyll data - cause can't be split",""",
"""        visNoChl: "No chlorophyll data - cause can't be split",
        obsNote: (src, pred) => `<span class="nt-obsdot"></span> dot = observed: ${src} · later columns are forecast${pred ? ' (tide: NOAA prediction)' : ''}`,
        obsSource: (src) => `Up to now: observed - ${src} · later: forecast model (Open-Meteo)`,
        obsKhoa: (name) => `KHOA ${name}`, obsCoops: (name) => `NOAA ${name}`, obsNdbc: (id) => `NDBC buoy ${id}`,""")

# 5) css
css = open('css/styles.css').read()
if '.nt-obs' not in css:
    css += """
    /* [ADD] 국립해양조사원 실측 칸 표시: 숫자 아래 작은 하늘색 점 */
    .nt-obs { position: relative; }
    .nt-obs::after { content: ''; position: absolute; left: 50%; bottom: -4px; width: 3px; height: 3px; margin-left: -1.5px; border-radius: 50%; background: #38BDF8; }
    .nt-obsdot { display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: #38BDF8; vertical-align: middle; margin-right: 2px; }
"""
    open('css/styles.css', 'w').write(css)

# 6) vercel.json: 관측소 목록 만들 때 시간이 걸려서 60초
vj = json.load(open('vercel.json'))
vj.setdefault('functions', {})['api/khoa.js'] = {'maxDuration': 60}
vj['functions']['api/noaa.js'] = {'maxDuration': 60}
open('vercel.json', 'w').write(json.dumps(vj, indent=2) + '\n')

# 7) warm script: 관측소 목록도 하루 한 번 미리
rep('scripts/warm-visibility.mjs',
"""const stations = await loadStations();""",
"""// 국립해양조사원 관측소 목록(한국 정점 짝짓기용)도 미리 만들어 둠
try {
  const r = await fetch(`${SITE}/api/khoa?svc=stations`, { signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  console.log(`KHOA 관측소 목록: ${j.count ?? '?'}곳`);
} catch (e) { console.log('KHOA 관측소 목록 실패:', e.message); }
try {
  const r = await fetch(`${SITE}/api/noaa?svc=stations`, { signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  console.log(`NOAA 관측소 목록: CO-OPS ${j.coops?.length ?? '?'}곳, NDBC ${j.ndbc?.length ?? '?'}곳`);
} catch (e) { console.log('NOAA 관측소 목록 실패:', e.message); }

const stations = await loadStations();""")
print('applied')
