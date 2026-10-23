// [ADD] 한국 연안 정점: 국립해양조사원 "조류예보(시계열)" 공식 예보로 흐름(방향·세기)을 바꿔요.
//  - 가장 가까운 예보지점(200여 곳)이 10km 안에 있을 때만. 서버: /api/khoa?svc=crnear (예보는 안 변해서 CDN 12시간 + Redis 30일)
//  - 우선순위: 관리자가 정점마다 입력한 "포인트 보정"(curfix) > 국립해양조사원 조류예보 > 해협 일반 보정(strait-tide) > 모델
//  - 예보는 조화상수로 계산한 "조류"만이라 바람·해류 성분은 없어요(그래서 가까운 지점에서만 써요)
//  - 시각: 예보는 한국시각, 정점 자료(d.current)의 x도 현지시각을 UTC처럼 쓴 값 → 한국 정점(+9h)에서는 그대로 맞아요
(function () {
  const MAXKM = 10, IN_KOREA = (lat, lon) => lat >= 32.5 && lat <= 39 && lon >= 124 && lon <= 132.5;
  const orig = window.straitTideApply;
  window.straitTideApply = async function (st, d) {
    if (d && !d._strait) d._khoa = null; // 보정을 다시 계산하는 중(관리자 수정 등)이면 처음부터
    let ch = false;
    if (typeof orig === 'function') { try { ch = !!(await orig.apply(this, arguments)); } catch (_) {} }
    try { if (await khoaApply(st, d)) ch = true; } catch (e) { console.warn('[khoa-current]', e); }
    return ch;
  };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  async function fetchNear(lat, lon) {
    for (let i = 0; i < 12; i++) { // 처음 한 번은 예보지점 좌표표를 채우느라 몇 번 걸려요(그 뒤론 바로)
      const j = await fetch(`/api/khoa?svc=crnear&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&maxKm=${MAXKM}`).then(r => r.json()).catch(() => null);
      if (j && j.ok && j.ready) return j; if (!j || !j.ok) return null; await wait(1200);
    }
    return null;
  }
  async function khoaApply(st, d) {
    if (!st || !st.coords || !d || !Array.isArray(d.current) || !d.current.length || d._khoa || d._khoaNone) return false;
    if (typeof d._strait === 'string' && d._strait.indexOf('spot') === 0) return false; // 포인트 보정이 있으면 그게 우선
    const lon = st.coords[0], lat = st.coords[1]; if (!IN_KOREA(lat, lon) || Math.round((d.nowLocalMs - Date.now()) / 3600e3) !== 9) return false;
    const j = await fetchNear(lat, lon);
    if (!j || !j.near || !j.rows || j.rows.length < 4) { d._khoaNone = true; return false; }
    const r = Math.PI / 180, pts = j.rows.map(a => ({ x: Date.parse(String(a.t).replace(' ', 'T') + ':00Z'), u: a.sp / 100 * Math.sin(a.to * r), v: a.sp / 100 * Math.cos(a.to * r) })).filter(p => Number.isFinite(p.x)).sort((a, b) => a.x - b.x);
    let k = 0;
    const at = (x) => { // 두 예보 사이를 벡터로 이어 붙여요(방향이 돌아도 자연스럽게)
      if (x < pts[0].x - 2700e3 || x > pts[pts.length - 1].x + 2700e3) return null;
      while (k > 0 && pts[k].x > x) k--; while (k < pts.length - 2 && pts[k + 1].x <= x) k++;
      const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)], f = b.x === a.x ? 0 : Math.max(0, Math.min(1, (x - a.x) / (b.x - a.x))), u = a.u + (b.u - a.u) * f, v = a.v + (b.v - a.v) * f;
      return { speed: Math.hypot(u, v), to: (Math.atan2(u, v) / r + 360) % 360 };
    };
    if (!d._rawCurrent) d._rawCurrent = d.current.map(c => Object.assign({}, c));
    const cur = d.current.slice().sort((a, b) => a.x - b.x); let n = 0;
    d.current = cur.map(c => { const q = at(c.x); if (!q) return c; n++; return Object.assign({}, c, { bg: { speed: c.speed, to: c.to }, speed: +q.speed.toFixed(3), to: Math.round(q.to), khoa: true }); });
    if (!n) { d._khoaNone = true; d.current = d._rawCurrent.map(c => Object.assign({}, c)); return false; }
    d._khoa = { name: j.near.name, code: j.near.code, km: j.near.km }; if (!d._strait) d._strait = 'khoa';
    try { if (typeof windDialUpdate === 'function') windDialUpdate(); } catch (_) {}
    return true;
  }
})();
