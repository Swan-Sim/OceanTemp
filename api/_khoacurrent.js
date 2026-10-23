// [ADD] 국립해양조사원 조류예보(시계열) - 예보지점 약 200곳의 시각별 유향·유속(공식 조화 예보)
//  api/_khoa.js 가 불러 써요. 호출: https://apis.data.go.kr/1192136/crntFcstTime/GetCrntFcstTimeApiService (obsCode·reqDate·min)
//  응답: obsvtrNm 이름, lot 경도, lat 위도, predcDt(또는 obsrvnDt) "YYYY-MM-DD HH:MM"(한국시각), crdir 유향(도 또는 16방위 이름 = 흘러가는 쪽), crsp 유속(cm/s)
//  예보는 조화상수로 계산한 값이라 날짜가 정해지면 안 변해요 → 날짜별로 Redis에 30일 저장(국립해양조사원 점검 때도 서비스 유지)
const { redisPipeline } = require('./_redis');
const CODES = [
  '01MP-2', '01SR-1', '02JJ-1', '03DS-1', '03PT-1', '05GH-5', '06GH01', '06GH07', '06GS07', '06JD01', '06SA01', '06SA10', '06SA18', '06YME1',
  '06YME4', '06YME5', '06YME6', '06YME8', '06YS03', '06YS04', '06YS09', '07DS02', '07GG03', '07GG06', '07GG11', '07JB12', '07JB14', '07KS01',
  '07KS03', '07TA03', '07TA04', '07TA05', '07TA09', '08F', '08GA01', '08GY-5', '08JJ03', '08JJ07', '08JJ13', '09IC01', '09IC07', '10ED01', '10GD03',
  '10MP07', '11JD02', '11JD09', '12JB11', '12JB14', '12YS08', '13PT01', '13WD01', '14BP01', '14IC03', '14IC04', '14JD03', '15HD05', '15LTC01',
  '15LTC02', '15LTC03', '15LTC04', '15LTC05', '15LTC06', '15LTC07', '15LTC08', '15LTC09', '15LTC10', '15SE01', '16DJ04', '16LTC01', '16LTC02',
  '16LTC03', '16LTC04', '16LTC05', '16LTC06', '16LTC07', '16LTC08', '16LTC09', '16LTC10', '16LTC11', '16LTC12', '16LTC13', '16LTC14', '16MTC01',
  '16MTC16', '17LTC01', '17LTC02', '17LTC03', '17LTC04', '17LTC05', '17LTC06', '17LTC07', '17LTC08', '17LTC09', '17LTC10', '17LTC11', '17LTC12',
  '17LTC13', '17LTC14', '17MTC14', '17MTC19', '17MTC20', '18LTC01', '18LTC02', '18LTC03', '18LTC04', '18LTC05', '18LTC06', '18LTC07', '18LTC08',
  '18LTC09', '18LTC10', '18LTC11', '18LTC12', '18LTC13', '18LTC14', '18MTC10', '19LTC01', '19LTC02', '19LTC03', '19LTC04', '19LTC05', '19LTC06',
  '19LTC07', '19LTC08', '19LTC09', '19LTC10', '19LTC11', '19LTC12', '19LTC13', '19LTC14', '20LTC01', '20LTC02', '20LTC03', '20LTC04', '20LTC05',
  '20LTC06', '20LTC07', '20LTC08', '20LTC09', '20LTC11', '20LTC12', '20LTC13', '20LTC14', '20LTC15', '21LTC01', '21LTC02', '21LTC03', '21LTC04',
  '21LTC05', '21LTC06', '21LTC07', '21LTC08', '21LTC09', '21LTC10', '21LTC11', '21LTC12', '21LTC13', '21LTC14', '22EW01', '22LTC01', '22LTC02',
  '22LTC03', '22LTC04', '22LTC05', '22LTC06', '22LTC07', '22LTC08', '22LTC09', '22LTC10', '22LTC12', '22LTC13', '22LTC14', '22LTC15', '22MTC03',
  '23GA01', '23LTC01', '23LTC02', '23LTC03', '23LTC04', '23LTC05', '23LTC06', '23LTC07', '23LTC08', '23LTC09', '23YG03', '24GW02', '24LTC01',
  '24LTC02', '24LTC03', '24LTC04', '24LTC05', '24LTC06', '24LTC07', '24LTC08', '24LTC09', '24LTC10', '24LTC11', '24TJ02', '24TJ04', '24TJ05',
  '98HG-1', 'Gwangyanghang', 'JejuStrait', 'MyeongYang_Sudo'
];
const P16 = { '북': 0, '북북동': 22.5, '북동': 45, '동북동': 67.5, '동': 90, '동남동': 112.5, '남동': 135, '남남동': 157.5, '남': 180, '남남서': 202.5, '남서': 225, '서남서': 247.5, '서': 270, '서북서': 292.5, '북서': 315, '북북서': 337.5 };
const dirDeg = (v) => { if (v == null || v === '') return null; const n = Number(v); if (Number.isFinite(n)) return ((n % 360) + 360) % 360; const k = String(v).trim(); return k in P16 ? P16[k] : null; };
const ymdK = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ''); // 한국 날짜
const hav = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };

async function call(key, code, date, min, rows) {
  const url = `https://apis.data.go.kr/1192136/crntFcstTime/GetCrntFcstTimeApiService?serviceKey=${encodeURIComponent(key)}&type=json&obsCode=${encodeURIComponent(code)}&reqDate=${date}&min=${min}&pageNo=1&numOfRows=${rows}`;
  const c = new AbortController(), t = setTimeout(() => c.abort(), 9000);
  try {
    const r = await fetch(url, { signal: c.signal }); const text = await r.text(); let j; try { j = JSON.parse(text); } catch (_) { throw new Error(`HTTP ${r.status} ${text.slice(0, 100)}`); }
    const h = j.header || (j.response && j.response.header) || {}, b = j.body || (j.response && j.response.body) || {};
    if (h.resultCode === '03' || h.resultCode === '3') return [];
    if (h.resultCode && h.resultCode !== '00' && h.resultCode !== '0') throw new Error(`KHOA ${h.resultCode} ${h.resultMsg || ''}`);
    const raw = (b.items && b.items.item) || b.items || []; return Array.isArray(raw) ? raw : [raw];
  } finally { clearTimeout(t); }
}

// 예보지점 좌표표: Redis 해시 khoa:crst (코드 → "이름|위도|경도", 실패한 코드는 "x"). 요청이 올 때마다 빠진 코드를 한 번에 25개씩 채워요
async function stations(key) {
  const H = 'khoa:crst'; let got = {};
  try { const [{ result }] = await redisPipeline([['HGETALL', H]]); if (Array.isArray(result)) for (let i = 0; i < result.length; i += 2) got[result[i]] = result[i + 1]; } catch (_) {}
  const missing = CODES.filter(c => !(c in got)).slice(0, 25);
  if (missing.length) {
    const today = ymdK(Date.now()), cmds = [];
    await Promise.all(missing.map(async (c) => { try { const it = await call(key, c, today, 60, 1); const a = it[0]; if (a && Number.isFinite(+a.lat) && Number.isFinite(+a.lot)) { got[c] = `${a.obsvtrNm || c}|${(+a.lat).toFixed(5)}|${(+a.lot).toFixed(5)}`; cmds.push(c, got[c]); } else if (it.length === 0) { got[c] = 'x'; cmds.push(c, 'x'); } } catch (_) { /* 서버 지연이면 다음에 다시 */ } }));
    if (cmds.length) { try { await redisPipeline([['HSET', H, ...cmds], ['EXPIRE', H, String(90 * 86400)]]); } catch (_) {} }
  }
  const list = []; let pending = 0;
  CODES.forEach(c => { const v = got[c]; if (v == null) pending++; else if (v !== 'x') { const [n, la, lo] = v.split('|'); list.push({ code: c, name: n, lat: +la, lon: +lo }); } });
  return { list, pending };
}

// 하루치 시각별 예보(30분 간격) - Redis 30일 보관
async function dayRows(key, code, date) {
  const K = `khoa:cf:${code}:${date}`;
  try { const [{ result }] = await redisPipeline([['GET', K]]); if (result) return JSON.parse(result); } catch (_) {}
  const it = await call(key, code, date, 30, 100);
  const rows = it.map(a => { const t = String(a.predcDt || a.obsrvnDt || '').slice(0, 16), to = dirDeg(a.crdir), sp = a.crsp == null || a.crsp === '' ? null : +a.crsp; return t && to != null && Number.isFinite(sp) ? { t, to: Math.round(to), sp: +sp.toFixed(1) } : null; }).filter(Boolean);
  if (rows.length) { try { await redisPipeline([['SET', K, JSON.stringify(rows), 'EX', String(30 * 86400)]]); } catch (_) {} }
  return rows;
}

// 가장 가까운 예보지점 + 어제~모레+N일 예보. maxKm 안에 없으면 near: null
async function near(key, lat, lon, maxKm, days) {
  const { list, pending } = await stations(key);
  if (pending > 10) return { ready: false, pending };
  let best = null, bd = Infinity; list.forEach(s => { const d = hav(lat, lon, s.lat, s.lon); if (d < bd) { bd = d; best = s; } });
  if (!best || bd > maxKm) return { ready: true, near: null, km: best ? +bd.toFixed(1) : null };
  const dates = Array.from({ length: days }, (_, i) => ymdK(Date.now() + (i - 6) * 86400e3)); // 앱이 보여주는 구간(과거 6일 ~ 미래 8일)을 모두
  const parts = await Promise.all(dates.map(d => dayRows(key, best.code, d).catch(() => [])));
  return { ready: true, near: { code: best.code, name: best.name, lat: best.lat, lon: best.lon, km: +bd.toFixed(1) }, rows: parts.flat() };
}
module.exports = { near, stations, dayRows, CODES };
