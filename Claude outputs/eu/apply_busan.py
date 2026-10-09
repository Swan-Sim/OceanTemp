import os, json, sys
os.chdir(os.path.expanduser('~/mnt/WaterTemp'))
here = os.path.dirname(os.path.abspath(sys.argv[0]))

def rep(path, a, b, count=1):
    s = open(path).read()
    assert s.count(a) == count, (path, a[:70], s.count(a))
    open(path, 'w').write(s.replace(a, b))

open('api/busanwq.js', 'w').write(open(os.path.join(here, 'busanwq.js')).read())

L = 'js/live-data.js'
rep(L, """      const v = computeVisibility(j);
      if (!v) throw new Error('NO_DATA');
      st._visCache = v;
      return v;""", """      const v = computeVisibility(j);
      if (!v) throw new Error('NO_DATA');
      // [ADD] 부산 연안: 부산시가 직접 잰 투명도(분기 평균)를 실측 참고값으로 붙임
      try { v.ground = await groundTransparency(lat, lon); } catch (_) {}
      st._visCache = v;
      return v;
    }

    // 사람이 직접 잰 투명도(세키 원판) - 지금은 부산시 해양환경 측정망만. 정점 6km 안 가장 가까운 지점
    const GROUND_KM = 6;
    async function groundTransparency(lat, lon) {
      if (!(lat > 34.9 && lat < 35.45 && lon > 128.7 && lon < 129.45)) return null;
      const j = await once('busanwq', () => fetchJSON('/api/busanwq', 20000, 0));
      const s = nearestOf(j && j.ok ? j.sites : [], lat, lon, GROUND_KM);
      if (!s) return null;
      const qi = Math.floor(new Date().getMonth() / 3);
      return { name: s.name, dist: s.dist, q: s.q, now: s.q[qi], qi, from: s.from, to: s.to, src: 'busan' };""")

P = 'js/panel-charts.js'
rep(P, """      if (v.check) title += '\\n' + t.visCheck(fmtVis(v.check.vis), mmdd(v.check.from), mmdd(v.check.to), v.check.agree);""",
"""      if (v.check) title += '\\n' + t.visCheck(fmtVis(v.check.vis), mmdd(v.check.from), mmdd(v.check.to), v.check.agree);
      if (v.ground && v.ground.now != null) title += '\\n' + t.visGround(v.ground.name, v.ground.dist.toFixed(1), fmtVis(v.ground.now), v.ground.qi + 1, v.ground.from, v.ground.to);""")
rep(P, """          if (vis.check) datasets.push(""", """          // 실측 투명도(분기 평균): 분기 가운데 달 15일에 노란 동그라미
          if (vis.ground) {
            const pts = [];
            for (let k = -1; k <= 1; k++) vis.ground.q.forEach((val, qi) => {
              if (val == null) return;
              const x = dateToWindowX(new Date(todayObj.getFullYear() + k, qi * 3 + 1, 15).getTime());
              if (x >= -0.4 && x <= 11.6) pts.push({ x, y: val });
            });
            pts.sort((a, b) => a.x - b.x);
            if (pts.length) datasets.push({ label: t.visGroundShort(vis.ground.name), data: pts, yAxisID: 'yv', showLine: false, pointStyle: 'circle', pointRadius: 4.5, pointHoverRadius: 6, pointBackgroundColor: 'rgba(15,23,42,0.9)', pointBorderColor: '#FCD34D', pointBorderWidth: 1.8, _unit: 'vis' });
          }
          if (vis.check) datasets.push(""")
rep(P, """            (vis.check ? `<div class="item"><span style="display:inline-block;width:7px;height:7px;border:1.5px solid #7DD3FC;transform:rotate(45deg);margin:0 5px 0 2px;"></span>${t.visCheckShort} ${fmtVis(vis.check.vis)}</div>` : '')""",
"""            (vis.check ? `<div class="item"><span style="display:inline-block;width:7px;height:7px;border:1.5px solid #7DD3FC;transform:rotate(45deg);margin:0 5px 0 2px;"></span>${t.visCheckShort} ${fmtVis(vis.check.vis)}</div>` : '') +
            (vis.ground ? `<div class="item"><span style="display:inline-block;width:8px;height:8px;border:1.8px solid #FCD34D;border-radius:50%;margin:0 5px 0 1px;"></span>${t.visGroundShort(vis.ground.name)}</div>` : '')""")

I = 'js/i18n-and-input.js'
rep(I, """        visCheckShort: "교차 확인(VIIRS 14일)",""", """        visCheckShort: "교차 확인(VIIRS 14일)",
        visGround: (name, km, v, q, a, b) => `실측 투명도(부산시 측정, ${name} ${km}km·대략 위치, ${a}~${b}년 ${q}분기 평균): ${v}`,
        visGroundShort: (name) => `실측 투명도(부산시, ${name})`,""")
rep(I, """        visCheckShort: "Cross-check (VIIRS 14d)",""", """        visCheckShort: "Cross-check (VIIRS 14d)",
        visGround: (name, km, v, q, a, b) => `Measured transparency (Busan city, ${name} ${km} km, approx. location, Q${q} avg ${a}–${b}): ${v}`,
        visGroundShort: (name) => `Measured transparency (Busan, ${name})`,""")
print('ok')
