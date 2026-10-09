import os, json, sys
os.chdir(os.path.expanduser('~/mnt/WaterTemp'))
here = os.path.dirname(os.path.abspath(sys.argv[0]))

def rep(path, a, b, count=1):
    s = open(path).read()
    assert s.count(a) == count, (path, a[:70], s.count(a))
    open(path, 'w').write(s.replace(a, b))

open('api/spotobs.js', 'w').write(open(os.path.join(here, 'spotobs.js')).read())
vj = json.load(open('vercel.json'))
vj['functions']['api/spotobs.js'] = {'maxDuration': 60}
open('vercel.json', 'w').write(json.dumps(vj, indent=2) + '\n')

G = 'js/globe-scene.js'
# 1) 위성 격자: 이미 실측으로 칠한 정점은 덮어쓰지 않게
rep(G, """      stations.forEach(st => {
        const val = sstAt(grid, st.coords[1], st.coords[0]);
        if (val != null) {""", """      stations.forEach(st => {
        if (st._spotObs) return; // 근처 관측소 실측으로 이미 칠한 정점
        const val = sstAt(grid, st.coords[1], st.coords[0]);
        if (val != null) {""")
# 위성 격자 적용 뒤 해변 정점 점 색도 다시 그리기(예전엔 처음 추정 색 그대로였어요)
rep(G, """      refreshMaxTempStation();
      // 이미 선택된 정점이 있으면 새 값으로 다시 표시""", """      refreshMaxTempStation();
      refreshBeachSprites();
      // 이미 선택된 정점이 있으면 새 값으로 다시 표시""")

# 2) 백그라운드: 위성 격자 + 정점 실측 (둘 다 서버 저장본이라 빠름)
rep(G, """      try {
        const grid = await getSstGrid();
        applySstGridToStations(grid);
        return;
      } catch (e) {""", """      const spotObsP = fetchSpotObs(); // 정점 실측 모음은 동시에 받아 두고
      try {
        const grid = await getSstGrid();
        applySstGridToStations(grid);
      } catch (e) {""")
rep(G, """        console.warn('[validate] 위성 수온 격자 실패 - 정점은 추정값으로 둡니다:', e.message);
      }
    }""", """        console.warn('[validate] 위성 수온 격자 실패 - 정점은 추정값으로 둡니다:', e.message);
      }
      applySpotObs(await spotObsP); // 위성 값 위에 해변 정점만 실측으로 덮어써요
    }

    // [ADD] 해변 정점 실측 수온 모음(/api/spotobs, 서버가 1시간마다 갱신) → 정점 점 색과 값
    async function fetchSpotObs() {
      if (!/^https?:$/.test(location.protocol)) return null;
      try { const j = await fetchJSON('/api/spotobs', 20000, 0); return j && j.ok ? j : null; }
      catch (e) { console.warn('[spotobs] 정점 실측 모음 실패 - 위성 값 그대로:', e.message); return null; }
    }
    function applySpotObs(j) {
      if (!j || !j.spots) return;
      const key = (lat, lon) => `${(+lat).toFixed(3)},${(+lon).toFixed(3)}`;
      const by = new Map(j.spots.map(s => [key(s.lat, s.lon), s]));
      let n = 0;
      stations.forEach(st => {
        if (!st.isBeach) return;
        const o = by.get(key(st.coords[1], st.coords[0]));
        if (!o) return;
        if (!st._hourlyCache) st.curTemp = o.t; // 이미 표를 연 정점은 그 값(더 최신)을 유지
        st._spotObs = { ...o.src, at: o.at, t: o.t };
        st._liveCurrentVerified = true;
        n++;
      });
      console.info(`[spotobs] 정점 ${n}곳을 근처 관측소 실측 수온으로 표시`);
      refreshMaxTempStation();
      refreshBeachSprites();
      if (selectedStation && selectedStation._spotObs && !selectedStation._hourlyCache) {
        const el = document.getElementById('st-temp');
        if (el) el.innerText = formatTemp(selectedStation.curTemp);
      }
    }
    // 해변 정점 스프라이트(점+이름표)를 지금 수온 색으로 다시 그리기
    function refreshBeachSprites() {
      const byId = new Map(stations.map(s => [s.id, s]));
      beachSprites.forEach(sp => {
        const st = byId.get(sp.userData.stationId);
        if (!st) return;
        const label = st.label;
        const r = drawMarkerTexture(st, { selected: false, labelOnLeft: false, label });
        const l = drawMarkerTexture(st, { selected: false, labelOnLeft: true, label });
        [sp.userData.rightVariant, sp.userData.leftVariant].forEach(v => v && v.texture && v.texture.dispose());
        sp.userData.rightVariant = r; sp.userData.leftVariant = l;
        const v = sp.userData.labelOnLeft ? l : r;
        sp.material.map = v.texture;
        sp.material.needsUpdate = true;
        sp.center.set(v.dotX / v.canvasW, 1 - v.dotY / v.canvasH);
      });
      if (selectionMarker) selectionMarker.userData.forId = null; // 선택 표시도 새 색으로
      try { refreshSelectionMarker(); } catch (_) {}
    }""")

# 3) 매일 작업: 정점 실측 모음도 한 번 새로
W = 'scripts/warm-visibility.mjs'
s = open(W).read()
if 'api/spotobs' not in s:
    s += """
// [ADD] 정점 실측 수온 모음(처음 화면 정점 색) 새로 만들기
try {
  const j = await (await fetch(`${SITE}/api/spotobs?refresh=1`, { signal: AbortSignal.timeout(90000) })).json();
  console.log(`정점 실측 수온: ${j.count ?? '?'}/${j.of ?? '?'}곳 (${j.ms ?? '?'}ms)`);
} catch (e) { console.log('정점 실측 수온 실패:', e.message); }
"""
    open(W, 'w').write(s)
print('ok')
