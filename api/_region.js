// [ADD] 지역 페이지: /ko|en|ja/r/<지역> - 한 도시·섬 주변 포인트들의 오늘 수온을 한 표로. "샌프란시스코 수온 어때?" 같은 질문에 검색엔진·AI가 바로 쓸 수 있게
//  지역 이름은 포인트 이름의 괄호 안 첫 토큰("Ocean Beach (San Francisco)" → San Francisco, "Moalboal (Cebu, Philippines)" → Cebu)이나
//  한글 이름의 첫 단어("제주 섶섬" → 제주)에서 뽑고, 괄호가 없는 포인트는 40km 안의 가장 가까운 지역에 붙여요. 자료는 저장된 값만 써요(추가 외부 요청 없음)
const H = require('./_spotpage').helpers;
const S = require('./_store');
const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const slugOf = (n) => String(n || '').toLowerCase().normalize('NFC').replace(/[()'".,·]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50);
const STOP = /^(philippines|korea|south korea|japan|usa|united states|indonesia|thailand|malaysia|mexico|australia|taiwan|vietnam|egypt|maldives|spain|italy|france|portugal|greece|croatia|turkey|hawaii)$/i;

function regionKeyOf(st) { // 포인트 이름에서 지역 이름(원문) 뽑기 - 없으면 null
  const n = String(st.name || '');
  const m = n.match(/\(([^)]+)\)/);
  if (m) { const ctry = String(st.country || '').toLowerCase(); const toks = m[1].split(',').map(x => x.trim().replace(/\s*\d+$/, '')).filter(Boolean); const t = toks.find(x => !STOP.test(x) && x.toLowerCase() !== ctry); if (t && t.length >= 2) return t; return null; } // 괄호가 나라 이름뿐이면 지역 없음. 끝의 숫자(Saavedra2)는 떼요
  if (/[가-힣]/.test(n)) { const w = n.split(/\s+/)[0]; if (w && w.length >= 2 && !/^[\d]/.test(w)) return w; }
  return null;
}
function buildRegions(all) { // → [{ key, slug, name, cc, lat, lon, spots: [...] }]
  const by = new Map();
  const tagged = all.map(s => ({ s, key: regionKeyOf(s) }));
  tagged.filter(x => x.key).forEach(({ s, key }) => { const k = `${s.cc || 'xx'}|${key.toLowerCase()}`; if (!by.has(k)) by.set(k, { key, cc: s.cc || '', spots: [] }); by.get(k).spots.push(s); });
  // 괄호 없는 포인트 → 40km 안 가장 가까운 지역(같은 나라)
  tagged.filter(x => !x.key).forEach(({ s }) => { let best = null, bd = 40;
    by.forEach(r => { if (r.cc !== (s.cc || '')) return; r.spots.forEach(o => { const d = km(s.lat, s.lon, o.lat, o.lon); if (d < bd) { bd = d; best = r; } }); });
    if (best) best.spots.push(s); });
  // [ADD] 가까운 지역끼리 합치기: 작은 지역의 중심이 큰 지역의 어느 포인트와 20km 안이면 큰 쪽으로(SF ↔ San Francisco, 문섬·섶섬·범섬 → 제주 같은 경우)
  let list = [...by.values()].map(r => ({ ...r, lat: r.spots.reduce((a, s) => a + s.lat, 0) / r.spots.length, lon: r.spots.reduce((a, s) => a + s.lon, 0) / r.spots.length })).sort((a, b) => b.spots.length - a.spots.length);
  for (let i = list.length - 1; i > 0; i--) { const sm = list[i]; const big = list.slice(0, i).find(b => b.cc === sm.cc && b.spots.some(o => km(sm.lat, sm.lon, o.lat, o.lon) <= 20));
    if (big) { big.spots.push(...sm.spots); list.splice(i, 1); } }
  const out = [];
  list.forEach(r => { if (r.spots.length < 2) return; // 포인트 2곳 이상인 지역만
    const lat = r.spots.reduce((a, s) => a + s.lat, 0) / r.spots.length, lon = r.spots.reduce((a, s) => a + s.lon, 0) / r.spots.length;
    out.push({ key: r.key, slug: slugOf(r.key) || 'r', cc: r.cc, lat: +lat.toFixed(4), lon: +lon.toFixed(4), spots: r.spots.sort((a, b) => a.no - b.no) }); });
  // 같은 slug 가 다른 나라에 있으면 나라 코드를 붙여요
  const cnt = {}; out.forEach(r => { cnt[r.slug] = (cnt[r.slug] || 0) + 1; }); out.forEach(r => { if (cnt[r.slug] > 1) r.slug = `${r.slug}-${(r.cc || 'xx').toLowerCase()}`; });
  return out.sort((a, b) => b.spots.length - a.spots.length);
}
const RT = {
  ko: { title: (n, t) => `${n} 수온·시야·파도 오늘${t ? ` – 평균 ${t}°C` : ''} | otemp`, h1: (n) => `${n} 오늘 바다 수온`, desc: (n, k) => `${n} 주변 다이빙·해변 포인트 ${k}곳의 오늘 바다 수온, 시야, 파도를 한 표로.`,
    sum: (n, d, lo, hi, k, w, wt, src) => `${d} 기준 ${n} 주변 바다 수온은 ${lo === hi ? `${lo}°C` : `${lo}~${hi}°C`}예요 (포인트 ${k}곳${w ? `, 가장 따뜻한 곳 ${w} ${wt}°C` : ''}). ${src}`,
    srcObs: '근처 관측소 실측값이 있는 포인트는 실측, 나머지는 위성·예보 모델값이에요.', cols: ['포인트', '수온', '시야', '파고', '출처'], obs: '실측', model: '모델', none: '아직 자료가 없어요. 포인트를 한 번 열면 채워져요.',
    all: '모든 지역', idxTitle: '지역별 오늘 바다 수온 | otemp', idxH1: '지역별 오늘 바다 수온', idxDesc: '도시·섬 단위로 묶은 다이빙·해변 포인트의 오늘 수온.', upd: (s) => `${s} 업데이트`, nspots: (k) => `포인트 ${k}곳` },
  en: { title: (n, t) => `${n} sea temperature today${t ? ` – avg ${t}°C` : ''} | otemp`, h1: (n) => `${n} sea temperature today`, desc: (n, k) => `Today's sea temperature, visibility and waves at ${k} dive and beach spots around ${n}, in one table.`,
    sum: (n, d, lo, hi, k, w, wt, src) => `As of ${d}, the sea temperature around ${n} is ${lo === hi ? `${lo}°C` : `${lo}–${hi}°C`} across ${k} spots${w ? ` (warmest: ${w}, ${wt}°C)` : ''}. ${src}`,
    srcObs: 'Spots with a nearby station show measured values; the rest are satellite/model estimates.', cols: ['Spot', 'Water', 'Vis', 'Waves', 'Source'], obs: 'measured', model: 'model', none: 'No data cached yet. Open a spot once and it fills in.',
    all: 'All regions', idxTitle: 'Sea temperature today by region | otemp', idxH1: 'Sea temperature today by region', idxDesc: 'Dive and beach spots grouped by city or island, with today\'s water temperature.', upd: (s) => `Updated ${s}`, nspots: (k) => `${k} spots` },
  ja: { title: (n, t) => `${n} 今日の海水温${t ? ` – 平均 ${t}°C` : ''} | otemp`, h1: (n) => `${n} 今日の海水温`, desc: (n, k) => `${n}周辺のダイビング・ビーチポイント${k}か所の今日の水温・透明度・波を一覧で。`,
    sum: (n, d, lo, hi, k, w, wt, src) => `${d}時点の${n}周辺の海水温は${lo === hi ? `${lo}°C` : `${lo}〜${hi}°C`}です（${k}か所${w ? `、最も暖かいのは${w} ${wt}°C` : ''}）。${src}`,
    srcObs: '近くに観測所があるポイントは実測値、その他は衛星・予報モデルの推定値です。', cols: ['ポイント', '水温', '透明度', '波高', '出典'], obs: '実測', model: 'モデル', none: 'まだデータがありません。ポイントを一度開くと表示されます。',
    all: 'すべての地域', idxTitle: '地域別 今日の海水温 | otemp', idxH1: '地域別 今日の海水温', idxDesc: '都市・島ごとにまとめたポイントの今日の水温。', upd: (s) => `${s} 更新`, nspots: (k) => `${k}か所` },
  es: { title: (n, t) => `Temperatura del mar hoy en ${n}${t ? ` – media ${t}°C` : ''} | otemp`, h1: (n) => `Temperatura del mar hoy en ${n}`, desc: (n, k) => `Temperatura del agua, visibilidad y olas de hoy en ${k} puntos de buceo y playas de ${n}, en una tabla.`,
    sum: (n, d, lo, hi, k, w, wt, src) => `A fecha de ${d}, la temperatura del mar en ${n} es de ${lo === hi ? `${lo}°C` : `${lo}–${hi}°C`} en ${k} puntos${w ? ` (el más cálido: ${w}, ${wt}°C)` : ''}. ${src}`,
    srcObs: 'Los puntos con estación cercana muestran valores medidos; el resto son estimaciones de satélite y modelo.', cols: ['Punto', 'Agua', 'Vis', 'Olas', 'Fuente'], obs: 'medido', model: 'modelo', none: 'Aún no hay datos en caché. Abre un punto y se completará.',
    all: 'Todas las regiones', idxTitle: 'Temperatura del mar hoy por región | otemp', idxH1: 'Temperatura del mar hoy por región', idxDesc: 'Puntos de buceo y playas agrupados por ciudad o isla, con la temperatura del agua de hoy.', upd: (s) => `Actualizado ${s}`, nspots: (k) => `${k} puntos` },
  zh: { title: (n, t) => `${n} 今日海水溫度${t ? ` – 平均 ${t}°C` : ''} | otemp`, h1: (n) => `${n} 今日海水溫度`, desc: (n, k) => `${n}周邊 ${k} 個潛點與海灘的今日水溫、能見度與浪高一覽。`,
    sum: (n, d, lo, hi, k, w, wt, src) => `截至 ${d}，${n}周邊的海水溫度為 ${lo === hi ? `${lo}°C` : `${lo}–${hi}°C`}（${k} 個潛點${w ? `，最暖為 ${w} ${wt}°C` : ''}）。${src}`,
    srcObs: '附近有測站的潛點為實測值，其餘為衛星與模式估計。', cols: ['潛點', '水溫', '能見度', '浪高', '來源'], obs: '實測', model: '模式', none: '尚無快取資料。開啟任一潛點後即會補上。',
    all: '所有地區', idxTitle: '各地區今日海水溫度 | otemp', idxH1: '各地區今日海水溫度', idxDesc: '依城市或島嶼分組的潛點與今日水溫。', upd: (s) => `${s} 更新`, nspots: (k) => `${k} 個潛點` }
};
const rpath = (lang, r) => `/${lang}/r/${encodeURIComponent(r.slug)}`;

async function regionPage(req, res, lang, all, base, slug) {
  const t = RT[lang], T = H.T[lang];
  const regions = buildRegions(all);
  let r = regions.find(x => x.slug === String(slug || '').toLowerCase());
  if (!r) { // [ADD] 지역 이름이 없으면(예: cebu) 그 단어가 이름에 들어간 포인트가 가장 많은 지역으로 보내요
    const w = decodeURIComponent(String(slug || '')).toLowerCase().replace(/-/g, ' ');
    const hit = w.length >= 3 ? regions.map(x => ({ x, n: x.spots.filter(s => `${s.name} ${Object.values(s.names || {}).join(' ')}`.toLowerCase().includes(w)).length })).filter(o => o.n).sort((a, b) => b.n - a.n)[0] : null;
    if (hit) { res.setHeader('Location', rpath(lang, hit.x)); res.setHeader('Cache-Control', 'public, s-maxage=3600'); return res.status(302).end(); }
  }
  if (!r) { res.setHeader('Cache-Control', 'no-store'); return H.sendHtml(res, 404, H.page({ lang, title: `${T.notFound} | otemp`, desc: t.idxDesc, canonical: `/${lang}/r/`, body: `${H.header(lang, Object.fromEntries(H.LANGS.map(l => [l, `/${l}/r/`])))}<h1 style="margin-top:20px">${T.notFound}</h1>`, base })); }
  // 저장된 자료만(Redis GET 포인트당 1번, 최대 40곳)
  const spots = r.spots.slice(0, 40);
  const ds = await Promise.all(spots.map(s => H.dataFor(s, all, { quick: true, cacheOnly: true }).catch(() => null)));
  const rows = spots.map((s, i) => { const d = ds[i]; const temp = d ? (d.obs ? H.r1(d.obs.t) : H.r1(d.now && d.now.sst)) : null;
    return { s, temp, vis: d && d.vis && d.vis[d.today] ? d.vis[d.today].v : null, wave: d ? H.r1(d.now && d.now.wave) : null, obs: !!(d && d.obs), at: d ? d.at : 0 }; });
  const have = rows.filter(x => x.temp != null), temps = have.map(x => x.temp);
  const lo = temps.length ? Math.min(...temps) : null, hi = temps.length ? Math.max(...temps) : null, avg = temps.length ? H.r1(temps.reduce((a, b) => a + b, 0) / temps.length) : null;
  const warm = have.length ? have.reduce((a, b) => b.temp > a.temp ? b : a) : null;
  const name = r.key, hrefs = Object.fromEntries(H.LANGS.map(l => [l, rpath(l, r)]));
  const dstr = new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date());
  const summary = have.length ? t.sum(name, dstr, lo, hi, have.length, warm ? H.nameIn(warm.s, lang) : '', warm ? warm.temp : '', t.srcObs) : t.none;
  const table = `<table class="rt"><tr>${t.cols.map(c => `<th>${c}</th>`).join('')}</tr>${rows.map(x => `<tr><td><a href="${H.pathOf(lang, x.s)}">${H.esc(H.nameIn(x.s, lang))}</a></td><td>${x.temp != null ? x.temp + '°C' : '–'}</td><td>${x.vis != null ? H.fmtVis(x.vis) + 'm' : '–'}</td><td>${x.wave != null ? x.wave + 'm' : '–'}</td><td class="m">${x.temp == null ? '' : x.obs ? t.obs : t.model}</td></tr>`).join('')}</table>`;
  const jsonld = [{ '@context': 'https://schema.org', '@type': 'Dataset', name: t.h1(name), description: summary, url: base + hrefs[lang], temporalCoverage: new Date().toISOString().slice(0, 10), spatialCoverage: { '@type': 'Place', geo: { '@type': 'GeoCoordinates', latitude: r.lat, longitude: r.lon } } }];
  const body = `${H.header(lang, hrefs)}<nav class="crumb"><a href="/${lang}/r/">${t.all}</a> › ${H.esc(name)}</nav>
<h1>${H.esc(t.h1(name))}</h1>
<p class="lead">${H.esc(summary)}</p>
${table}
<p class="sub">${t.nspots(rows.length)} · ${t.upd(dstr)}</p>
<div class="cta"><a class="btn" href="/?lat=${r.lat}&lon=${r.lon}&z=11">${T.cta}</a></div>
<div class="foot">${T.foot}<br>© otemp.app · <a href="/">${T.links[0]}</a><a href="/${lang}/s/">${T.links[1]}</a></div>`;
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600'); // 지역 페이지는 10분 캐시(Redis 절약)
  return H.sendHtml(res, 200, H.page({ lang, title: t.title(name, avg), desc: t.desc(name, rows.length), canonical: hrefs[lang], alternates: hrefs, jsonld, body: body + `<style>.rt{width:100%;border-collapse:collapse;font-size:14px;margin:12px 0}.rt th{text-align:left;color:var(--muted);font-weight:600;font-size:12px;padding:6px 6px;border-bottom:1px solid var(--line)}.rt td{padding:8px 6px;border-bottom:1px solid var(--line)}.rt td.m{color:var(--muted);font-size:12px}.lead{font-size:16px;line-height:1.55;margin:8px 0 12px}</style>`, base }));
}
async function regionIndex(req, res, lang, all, base) {
  const t = RT[lang], T = H.T[lang], regions = buildRegions(all);
  const hrefs = Object.fromEntries(H.LANGS.map(l => [l, `/${l}/r/`]));
  const groups = {}; regions.forEach(r => { (groups[r.cc || 'xx'] = groups[r.cc || 'xx'] || []).push(r); });
  const order = Object.keys(groups).sort((a, b) => groups[b].reduce((n, r) => n + r.spots.length, 0) - groups[a].reduce((n, r) => n + r.spots.length, 0));
  const body = `${H.header(lang, hrefs)}<div class="idx"><h1 style="margin-top:16px">${t.idxH1}</h1><p class="sub">${t.idxDesc}</p>
${order.map(cc => `<h2>${H.esc(H.regionName(cc, lang, groups[cc][0].spots[0].country))}</h2><div class="near">${groups[cc].map(r => `<a href="${rpath(lang, r)}">${H.esc(r.key)} <small>${r.spots.length}</small></a>`).join('')}</div>`).join('')}
<div class="foot">© otemp.app · <a href="/">${T.links[0]}</a><a href="/${lang}/s/">${T.links[1]}</a></div></div>`;
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return H.sendHtml(res, 200, H.page({ lang, title: t.idxTitle, desc: t.idxDesc, canonical: hrefs[lang], alternates: hrefs, body, base }));
}
module.exports = { buildRegions, regionPage, regionIndex, rpath };
