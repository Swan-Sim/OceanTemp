import os, re
os.chdir(os.path.expanduser('~/mnt/WaterTemp'))

def rep(path, a, b, count=1):
    s = open(path).read()
    assert s.count(a) == count, (path, a[:70], s.count(a))
    open(path, 'w').write(s.replace(a, b))

# ── NOAA: 4년치 일평균을 저장해 두고 평년·지난 해 비교 둘 다 여기서 ──
s = open('api/noaa.js').read()
i0 = s.index('// 평년: CO-OPS 수온 최근 3년')
i1 = s.index('module.exports')
s = s[:i0] + """// 지난 해 비교·평년: CO-OPS 수온 최근 4년(1년씩 4번 요청) → 날짜별 평균. Redis에 7일 저장
// 고장 난 센서가 하루 종일 같은 값(예: 0.0)을 보내는 날은 버려요(하루 최고-최저 차이가 0.05°C 미만)
async function coopsDaily(id) {
  const key = `noaa:wtd:${id}`;
  try { const [{ result }] = await redisPipeline([['GET', key]]); if (result) return JSON.parse(result); } catch (_) {}
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const now = Date.now(), Y = 365 * 86400e3;
  const parts = await Promise.all([0, 1, 2, 3].map(i => getText(
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${id}&product=water_temperature&units=metric&time_zone=lst_ldt&format=json&application=OceanTemp&interval=h&begin_date=${ymd(now - (i + 1) * Y + 86400e3)}&end_date=${ymd(now - i * Y)}`, 25000
  ).then(t => JSON.parse(t)).catch(() => null)));
  const by = {};
  parts.forEach(j => ((j && j.data) || []).forEach(o => { const v = +o.v; if (!Number.isFinite(v) || v < -3 || v > 40) return; const d = String(o.t).slice(0, 10).replace(/-/g, ''); (by[d] = by[d] || []).push(v); }));
  const days = {};
  Object.entries(by).forEach(([d, a]) => {
    if (a.length >= 6 && Math.max(...a) - Math.min(...a) < 0.05) return; // 멈춘 센서
    days[d] = +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
  });
  const body = { days };
  if (Object.keys(days).length > 60) { try { await redisPipeline([['SET', key, JSON.stringify(body), 'EX', String(7 * 86400)]]); } catch (_) {} }
  return body;
}
async function coopsClim(id) {
  const { days } = await coopsDaily(id);
  const byMonth = Array.from({ length: 12 }, () => []);
  Object.entries(days).forEach(([d, v]) => byMonth[+d.slice(4, 6) - 1].push(v));
  const months = byMonth.map(a => a.length >= 10 ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
  const nDays = Object.keys(days).length;
  return { months, nDays, years: +(nDays / 365).toFixed(1) };
}

""" + s[i1:]
s = s.replace("""    return res.status(400).json({ ok: false, error: 'svc는 stations | ndbc | wtclim' });""",
"""    if (req.query.svc === 'wtyears') {
      const id = String(req.query.id || '');
      if (!/^\\d{7}$/.test(id)) return res.status(400).json({ ok: false, error: 'id(7자리) 필요' });
      const body = await coopsDaily(id);
      return send({ ok: true, id, ms: Date.now() - t0, days: body.days }, 43200);
    }
    return res.status(400).json({ ok: false, error: 'svc는 stations | ndbc | wtclim | wtyears' });""")
open('api/noaa.js', 'w').write(s)

# ── KHOA: 저장된 3년치 일평균 그대로 ──
rep('api/khoa.js', """    if (svcName === 'wtclim') {""",
"""    if (svcName === 'wtyears') {
      // 지난 해 같은 날짜 비교용: Redis에 쌓인 일평균(최대 3년) 그대로
      const days = {};
      try { const [{ result }] = await redisPipeline([['HGETALL', `khoa:wtd:${obs}`]]); if (Array.isArray(result)) for (let i = 0; i < result.length; i += 2) if (result[i + 1] !== 'na') days[result[i]] = +result[i + 1]; } catch (_) {}
      return sendJson({ ok: true, obs, days }, 43200);
    }
    if (svcName === 'wtclim') {""")

# ── KMA: 정오 수온 ──
rep('api/kma.js', """    if (svc === 'clim') {""",
"""    if (svc === 'years') {
      const days = await stationNoon(stn);
      return send({ ok: true, stn, days }, 43200);
    }
    if (svc === 'clim') {""")

# ── Copernicus ──
rep('api/cmems.js', """    if (svc === 'backfill') {
      const months = Math.max(1, Math.min(40, parseInt(req.query.months, 10) || 36));""",
"""    if (svc === 'wtyears') {
      const stored = await hgetall(`cmems:wtd:${id}`);
      const days = {};
      Object.entries(stored).forEach(([d, v]) => { if (/^\\d{8}$/.test(d) && v !== 'na') days[d] = +v; });
      return send({ ok: true, id, days }, 43200);
    }
    if (svc === 'backfill') {
      const months = Math.max(1, Math.min(44, parseInt(req.query.months, 10) || 41));""")
# 3년 전 같은 날짜가 그래프 왼쪽 끝(5개월 전)까지 닿게 41개월
rep('scripts/warm-visibility.mjs', "svc=backfill&${q}&months=36&maxFetch=18", "svc=backfill&${q}&months=41&maxFetch=20")
print('server ok')
