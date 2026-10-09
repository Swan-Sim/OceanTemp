import os, json
os.chdir(os.path.expanduser('~/mnt/WaterTemp'))

def rep(path, a, b, count=1):
    s = open(path).read()
    assert s.count(a) == count, (path, a[:70], s.count(a))
    open(path, 'w').write(s.replace(a, b))

V = 'api/visibility.js'
s = open(V).read()
i0 = s.index("const OFFSETS = ")
i1 = s.index("module.exports")
s = s[:i0] + """// [CHANGE] "코론 시야가 실제 20m 가까운데 2.8m" - 정점 좌표의 픽셀 하나만 쓰면 해안·항구·얕은 산호초 바닥
// 반사 때문에 그 픽셀만 유난히 탁하게 나오는 일이 많았어요(바로 옆 픽셀은 8~10m). 그래서
//   1) 정점 반경 약 5km 안의 모든 바다 픽셀을 받아 날짜별 "중앙값"을 씁니다(튀는 픽셀 하나에 안 끌려감).
//      값이 하나도 없으면(육지 안쪽 좌표) 반경 약 10km로 넓혀요.
//   2) 교차 확인: 처리 방식이 다른 NOAA VIIRS 근실시간 4km 자료(빈칸 채우기 없음, 더 최근까지)로
//      최근 14일 반경 약 12km 중앙값을 따로 계산해 같이 돌려줍니다(check).
const CHECK_DS = 'noaacwNPPVIIRSkd490Daily';
const R1 = 0.05, R2 = 0.1, RCHECK = 0.11;
const FRESH_MS = 20 * 3600e3, KEEP_SEC = 7 * 86400;

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const kmBetween = (la1, lo1, la2, lo2) => Math.hypot(la2 - la1, (lo2 - lo1) * Math.cos(la1 * Math.PI / 180)) * 111.2;

// 반경 r(도) 상자 → 원 안 픽셀만, 날짜별 { 날짜: [값...] }
async function fetchBox(ds, variable, lat, lon, r, timeSel, deadline) {
  const url = `${BASE}${ds}.csv?${variable}%5B${timeSel}%5D%5B0%5D%5B(${(lat + r).toFixed(3)}):(${(lat - r).toFixed(3)})%5D%5B(${(lon - r).toFixed(3)}):(${(lon + r).toFixed(3)})%5D`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (left < 2000) break;
    try {
      const lines = (await fetchText(url, Math.min(20000, left))).trim().split('\\n').slice(2);
      const by = {};
      const rKm = r * 111.2;
      for (const l of lines) {
        const c = l.split(',');
        const v = parseFloat(c[4]);
        if (!(v > 0)) continue;
        if (kmBetween(lat, lon, +c[2], +c[3]) > rKm) continue;
        (by[c[0].slice(0, 10)] = by[c[0].slice(0, 10)] || []).push(v);
      }
      return by;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('timeout');
}

async function fetchFromNoaa(lat, lon) {
  const deadline = Date.now() + 40000;
  const T90 = 'last-89:1:last';
  const [kdRes, chlRes, chkRes] = await Promise.allSettled([
    fetchBox(KD_DS, 'kd_490', lat, lon, R1, T90, deadline),
    fetchBox(CHL_DS, 'chlor_a', lat, lon, R1, T90, deadline),
    fetchBox(CHECK_DS, 'kd_490', lat, lon, RCHECK, 'last-13:1:last', deadline)
  ]);
  if (kdRes.status !== 'fulfilled') throw kdRes.reason;
  let kd = kdRes.value, chl = chlRes.status === 'fulfilled' ? chlRes.value : null, radiusKm = 5;
  const count = (by) => Object.keys(by || {}).length;
  if (count(kd) < 10) { // 육지 안쪽 좌표 등 → 반경 10km로
    kd = await fetchBox(KD_DS, 'kd_490', lat, lon, R2, T90, deadline).catch(() => ({}));
    chl = await fetchBox(CHL_DS, 'chlor_a', lat, lon, R2, T90, deadline).catch(() => null);
    radiusKm = 10;
    if (count(kd) < 10) return { ok: false, reason: 'no-ocean-pixel' };
  }
  const dates = Object.keys(kd).sort();
  const days = dates.map(d => ({
    d, kd: +median(kd[d]).toFixed(4), n: kd[d].length,
    chl: chl && chl[d] && chl[d].length ? +median(chl[d]).toFixed(4) : null
  }));
  // 교차 확인: 14일 동안의 모든 픽셀 값을 모아 중앙값(구름 때문에 날마다 픽셀 수가 달라서)
  let check = null;
  if (chkRes.status === 'fulfilled') {
    const all = [].concat(...Object.values(chkRes.value));
    const ds = Object.keys(chkRes.value).sort();
    if (all.length >= 5) check = { src: 'NOAA VIIRS NRT 4km', kd: +median(all).toFixed(4), n: all.length, from: ds[0], to: ds[ds.length - 1], radiusKm: 12 };
  }
  return {
    ok: true,
    source: `NOAA CoastWatch NESDIS STAR - VIIRS/OLCI gap-filled (DINEOF) Kd490 & chlorophyll-a, 2km daily, median within ${radiusKm} km`,
    method: 'median', radiusKm, pixel: [lat, lon], hasChl: !!chl && days.some(x => x.chl != null),
    days, check
  };
}

""" + s[i1:]
s = s.replace("const key = `vis:${lat.toFixed(3)}_${lon.toFixed(3)}`;", "const key = `vis2:${lat.toFixed(3)}_${lon.toFixed(3)}`; // 방식이 바뀌어서 새 키(예전 한 픽셀 값과 섞이지 않게)")
open(V, 'w').write(s)

vj = json.load(open('vercel.json'))
vj['functions']['api/visibility.js'] = {'maxDuration': 60}
open('vercel.json', 'w').write(json.dumps(vj, indent=2) + '\n')

# 브라우저: 교차 확인 값 계산·표시
L = 'js/live-data.js'
rep(L, """      return { days, median, p10, p90, sd, last, projection, now: nowP, share, hasChl: !!json.hasChl, pixel: json.pixel };""",
"""      // 교차 확인(다른 위성 처리 자료, 최근 14일 중앙값)
      const check = json.check && json.check.kd > 0 ? { ...json.check, vis: Math.max(VIS_MIN, Math.min(VIS_MAX, 1.7 / json.check.kd)) } : null;
      if (check) { const r = check.vis / nowP.vis; check.agree = r >= 0.6 && r <= 1.67; }
      return { days, median, p10, p90, sd, last, projection, now: nowP, share, hasChl: !!json.hasChl, pixel: json.pixel, radiusKm: json.radiusKm, check };""")

P = 'js/panel-charts.js'
rep(P, """      const title = t.visGaugeTitle(fmtVis(v.now.vis), fmtVis(v.p10), fmtVis(v.p90), mmdd(v.last.d), fmtVis(v.last.vis));
      return `<span class="nt-vis" title="${title}">${EYE_SVG}<b>${fmtVis(v.now.vis)}</b>` +""",
"""      let title = t.visGaugeTitle(fmtVis(v.now.vis), fmtVis(v.p10), fmtVis(v.p90), mmdd(v.last.d), fmtVis(v.last.vis));
      if (v.radiusKm) title = t.visRadius(v.radiusKm) + '\\n' + title;
      if (v.check) title += '\\n' + t.visCheck(fmtVis(v.check.vis), mmdd(v.check.from), mmdd(v.check.to), v.check.agree);
      // 두 위성 자료가 크게 다르면 숫자 옆에 작은 "≠" 표시(마우스를 올리면 설명)
      const warn = v.check && !v.check.agree ? `<span class="nt-vis-warn">≠${fmtVis(v.check.vis)}</span>` : '';
      return `<span class="nt-vis" title="${title}">${EYE_SVG}<b>${fmtVis(v.now.vis)}</b>${warn}` +""")
# 연간 추이 그래프: 교차 확인 값을 마름모 점으로
rep(P, """            { label: t.visAxis, data: vis.days.map(x => ({ x: dateToWindowX(x.t), y: +x.vis.toFixed(2) })), yAxisID: 'yv', showLine: false, pointRadius: 1.3, pointBackgroundColor: 'rgba(56,189,248,0.45)', pointBorderWidth: 0, _noTip: true }
          );""", """            { label: t.visAxis, data: vis.days.map(x => ({ x: dateToWindowX(x.t), y: +x.vis.toFixed(2) })), yAxisID: 'yv', showLine: false, pointRadius: 1.3, pointBackgroundColor: 'rgba(56,189,248,0.45)', pointBorderWidth: 0, _noTip: true }
          );
          if (vis.check) datasets.push({ label: t.visCheckShort, data: [{ x: dateToWindowX(Date.parse(vis.check.to + 'T12:00:00Z')), y: +vis.check.vis.toFixed(2) }], yAxisID: 'yv', showLine: false, pointStyle: 'rectRot', pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: 'rgba(15,23,42,0.9)', pointBorderColor: '#7DD3FC', pointBorderWidth: 1.6, _unit: 'vis' });""")
rep(P, """        const visLegend = vis
          ? `<div class="item"><span class="swatch" style="background:#38BDF8;"></span>${t.visObserved}</div>
             <div class="item"><span class="swatch band"></span>${t.visTrend}</div>`""",
"""        const visLegend = vis
          ? `<div class="item"><span class="swatch" style="background:#38BDF8;"></span>${t.visObserved}</div>
             <div class="item"><span class="swatch band"></span>${t.visTrend}</div>` +
            (vis.check ? `<div class="item"><span style="display:inline-block;width:7px;height:7px;border:1.5px solid #7DD3FC;transform:rotate(45deg);margin:0 5px 0 2px;"></span>${t.visCheckShort} ${fmtVis(vis.check.vis)}</div>` : '')""")

I = 'js/i18n-and-input.js'
rep(I, """        visNoChl: "엽록소 자료가 없어 원인은 나눌 수 없어요",""", """        visNoChl: "엽록소 자료가 없어 원인은 나눌 수 없어요",
        visRadius: (km) => `정점 반경 ${km}km 바다 픽셀의 중앙값`,
        visCheck: (v, a, b, ok) => `교차 확인(다른 위성 처리, ${a}~${b} 중앙값): ${v}${ok ? '' : '\\n두 위성 자료 차이가 커요 - 해안·얕은 바닥 영향일 수 있어요'}`,
        visCheckShort: "교차 확인(VIIRS 14일)",""")
rep(I, """        visNoChl: "No chlorophyll data - cause can't be split",""", """        visNoChl: "No chlorophyll data - cause can't be split",
        visRadius: (km) => `Median of ocean pixels within ${km} km`,
        visCheck: (v, a, b, ok) => `Cross-check (different satellite processing, ${a}–${b} median): ${v}${ok ? '' : '\\nThe two satellite sources disagree - coast or shallow bottom may affect them'}`,
        visCheckShort: "Cross-check (VIIRS 14d)",""")

css = open('css/styles.css').read()
if '.nt-vis-warn' not in css:
    css += """
    /* [ADD] 시야: 두 위성 자료 차이가 클 때 숫자 옆 작은 표시 */
    .nt-vis-warn { margin-left: 3px; font-size: 10px; font-weight: 600; color: #FBBF24; opacity: .9; }
"""
    open('css/styles.css', 'w').write(css)
print('ok')
rep(L, "fetchJSON(`/api/visibility?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`, 40000, 0)", "fetchJSON(`/api/visibility?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&v=2`, 60000, 0)")
print('ok2')
