// [ADD] 부산광역시 해양환경 측정(망) - 사람이 직접 잰 투명도(세키 원판, m). 위성 시야 추정과 비교하는 "실측 참고값".
//   /api/busanwq → { sites: [{ name, lat, lon, q:[1~4분기 평균], n, from, to }] }
// 분기마다 1번 재는 자료(2005~2023년, 이후 갱신 없음)라 날마다 쓰지 않고 정점별 "계절 평균"으로 씁니다.
// 응답에 좌표가 없어서 지점 이름으로 대략 위치를 정해 두었어요(표시할 때도 "대략 위치"라고 알려요).
// 인증키는 공공데이터포털 공통 키(KHOA_API_KEY와 같은 키)를 씁니다.
const { redisPipeline } = require('./_redis');

const URL_ = 'https://apis.data.go.kr/6260000/BusanMrnEnvrnInfoService/getMrnEnvrnInfo';
const KEY = 'busanwq:v1';
// 지점 이름 → 대략 위치 [위도, 경도]
const COORDS = {
  '광안리해수욕장': [35.153, 129.119], '남외항': [35.060, 129.035], '남천만': [35.140, 129.112], '남항': [35.090, 129.035],
  '녹산': [35.075, 128.850], '다대포어시장': [35.052, 128.975], '다대포항': [35.058, 128.982], '다대포해수욕장': [35.045, 128.966],
  '대변': [35.226, 129.231], '동천하류': [35.128, 129.062], '민락동': [35.155, 129.133], '발전소앞': [35.078, 129.003],
  '부산대교': [35.098, 129.040], '북내항': [35.110, 129.045], '북외항': [35.095, 129.065], '송도해수욕장': [35.074, 129.018],
  '수영만': [35.160, 129.140], '신외항': [35.040, 128.850], '신항': [35.075, 128.810], '신호': [35.080, 128.880],
  '이기대': [35.118, 129.128], '일광': [35.259, 129.236], '자갈치시장': [35.096, 129.030], '장림': [35.075, 128.960],
  '해운대': [35.150, 129.175], '해운대해수욕장': [35.158, 129.160], '5부두': [35.110, 129.050], '감천항': [35.080, 129.010],
  '가덕대교': [35.054, 128.835], '고리': [35.318, 129.300]
};

async function getJSON(url, ms) {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms || 15000);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}

async function build(key) {
  const items = [];
  for (let p = 1; p <= 6; p++) {
    const j = await getJSON(`${URL_}?serviceKey=${encodeURIComponent(key)}&pageNo=${p}&numOfRows=500&resultType=json`);
    const body = j && j.response && j.response.body;
    const it = (body && body.items && body.items.item) || [];
    items.push(...(Array.isArray(it) ? it : [it]));
    if (items.length >= +(body && body.totalCount || 0) || !it.length) break;
  }
  const by = {};
  items.forEach(r => {
    const v = parseFloat(String(r.water07 || '').replace(/,/g, ''));
    const y = +r.inspecYy, q = +r.inspecQt;
    if (!(v > 0 && v < 40) || !(q >= 1 && q <= 4) || y < 2015) return; // 최근(2015년~) 자료로 계절 평균
    const s = (by[r.site] = by[r.site] || { q: [[], [], [], []], from: y, to: y });
    s.q[q - 1].push(v); s.from = Math.min(s.from, y); s.to = Math.max(s.to, y);
  });
  const sites = Object.entries(by).filter(([name]) => COORDS[name]).map(([name, s]) => ({
    name, lat: COORDS[name][0], lon: COORDS[name][1],
    q: s.q.map(a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null),
    n: s.q.reduce((a, b) => a + b.length, 0), from: s.from, to: s.to
  }));
  return { sites, count: items.length };
}

module.exports = async function handler(req, res) {
  const send = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).send(body);
  };
  let saved = null;
  try { const [{ result }] = await redisPipeline([['GET', KEY]]); if (result) saved = JSON.parse(result); } catch (_) {}
  if (saved && Date.now() - saved.savedAt < 30 * 86400e3) return send(saved.body);
  const key = process.env.KHOA_API_KEY;
  try {
    if (!key) throw new Error('KHOA_API_KEY 환경변수가 없어요');
    const r = await build(key);
    const body = JSON.stringify({ ok: true, source: '부산광역시 해양환경 측정(망) 정보 (공공데이터포털)', ...r });
    if (r.sites.length >= 10) { try { await redisPipeline([['SET', KEY, JSON.stringify({ savedAt: Date.now(), body }), 'EX', String(90 * 86400)]]); } catch (_) {} }
    return send(body);
  } catch (e) {
    if (saved) return send(saved.body);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ ok: false, error: String(e && e.message || e) });
  }
};
