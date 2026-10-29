// [ADD] 태풍 상세 페이지: /ko|en|ja|es|zh/t/<연도-이름> (예: /ko/t/2026-in-fa) + 목록 /ko/t/
//  기상청 사이트에 없는 것을 앞세워요: ① 여러 기관(한국·일본 기상청, 미국 JTWC·NHC) 예보 경로를 한 지도·한 표에서 비교
//  ② 이 태풍이 지나가는 길 근처의 다이빙·서핑 포인트 목록(가장 가까운 시각·거리) ③ 포인트별 "언제 다시 들어갈 수 있나"(파도 예보)
//  자료는 /api/storms 가 30분마다 모아 둔 것(storms:v1)과 기록(st:arc:<slug>)만 써요. 페이지는 CDN 10분 캐시.
const H = require('./_spotpage').helpers;
const S = require('./_store');
const { redisPipeline } = require('./_redis');
const LANGS = H.LANGS, esc = H.esc;
const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const AG = { jma: { c: '#ffd27a', n: { ko: '일본 기상청', en: 'JMA (Japan)', ja: '気象庁', es: 'JMA (Japón)', zh: '日本氣象廳' } }, kma: { c: '#7dd3fc', n: { ko: '한국 기상청', en: 'KMA (Korea)', ja: '韓国気象庁', es: 'KMA (Corea)', zh: '韓國氣象廳' } },
  jtwc: { c: '#c4b5fd', n: { ko: '미국 JTWC', en: 'JTWC (US Navy)', ja: '米JTWC', es: 'JTWC (EE. UU.)', zh: '美國 JTWC' } }, nhc: { c: '#fdba74', n: { ko: '미국 허리케인센터', en: 'NHC (US)', ja: '米ハリケーンセンター', es: 'NHC (EE. UU.)', zh: '美國颶風中心' } }, cwa: { c: '#86efac', n: { ko: '대만 기상서', en: 'CWA (Taiwan)', ja: '台湾中央気象署', es: 'CWA (Taiwán)', zh: '中央氣象署' } }, gdacs: { c: '#94a3b8', n: { ko: 'GDACS', en: 'GDACS', ja: 'GDACS', es: 'GDACS', zh: 'GDACS' } },
  avg: { c: '#ffffff', n: { ko: 'otemp 평균', en: 'otemp consensus', ja: 'otemp平均', es: 'promedio otemp', zh: 'otemp 平均' } } };
const T = {
  ko: { list: '태풍·허리케인', crumb: '태풍 목록', h1: (n) => `${n} 예상 경로 · 기관별 비교`, listH1: '지금 활동 중인 태풍·허리케인', listDesc: '한국·일본 기상청, 미국 JTWC·NHC 예보 경로를 한 지도에서 비교하고, 영향받는 다이빙·서핑 포인트를 확인하세요.',
    desc: (n, d) => `${n} 현재 위치·예상 경로를 한국 기상청, 일본 기상청, 미국 JTWC 예보로 비교. 영향권에 드는 다이빙·서핑 포인트와 다시 들어갈 수 있는 시기. ${d} 기준.`,
    lead: (n, d, lat, lon, p, w, mv) => `${d} 기준 ${n}은(는) ${lat}, ${lon}에 있어요${p ? `. 중심기압 ${p}hPa` : ''}${w ? `, 최대풍속 ${w}m/s` : ''}${mv ? `, ${mv}` : ''}.`,
    cards: ['중심기압', '최대풍속', '이동', '강풍 반경'], agree: (sp, n) => sp == null ? (n === 1 ? '예보 기관 1곳' : '') : sp <= 150 ? `기관 ${n}곳 예보 일치 (차이 ${sp}km) · 신뢰도 높음` : sp <= 400 ? `기관 ${n}곳 예보 다소 갈림 (최대 차이 ${sp}km)` : `기관 ${n}곳 예보 크게 갈림 (최대 차이 ${sp}km) · 불확실`,
    mapH: '예상 경로 (기관별)', mapNote: '실선: 지나온 길 · 점선: 기관별 예보 경로 · 옅은 원: 예보 오차 범위(70% 확률). 지도를 드래그·확대할 수 있어요.', tableH: '기관별 예보 비교', th: ['예보 시각', '위치', '최대풍속'], none: '예보 경로 없음',
    spotsH: '영향권 포인트', spotsNote: (n) => `예보 경로에서 350km 안에 드는 포인트 ${n}곳. 거리는 가장 가까울 때 기준이에요.`, spotsNone: '예보 경로 350km 안에 등록된 포인트가 없어요.', sth: ['포인트', '가장 가까울 때', '거리', '다시 들어갈 수 있는 때(파도 예보)'],
    back: (d) => `${d}부터 파도 1m 아래`, backNo: '7일 안에는 파도 1m 아래로 안 내려와요', backOut: '예보 범위 밖', backNa: '자료 없음', backCalm: '파도 1m 아래 유지(영향 작음)', nowKm: (k) => `지금 ${k}km`,
    offH: '공식 발표', ended: '공식 예보가 끝났어요(약해졌거나 온대저기압으로 바뀜). 아래는 마지막 자료예요.', noTrack: '이 해역은 아직 예보 기관을 연결하지 못해서 현재 위치만 있어요. 공식 발표를 확인하세요.',
    upd: (s) => `${s} 발표 자료`, foot: '자료: 한국 기상청 · 일본 기상청 · 미국 JTWC·NHC · GDACS · Open-Meteo. 참고용이에요. 태풍 진로는 크게 바뀔 수 있으니 반드시 각 나라 기상청 공식 발표와 현지 안내를 따르세요.',
    past: '지난 태풍', active: '활동 중', peak: (w, p) => `최대 ${w}m/s${p ? ` · 최저 ${p}hPa` : ''}`, listNone: '지금 활동 중인 태풍·허리케인이 없어요.',
    pDelta: (d) => `표준 1013hPa 대비 −${d}hPa`, sstMap: '바탕색 = 바다 수온', sstHot: '← 가장 따뜻한 바다를 지나는 경로(가장 강해질 수 있음)', avgNote: (n) => `흰 선 = otemp 평균: 기관 ${n}곳의 예보를 같은 시각끼리 평균한 값이에요. 공식 예보가 아니며, 원은 기관들이 평균에서 벗어난 최대 거리예요.`, sstH: '바다 수온과 세력 전망', sstWhy: '태풍의 진로는 주로 상층 바람(북태평양 고기압 등)이 정하고, 바다 수온은 세력을 좌우해요. 26.5°C 이상이면 세력을 유지하고, 28°C가 넘는 따뜻한 바다에서는 더 강해지기 쉬워요. 차가운 바다로 들어가면 약해져요.',
    sstNow: (v) => `지금 위치 수온 ${v}°C`, sstDir: '주변 300km 수온(방향별)', sstPath: (n, m, mn) => `${n} 경로: 평균 ${m}°C, 가장 낮은 곳 ${mn}°C`, sstV: { up: '더 강해질 수 있는 바다', keep: '세력 유지', down: '약해지는 바다' }, sstNa: '수온 자료가 아직 없어요', sstSrc: 'NOAA 위성 해수면온도(5km, 약 2일 지연)', dirs: ['북', '북동', '동', '남동', '남', '남서', '서', '북서'], warm: (d, v) => `가장 따뜻한 쪽: ${d} (${v}°C)` },
  en: { list: 'Typhoons & hurricanes', crumb: 'All storms', h1: (n) => `${n} forecast track · agency comparison`, listH1: 'Active typhoons & hurricanes', listDesc: 'Compare JMA, KMA, JTWC and NHC forecast tracks on one map and see which dive and surf spots are in the path.',
    desc: (n, d) => `${n}: current position and forecast track from KMA (Korea), JMA (Japan) and JTWC compared side by side. Dive and surf spots in the path, and when the sea calms down. As of ${d}.`,
    lead: (n, d, lat, lon, p, w, mv) => `As of ${d}, ${n} is at ${lat}, ${lon}${p ? `, central pressure ${p} hPa` : ''}${w ? `, max sustained wind ${w} m/s` : ''}${mv ? `, ${mv}` : ''}.`,
    cards: ['Pressure', 'Max wind', 'Moving', 'Gale radius'], agree: (sp, n) => sp == null ? (n === 1 ? '1 forecast agency' : '') : sp <= 150 ? `${n} agencies agree (spread ${sp} km) · high confidence` : sp <= 400 ? `${n} agencies differ somewhat (max spread ${sp} km)` : `${n} agencies differ a lot (max spread ${sp} km) · uncertain`,
    mapH: 'Forecast tracks by agency', mapNote: 'Solid: past track · dashed: each agency\'s forecast · faint circles: forecast error (70% probability). Drag and zoom the map.', tableH: 'Agency forecast comparison', th: ['Valid time', 'Position', 'Max wind'], none: 'no forecast track',
    spotsH: 'Spots in the path', spotsNote: (n) => `${n} spots within 350 km of a forecast track, at the closest approach.`, spotsNone: 'No listed spots within 350 km of the forecast tracks.', sth: ['Spot', 'Closest approach', 'Distance', 'Sea calms down (wave forecast)'],
    back: (d) => `waves under 1 m from ${d}`, backNo: 'waves stay above 1 m for the next 7 days', backOut: 'beyond forecast range', backNa: 'no data', backCalm: 'waves stay under 1 m (little impact)', nowKm: (k) => `now ${k} km`,
    offH: 'Official advisories', ended: 'Official forecasts have ended (weakened or became extratropical). Below is the last data.', noTrack: 'No forecast agency is connected for this basin yet; only the current position is shown. Check the official advisories.',
    upd: (s) => `Advisory ${s}`, foot: 'Data: KMA · JMA · JTWC · NHC · GDACS · Open-Meteo. For reference only. Storm tracks can change a lot; always follow your national weather service and local guidance.',
    past: 'Past storms', active: 'Active', peak: (w, p) => `peak ${w} m/s${p ? ` · min ${p} hPa` : ''}`, listNone: 'No active typhoons or hurricanes right now.',
    pDelta: (d) => `${d} hPa below standard 1013`, sstMap: 'Background = sea temperature', sstHot: '← crosses the warmest water (most likely to intensify)', avgNote: (n) => `White line = otemp consensus: the ${n} agency forecasts averaged at matching valid times. Not an official forecast; the circle is the largest distance any agency sits from the average.`, sstH: 'Sea temperature & intensity outlook', sstWhy: 'Steering winds aloft (e.g. the subtropical high) decide where a storm goes; sea surface temperature decides how strong it gets. Above 26.5°C a storm holds its strength, above 28°C it can intensify, and over cooler water it weakens.',
    sstNow: (v) => `Water at current position ${v}°C`, sstDir: 'Sea temperature 300 km around (by direction)', sstPath: (n, m, mn) => `${n} track: avg ${m}°C, coolest ${mn}°C`, sstV: { up: 'water warm enough to intensify', keep: 'holds strength', down: 'cooler water, weakening' }, sstNa: 'No sea temperature data yet', sstSrc: 'NOAA satellite SST (5 km, ~2-day lag)', dirs: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], warm: (d, v) => `Warmest side: ${d} (${v}°C)` },
  ja: { list: '台風・ハリケーン', crumb: '台風一覧', h1: (n) => `${n} 予報進路 · 機関別比較`, listH1: '現在活動中の台風・ハリケーン', listDesc: '気象庁・韓国気象庁・米JTWC・NHCの予報進路を一つの地図で比較し、影響を受けるダイビング・サーフポイントを確認。',
    desc: (n, d) => `${n}の現在位置と予報進路を気象庁・韓国気象庁・米JTWCで比較。進路付近のダイビング・サーフポイントと海が落ち着く時期。${d}時点。`,
    lead: (n, d, lat, lon, p, w, mv) => `${d}時点で${n}は${lat}、${lon}にあります${p ? `。中心気圧${p}hPa` : ''}${w ? `、最大風速${w}m/s` : ''}${mv ? `、${mv}` : ''}。`,
    cards: ['中心気圧', '最大風速', '進行', '強風域'], agree: (sp, n) => sp == null ? (n === 1 ? '予報機関1' : '') : sp <= 150 ? `${n}機関の予報が一致（差${sp}km）· 信頼度高` : sp <= 400 ? `${n}機関の予報がやや分かれる（最大差${sp}km）` : `${n}機関の予報が大きく分かれる（最大差${sp}km）· 不確実`,
    mapH: '予報進路（機関別）', mapNote: '実線：経路 · 点線：各機関の予報進路 · 薄い円：予報円（70%）。地図はドラッグ・拡大できます。', tableH: '機関別予報の比較', th: ['予報時刻', '位置', '最大風速'], none: '予報進路なし',
    spotsH: '影響圏のポイント', spotsNote: (n) => `予報進路から350km以内のポイント${n}か所。距離は最接近時。`, spotsNone: '予報進路350km以内に登録ポイントはありません。', sth: ['ポイント', '最接近', '距離', '海が落ち着く時期（波予報）'],
    back: (d) => `${d}から波1m未満`, backNo: '7日以内に波1m未満になりません', backOut: '予報範囲外', backNa: 'データなし', backCalm: '波1m未満のまま（影響小）', nowKm: (k) => `現在${k}km`,
    offH: '公式発表', ended: '公式予報は終了しました（衰弱または温帯低気圧化）。以下は最後のデータです。', noTrack: 'この海域はまだ予報機関を接続していないため現在位置のみです。公式発表を確認してください。',
    upd: (s) => `${s}発表`, foot: 'データ：韓国気象庁・気象庁・米JTWC・NHC・GDACS・Open-Meteo。参考情報です。進路は大きく変わるため、必ず各国気象機関の公式発表と現地の案内に従ってください。',
    past: '過去の台風', active: '活動中', peak: (w, p) => `最大${w}m/s${p ? ` · 最低${p}hPa` : ''}`, listNone: '現在活動中の台風・ハリケーンはありません。',
    pDelta: (d) => `標準1013hPaより−${d}hPa`, sstMap: '背景色 = 海水温', sstHot: '← 最も暖かい海を通る進路（最も発達しやすい）', avgNote: (n) => `白線 = otemp平均：${n}機関の予報を同じ時刻ごとに平均したものです。公式予報ではなく、円は各機関が平均から離れた最大距離です。`, sstH: '海水温と勢力の見通し', sstWhy: '進路は主に上空の風（太平洋高気圧など）が決め、海水温は勢力を左右します。26.5°C以上で勢力を維持、28°C超の海では発達しやすく、冷たい海に入ると衰弱します。',
    sstNow: (v) => `現在位置の水温 ${v}°C`, sstDir: '周囲300kmの海水温（方向別）', sstPath: (n, m, mn) => `${n}進路：平均${m}°C、最低${mn}°C`, sstV: { up: '発達しうる海', keep: '勢力維持', down: '衰弱する海' }, sstNa: '海水温データがまだありません', sstSrc: 'NOAA衛星海面水温（5km、約2日遅れ）', dirs: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'], warm: (d, v) => `最も暖かい側：${d}（${v}°C）` },
  es: { list: 'Tifones y huracanes', crumb: 'Todas las tormentas', h1: (n) => `${n}: trayectoria prevista · comparación de agencias`, listH1: 'Tifones y huracanes activos', listDesc: 'Compara las trayectorias previstas por JMA, KMA, JTWC y NHC en un mapa y mira qué puntos de buceo y surf están en su camino.',
    desc: (n, d) => `${n}: posición actual y trayectoria prevista según KMA (Corea), JMA (Japón) y JTWC, comparadas. Puntos de buceo y surf en su camino y cuándo se calma el mar. A fecha de ${d}.`,
    lead: (n, d, lat, lon, p, w, mv) => `A fecha de ${d}, ${n} está en ${lat}, ${lon}${p ? `, presión central ${p} hPa` : ''}${w ? `, viento máximo ${w} m/s` : ''}${mv ? `, ${mv}` : ''}.`,
    cards: ['Presión', 'Viento máx.', 'Rumbo', 'Radio de temporal'], agree: (sp, n) => sp == null ? (n === 1 ? '1 agencia' : '') : sp <= 150 ? `${n} agencias coinciden (diferencia ${sp} km) · alta confianza` : sp <= 400 ? `${n} agencias difieren algo (máx. ${sp} km)` : `${n} agencias difieren mucho (máx. ${sp} km) · incierto`,
    mapH: 'Trayectorias previstas por agencia', mapNote: 'Línea continua: recorrido · discontinua: pronóstico de cada agencia · círculos tenues: margen de error (70 %). Puedes arrastrar y ampliar el mapa.', tableH: 'Comparación de pronósticos', th: ['Hora válida', 'Posición', 'Viento máx.'], none: 'sin trayectoria',
    spotsH: 'Puntos en su camino', spotsNote: (n) => `${n} puntos a menos de 350 km de una trayectoria prevista, en el momento de máxima aproximación.`, spotsNone: 'No hay puntos registrados a menos de 350 km de las trayectorias.', sth: ['Punto', 'Máx. aproximación', 'Distancia', 'El mar se calma (pronóstico de olas)'],
    back: (d) => `olas por debajo de 1 m desde el ${d}`, backNo: 'las olas siguen por encima de 1 m los próximos 7 días', backOut: 'fuera del rango de pronóstico', backNa: 'sin datos', backCalm: 'olas por debajo de 1 m (poco impacto)', nowKm: (k) => `ahora ${k} km`,
    offH: 'Avisos oficiales', ended: 'Los pronósticos oficiales han terminado (se debilitó o se volvió extratropical). Abajo, los últimos datos.', noTrack: 'Aún no hay agencia de pronóstico conectada para esta cuenca; solo se muestra la posición actual. Consulta los avisos oficiales.',
    upd: (s) => `Aviso ${s}`, foot: 'Datos: KMA · JMA · JTWC · NHC · GDACS · Open-Meteo. Solo como referencia. Las trayectorias cambian mucho; sigue siempre a tu servicio meteorológico nacional y las indicaciones locales.',
    past: 'Tormentas pasadas', active: 'Activo', peak: (w, p) => `máx. ${w} m/s${p ? ` · mín. ${p} hPa` : ''}`, listNone: 'No hay tifones ni huracanes activos ahora.',
    pDelta: (d) => `${d} hPa por debajo de 1013 estándar`, sstMap: 'Fondo = temperatura del mar', sstHot: '← cruza el agua más cálida (más probable que se intensifique)', avgNote: (n) => `Línea blanca = promedio otemp: los pronósticos de ${n} agencias promediados a la misma hora. No es un pronóstico oficial; el círculo es la mayor distancia de una agencia al promedio.`, sstH: 'Temperatura del mar y perspectiva de intensidad', sstWhy: 'Los vientos en altura deciden hacia dónde va la tormenta; la temperatura del mar decide su fuerza. Por encima de 26,5 °C mantiene su fuerza, por encima de 28 °C puede intensificarse y sobre agua más fría se debilita.',
    sstNow: (v) => `Agua en la posición actual ${v} °C`, sstDir: 'Temperatura del mar a 300 km (por dirección)', sstPath: (n, m, mn) => `Trayectoria ${n}: media ${m} °C, mínima ${mn} °C`, sstV: { up: 'agua suficientemente cálida para intensificarse', keep: 'mantiene la fuerza', down: 'agua más fría, se debilita' }, sstNa: 'Aún no hay datos de temperatura del mar', sstSrc: 'SST satelital NOAA (5 km, ~2 días de retraso)', dirs: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], warm: (d, v) => `Lado más cálido: ${d} (${v} °C)` },
  zh: { list: '颱風與颶風', crumb: '所有颱風', h1: (n) => `${n} 預報路徑 · 各機構比較`, listH1: '目前活動中的颱風與颶風', listDesc: '在同一張地圖比較日本氣象廳、韓國氣象廳、美國 JTWC 與 NHC 的預報路徑，並查看受影響的潛點與衝浪點。',
    desc: (n, d) => `${n}目前位置與預報路徑：韓國氣象廳、日本氣象廳、美國 JTWC 並列比較。路徑附近的潛點與衝浪點，以及海況何時恢復。截至 ${d}。`,
    lead: (n, d, lat, lon, p, w, mv) => `截至 ${d}，${n}位於 ${lat}、${lon}${p ? `，中心氣壓 ${p} hPa` : ''}${w ? `，最大風速 ${w} m/s` : ''}${mv ? `，${mv}` : ''}。`,
    cards: ['中心氣壓', '最大風速', '移動', '強風半徑'], agree: (sp, n) => sp == null ? (n === 1 ? '1 個預報機構' : '') : sp <= 150 ? `${n} 個機構預報一致（差異 ${sp} km）· 可信度高` : sp <= 400 ? `${n} 個機構預報略有分歧（最大差異 ${sp} km）` : `${n} 個機構預報分歧很大（最大差異 ${sp} km）· 不確定`,
    mapH: '預報路徑（各機構）', mapNote: '實線：過去路徑 · 虛線：各機構預報 · 淡色圓圈：預報誤差範圍（70%）。可拖曳與縮放地圖。', tableH: '各機構預報比較', th: ['預報時間', '位置', '最大風速'], none: '無預報路徑',
    spotsH: '受影響的潛點', spotsNote: (n) => `距預報路徑 350 km 內的潛點 ${n} 處，距離以最接近時計。`, spotsNone: '預報路徑 350 km 內沒有已登錄的潛點。', sth: ['潛點', '最接近時間', '距離', '海況恢復（浪高預報）'],
    back: (d) => `${d}起浪高低於 1 m`, backNo: '未來 7 天浪高都不會低於 1 m', backOut: '超出預報範圍', backNa: '無資料', backCalm: '浪高維持 1 m 以下（影響小）', nowKm: (k) => `目前 ${k} km`,
    offH: '官方發布', ended: '官方預報已結束（已減弱或轉為溫帶氣旋）。以下為最後資料。', noTrack: '此海域尚未連接預報機構，僅顯示目前位置。請確認官方發布。',
    upd: (s) => `${s} 發布資料`, foot: '資料：韓國氣象廳 · 日本氣象廳 · 美國 JTWC、NHC · GDACS · Open-Meteo。僅供參考。颱風路徑可能大幅改變，請務必遵循各國氣象機構官方發布與當地指引。',
    past: '過去的颱風', active: '活動中', peak: (w, p) => `最大 ${w} m/s${p ? ` · 最低 ${p} hPa` : ''}`, listNone: '目前沒有活動中的颱風或颶風。',
    pDelta: (d) => `較標準 1013 hPa 低 ${d} hPa`, sstMap: '底色 = 海水溫度', sstHot: '← 經過最暖海域的路徑（最可能增強）', avgNote: (n) => `白線 = otemp 平均：${n} 個機構在相同預報時間的平均值。並非官方預報；圓圈為各機構偏離平均的最大距離。`, sstH: '海水溫度與強度展望', sstWhy: '路徑主要由高空引導氣流（如太平洋高壓）決定，海水溫度則左右強度。26.5°C 以上可維持強度，超過 28°C 的暖海容易增強，進入較冷海域則減弱。',
    sstNow: (v) => `目前位置水溫 ${v}°C`, sstDir: '周圍 300 km 海水溫度（依方向）', sstPath: (n, m, mn) => `${n}路徑：平均 ${m}°C，最低 ${mn}°C`, sstV: { up: '海水夠暖，可能增強', keep: '維持強度', down: '海水較冷，減弱' }, sstNa: '尚無海水溫度資料', sstSrc: 'NOAA 衛星海表溫度（5 km，約延遲 2 天）', dirs: ['北', '東北', '東', '東南', '南', '西南', '西', '西北'], warm: (d, v) => `最暖的一側：${d}（${v}°C）` }
};
const FOLD = { ko: ['접기 ▲', '펼치기 ▼'], en: ['Collapse ▲', 'Expand ▼'], ja: ['たたむ ▲', '開く ▼'], es: ['Ocultar ▲', 'Mostrar ▼'], zh: ['收起 ▲', '展開 ▼'] };
const KIND = { TY: { ko: '태풍', en: 'Typhoon', ja: '台風', es: 'Tifón', zh: '颱風' }, STS: { ko: '태풍', en: 'Severe tropical storm', ja: '台風', es: 'Tormenta tropical severa', zh: '強烈熱帶風暴' }, TS: { ko: '열대폭풍', en: 'Tropical storm', ja: '熱帯低気圧', es: 'Tormenta tropical', zh: '熱帶風暴' },
  TD: { ko: '열대저압부', en: 'Tropical depression', ja: '熱帯低気圧', es: 'Depresión tropical', zh: '熱帶性低氣壓' }, LOW: { ko: '온대저기압', en: 'Extratropical low', ja: '温帯低気圧', es: 'Baja extratropical', zh: '溫帶氣旋' }, HU: { ko: '허리케인', en: 'Hurricane', ja: 'ハリケーン', es: 'Huracán', zh: '颶風' }, MH: { ko: '허리케인', en: 'Major hurricane', ja: 'ハリケーン', es: 'Huracán mayor', zh: '強烈颶風' }, PTC: { ko: '열대저기압', en: 'Tropical cyclone', ja: '熱帯低気圧', es: 'Ciclón tropical', zh: '熱帶氣旋' } };
const NUM = { ko: (n) => `${n}호`, en: (n) => `No.${n}`, ja: (n) => `${n}号`, es: (n) => `n.º ${n}`, zh: (n) => `第${n}號` };
const label = (s, lang) => { const k = (KIND[s.cat] || KIND.PTC)[lang]; const nm = lang === 'ko' && s.nameKo ? s.nameKo : lang === 'zh' && s.nameZh ? s.nameZh : s.name; return `${k}${s.num ? ' ' + NUM[lang](s.num) : ''} ${nm}`.trim(); };
const tpath = (lang, slug) => `/${lang}/t/${encodeURIComponent(slug)}`;
const fmtLL = (lat, lon, lang) => { const ns = { ko: ['북위', '남위'], en: ['N', 'S'], ja: ['北緯', '南緯'], es: ['N', 'S'], zh: ['北緯', '南緯'] }[lang], ew = { ko: ['동경', '서경'], en: ['E', 'W'], ja: ['東経', '西経'], es: ['E', 'O'], zh: ['東經', '西經'] }[lang];
  const a = Math.abs(lat).toFixed(1) + '°', b = Math.abs(lon).toFixed(1) + '°'; return lang === 'en' || lang === 'es' ? [a + (lat < 0 ? ns[1] : ns[0]), b + (lon < 0 ? ew[1] : ew[0])] : [(lat < 0 ? ns[1] : ns[0]) + ' ' + a, (lon < 0 ? ew[1] : ew[0]) + ' ' + b]; };
const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const DIR_KO = { N: '북', NNE: '북북동', NE: '북동', ENE: '동북동', E: '동', ESE: '동남동', SE: '남동', SSE: '남남동', S: '남', SSW: '남남서', SW: '남서', WSW: '서남서', W: '서', WNW: '서북서', NW: '북서', NNW: '북북서' };
const DIR_JA = { 北: 'N', 北北東: 'NNE', 北東: 'NE', 東北東: 'ENE', 東: 'E', 東南東: 'ESE', 南東: 'SE', 南南東: 'SSE', 南: 'S', 南南西: 'SSW', 南西: 'SW', 西南西: 'WSW', 西: 'W', 西北西: 'WNW', 北西: 'NW', 北北西: 'NNW' };
function moveText(s, lang) {
  const m = s.move || {}; let d = m.dir; if (typeof d === 'number') d = DIR16[Math.round(d / 22.5) % 16]; else if (DIR_JA[d]) d = DIR_JA[d]; if (!d && !m.kmh) return '';
  const ja = d ? (Object.keys(DIR_JA).find(k => DIR_JA[k] === d) || d) : '', ko = d ? (DIR_KO[d] || d) : '', sp = m.kmh ? `${m.kmh} km/h` : '';
  return { ko: `${ko ? ko + '쪽으로 ' : ''}${sp ? sp + ' ' : ''}이동 중`, en: `moving${d ? ' ' + d : ''}${sp ? ' at ' + sp : ''}`, ja: `${ja ? ja + 'へ' : ''}${sp ? sp + 'で' : ''}進行中`, es: `se mueve${d ? ' hacia ' + d : ''}${sp ? ' a ' + sp : ''}`, zh: `${ja ? '向' + ja : ''}${sp ? '以 ' + sp + ' ' : ''}移動` }[lang];
}
const fmtT = (iso, lang) => { const d = new Date(iso); if (isNaN(d)) return ''; return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(d) + ' UTC'; };
const fmtD = (iso, lang) => { const d = new Date(iso); if (isNaN(d)) return ''; return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(d); };

// 기관별 예보 경로 → [{src, pts:[{t(ms), lat, lon, wind, r}]}] (현재 위치를 0시간째로 포함)
function tracksOf(s) { const at = Date.parse(s.at) || Date.now(); return Object.entries(s.tracks || {}).filter(([src, v]) => v && v.length && AG[src]).map(([src, fc]) => ({ src, pts: [{ t: at, lat: s.lat, lon: s.lon, h: 0, wind: s.wind, r: 0 }].concat(fc.map(f => ({ t: (f.t && Date.parse(f.t)) || at + (f.h || 0) * 3600e3, lat: f.lat, lon: f.lon, h: f.h, wind: f.wind, r: f.r, pressure: f.pressure })).filter(p => p.lat != null && p.t > at)).sort((a, b) => a.t - b.t) })); }
// [ADD] otemp 평균(합의) 경로: 기관 2곳 이상이 겹치는 6시간 단위 시각마다 각 기관 경로를 그 시각으로 보간해 평균. r = 평균에서 가장 멀리 떨어진 기관까지의 거리
function consensus(trs, s) {
  const real = trs.filter(t => t.src !== 'avg' && t.pts.length > 1); if (real.length < 2) return null;
  const at = Date.parse(s.at) || Date.now(); const H6 = 6 * 3600e3;
  const interp = (tr, t) => { const p = tr.pts; if (t < p[0].t || t > p[p.length - 1].t) return null; for (let i = 1; i < p.length; i++) if (t <= p[i].t) { const a = p[i - 1], b = p[i], f = (t - a.t) / (b.t - a.t || 1); return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, wind: a.wind != null && b.wind != null ? a.wind + (b.wind - a.wind) * f : (b.wind != null ? b.wind : a.wind) }; } return null; };
  const times = [...new Set(real.flatMap(tr => tr.pts.filter(p => p.h).map(p => Math.round(p.t / H6) * H6)))].filter(t => t > at).sort((a, b) => a - b);
  const pts = [{ t: at, lat: s.lat, lon: s.lon, h: 0, wind: s.wind, r: 0 }];
  times.forEach(t => { const got = real.map(tr => interp(tr, t)).filter(Boolean); if (got.length < 2) return;
    const lat = got.reduce((a, p) => a + p.lat, 0) / got.length, lon = got.reduce((a, p) => a + p.lon, 0) / got.length, ws = got.filter(p => p.wind != null);
    pts.push({ t, lat: +lat.toFixed(2), lon: +lon.toFixed(2), h: Math.round((t - at) / 3600e3), wind: ws.length ? +(ws.reduce((a, p) => a + p.wind, 0) / ws.length).toFixed(1) : null, r: Math.round(Math.max(...got.map(p => km(lat, lon, p.lat, p.lon)))), n: got.length }); });
  return pts.length > 1 ? { src: 'avg', pts, n: real.length } : null;
}
function spread(trs) { if (trs.length < 2) return null; let mx = 0; for (let i = 0; i < trs.length; i++) for (let j = i + 1; j < trs.length; j++) trs[i].pts.forEach(a => { if (!a.h) return; const b = trs[j].pts.reduce((best, p) => (best == null || Math.abs(p.t - a.t) < Math.abs(best.t - a.t)) ? p : best, null); if (b && Math.abs(b.t - a.t) <= 3 * 3600e3) mx = Math.max(mx, km(a.lat, a.lon, b.lat, b.lon)); }); return Math.round(mx); }
// 시간별 보간(3시간 간격)으로 각 포인트까지 가장 가까운 거리·시각
function closest(trs, s, spot) {
  let best = { d: km(spot.lat, spot.lon, s.lat, s.lon), t: Date.parse(s.at) || Date.now(), src: null };
  trs.forEach(tr => { for (let i = 1; i < tr.pts.length; i++) { const a = tr.pts[i - 1], b = tr.pts[i], n = Math.max(1, Math.round((b.t - a.t) / (3 * 3600e3)));
    for (let k = 0; k <= n; k++) { const f = k / n, la = a.lat + (b.lat - a.lat) * f, lo = a.lon + (b.lon - a.lon) * f, d = km(spot.lat, spot.lon, la, lo); if (d < best.d) best = { d, t: a.t + (b.t - a.t) * f, src: tr.src }; } } });
  return best;
}
// [ADD] "다시 들어갈 수 있는 때": Open-Meteo 파도 예보(7일, 포인트마다 Redis 6시간 보관)에서 가장 가까운 날 이후 처음으로 하루 최대 파고 < 1m 인 날
async function waveDays(spot) {
  const key = `st:wv:${spot.no}`; try { const [v] = await S.R(['GET', key]); if (v) return JSON.parse(v); } catch (_) {}
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), 7000); let out = null;
  try { const r = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${spot.lat}&longitude=${spot.lon}&daily=wave_height_max&forecast_days=7&timezone=UTC`, { signal: c.signal }); const j = await r.json(); if (j && j.daily && j.daily.time) out = j.daily.time.map((d, i) => [d, j.daily.wave_height_max[i]]); } catch (_) {} finally { clearTimeout(tm); }
  if (out) { try { await S.R(['SET', key, JSON.stringify(out), 'EX', String(6 * 3600)]); } catch (_) {} }
  return out;
}
function backText(days, closeT, t, lang) {
  if (!days) return t.backNa; const cd = new Date(closeT).toISOString().slice(0, 10); const last = days[days.length - 1][0]; if (cd > last) return t.backOut;
  const after = days.filter(([d]) => d >= cd); if (!after.length) return t.backOut;
  if (after.every(([, w]) => w != null && w < 1)) return t.backCalm;
  let seenHigh = false; for (const [d, w] of after) { if (w != null && w >= 1) seenHigh = true; else if (seenHigh && w != null && w < 1) return t.back(fmtD(d + 'T00:00:00Z', lang)); }
  return t.backNo;
}
// 해역별 공식 발표 링크
function official(s) {
  const L = [], lon = s.lon, lat = s.lat;
  if (lon > 100 && lon <= 180 && lat > 0) L.push(['한국 기상청 태풍정보', 'https://www.weather.go.kr/w/typhoon/typ-info.do'], ['気象庁 台風情報', 'https://www.jma.go.jp/bosai/map.html#contents=typhoon'], ['PAGASA (Philippines)', 'https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin'], ['中央氣象署 颱風 (Taiwan)', 'https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_NEWS.html'], ['Hong Kong Observatory', 'https://www.hko.gov.hk/en/wxinfo/currwx/tc_pos.htm'], ['JTWC', 'https://www.metoc.navy.mil/jtwc/jtwc.html']);
  else if (lon < 0 || lon > 180) { L.push(['NHC (US National Hurricane Center)', 'https://www.nhc.noaa.gov/'], ['CONAGUA (México)', 'https://smn.conagua.gob.mx/es/ciclones-tropicales/informacion-actual']); }
  else if (lon >= 30 && lon <= 100 && lat > 0) L.push(['India Meteorological Department', 'https://mausam.imd.gov.in/responsive/cyclone.php'], ['Bangladesh Met. Dept.', 'https://live.bmd.gov.bd/'], ['JTWC', 'https://www.metoc.navy.mil/jtwc/jtwc.html']);
  else if (lat <= 0) L.push(['Bureau of Meteorology (Australia)', 'http://www.bom.gov.au/cyclone/'], ['Fiji Met Service', 'https://www.met.gov.fj/'], ['Météo-France La Réunion', 'https://meteofrance.re/fr/cyclone'], ['JTWC', 'https://www.metoc.navy.mil/jtwc/jtwc.html']);
  L.push(['GDACS', 'https://www.gdacs.org/']); return L;
}

// [ADD] 바다 수온: /api/sst 가 Redis(sst:grid)에 둔 1° 격자(NOAA 위성). 태풍 주변·예보 경로 위 수온을 읽어요
async function loadSst() { try { const [{ result }] = await redisPipeline([['GET', 'sst:grid']]); if (!result) return null; const g = JSON.parse(JSON.parse(result).body); return g && g.v ? g : null; } catch (_) { return null; } }
function sstAt(g, lat, lon) { if (!g) return null; lon = ((lon + 180) % 360 + 360) % 360 - 180; const row = Math.round(g.lat0 - lat), col = Math.round(lon - g.lon0);
  const get = (r, c) => { if (r < 0 || r >= g.h) return null; c = (c + g.w) % g.w; const v = g.v[r * g.w + c]; return v == null ? null : v * g.scale; };
  const v = get(row, col); if (v != null) return v; const nb = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const x = get(row + dr, col + dc); if (x != null) nb.push(x); } return nb.length ? nb.reduce((a, b) => a + b, 0) / nb.length : null; }
const r1 = (v) => v == null ? null : Math.round(v * 10) / 10;
function sstSummary(g, s, trs, t) {
  if (!g) return null; const cur = r1(sstAt(g, s.lat, s.lon));
  const dirs = [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => { const r = 300 / 111.32, a = deg * Math.PI / 180, la = s.lat + r * Math.cos(a), lo = s.lon + r * Math.sin(a) / Math.cos(s.lat * Math.PI / 180); return { d: t.dirs[i], v: r1(sstAt(g, la, lo)) }; });
  const warm = dirs.filter(x => x.v != null).sort((a, b) => b.v - a.v)[0];
  const paths = trs.map(tr => { const vs = tr.pts.filter(p => p.h).map(p => sstAt(g, p.lat, p.lon)).filter(v => v != null); if (!vs.length) return null; const m = vs.reduce((a, b) => a + b, 0) / vs.length, mn = Math.min(...vs); return { src: tr.src, m: r1(m), mn: r1(mn), v: mn >= 28 ? 'up' : mn >= 26.5 ? 'keep' : 'down' }; }).filter(Boolean);
  return { cur, dirs, warm, paths };
}
async function loadStorms() {
  let cur = { storms: [] }; try { const [{ result }] = await redisPipeline([['GET', 'storms:v1']]); if (result) cur = JSON.parse(result); } catch (_) {}
  if (!cur.storms || cur.storms.some(s => !s.slug)) { try { const o = await require('./_storms').build(); if (o && o.storms) cur = o; } catch (_) {} }
  return cur;
}
async function loadIndex() { const idx = []; try { const [{ result }] = await redisPipeline([['HGETALL', 'st:idx']]); if (Array.isArray(result)) for (let i = 0; i < result.length; i += 2) { try { idx.push(JSON.parse(result[i + 1])); } catch (_) {} } } catch (_) {} return idx.sort((a, b) => (b.last || 0) - (a.last || 0)); }
const affected = (trs, s, all) => all.map(spot => ({ spot, c: closest(trs, s, spot) })).filter(x => x.c.d <= 350).sort((a, b) => a.c.d - b.c.d).slice(0, 30);

function renderStorm(lang, s, all, base, waves, sst) {
  const t = T[lang], TT = H.T[lang], name = label(s, lang), slug = s.slug;
  const hrefs = Object.fromEntries(LANGS.map(l => [l, tpath(l, slug)]));
  const real = tracksOf(s), avg = consensus(real, s), trs = avg ? [...real, avg] : real, sp = spread(real), [la, lo] = fmtLL(s.lat, s.lon, lang), dstr = fmtT(s.at, lang);
  const agreeTxt = t.agree(sp, real.length);
  const aff = affected(trs, s, all);
  const cards = [[t.cards[0], s.pressure ? `${s.pressure}<small> hPa</small>` : '–', s.pressure ? t.pDelta(Math.round(1013 - s.pressure)) : ''], [t.cards[1], s.wind ? `${s.wind}<small> m/s</small>` : '–'], [t.cards[2], s.move && s.move.kmh ? `${s.move.kmh}<small> km/h</small>` : '–'], [t.cards[3], s.radii && s.radii.gale ? `${s.radii.gale}<small> km</small>` : '–']];
  // 기관별 표: 예보 시각(6시간 단위로 합침) × 기관
  const times = [...new Set(trs.flatMap(tr => tr.pts.filter(p => p.h).map(p => Math.round(p.t / (6 * 3600e3)) * 6 * 3600e3)))].sort((a, b) => a - b);
  const sstC = (v) => v == null ? '' : `<span style="color:${v >= 28 ? '#fb7185' : v >= 26.5 ? '#fbbf24' : '#7dd3fc'}">${r1(v)}°C</span>`;
  const cell = (tr, tm) => { const p = tr.pts.find(q => q.h && Math.abs(q.t - tm) <= 3 * 3600e3); if (!p) return '<td class="dim">–</td>'; const [a, b] = fmtLL(p.lat, p.lon, lang); const sv = sstAt(sst, p.lat, p.lon); return `<td><span style="color:${AG[tr.src].c}">●</span> ${a} ${b}${p.wind || sv != null ? `<br><small>${[p.wind ? p.wind + ' m/s' : '', p.pressure ? p.pressure + ' hPa' : '', p.r ? '±' + p.r + ' km' : '', sv != null ? sstC(sv) : ''].filter(Boolean).join(' · ')}</small>` : ''}</td>`; };
  const table = trs.length ? `<div class="tw"><table class="rt"><tr><th>${t.th[0]}</th>${trs.map(tr => `<th><span style="color:${AG[tr.src].c}">${tr.src === 'avg' ? '•••' : '━ ━'}</span> ${AG[tr.src].n[lang]}</th>`).join('')}</tr>${times.map(tm => `<tr><td>${fmtT(new Date(tm).toISOString(), lang)}</td>${trs.map(tr => cell(tr, tm)).join('')}</tr>`).join('')}</table></div>` : `<p class="sub">${t.none}</p>`;
  const spotRows = aff.map(({ spot, c }, i) => `<tr><td><a href="${H.pathOf(lang, spot)}">${esc(H.nameIn(spot, lang))}</a><br><small class="dim">${esc(H.regionName(spot.cc, lang, spot.country))}</small></td><td>${c.src ? fmtT(new Date(c.t).toISOString(), lang) : '<span class="dim">' + t.nowKm(Math.round(c.d)) + '</span>'}</td><td>${Math.round(c.d)} km</td><td>${waves[i] === undefined ? '<span class="dim">–</span>' : backText(waves[i], c.t, t, lang)}</td></tr>`).join('');
  // [ADD] 지도 바탕에 깔 수온 격자(1°): 경로·포인트가 든 범위 ± 4°, 최대 70×70칸
  let cells = [];
  if (sst) { const ps = [[s.lat, s.lon], ...(s.track || []), ...trs.flatMap(tr => tr.pts.map(p => [p.lat, p.lon])), ...aff.map(x => [x.spot.lat, x.spot.lon])].filter(p => p && p[0] != null);
    let la0 = Math.min(...ps.map(p => p[0])) - 4, la1 = Math.max(...ps.map(p => p[0])) + 4, lo0 = Math.min(...ps.map(p => p[1])) - 4, lo1 = Math.max(...ps.map(p => p[1])) + 4;
    const mid = (a, b, w) => { const c = (a + b) / 2; return [c - w / 2, c + w / 2]; }; if (la1 - la0 > 70) [la0, la1] = mid(la0, la1, 70); if (lo1 - lo0 > 70) [lo0, lo1] = mid(lo0, lo1, 70);
    for (let la = Math.floor(la0); la <= Math.ceil(la1); la++) for (let lo = Math.floor(lo0); lo <= Math.ceil(lo1); lo++) { const v = sstAt(sst, la, lo); if (v != null) cells.push([la, lo, Math.round(v * 10) / 10]); } }
  const mapData = JSON.stringify({ sstLabel: t.sstMap, sst: cells, s: { lat: s.lat, lon: s.lon, name, gale: s.radii && s.radii.gale, storm: s.radii && s.radii.storm, track: s.track || [] }, trs: trs.map(tr => ({ src: tr.src, c: AG[tr.src].c, n: AG[tr.src].n[lang], pts: tr.pts.map(p => [p.lat, p.lon, p.r || 0, p.h, p.wind]) })), spots: aff.map(({ spot, c }) => [spot.lat, spot.lon, H.nameIn(spot, lang), Math.round(c.d), H.pathOf(lang, spot)]) }).replace(/</g, '\\u003c');
  const jsonld = [{ '@context': 'https://schema.org', '@type': 'WebPage', name: t.h1(name), description: t.desc(name, dstr), url: base + hrefs[lang], dateModified: new Date(s.at).toISOString(), about: { '@type': 'Event', name, startDate: new Date(s.at).toISOString(), location: { '@type': 'Place', geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lon } } } }];
  const body = `${H.header(lang, hrefs)}<nav class="crumb"><a href="/${lang}/t/">${t.crumb}</a> › ${esc(name)}</nav>
<h1>${esc(t.h1(name))}</h1>
<p class="sub">${esc(t.upd(dstr))}${s.agencies ? ' · ' + s.agencies.filter(a => AG[a]).map(a => AG[a].n[lang]).join(' · ') : ''}</p>
${s.ended ? `<p class="note warn">${t.ended}</p>` : ''}${s.noTrack ? `<p class="note warn">${t.noTrack}</p>` : ''}
<p class="lead">${esc(t.lead(name, dstr, la, lo, s.pressure, s.wind, moveText(s, lang)))}${agreeTxt ? ` <b>${esc(agreeTxt)}</b>` : ''}</p>
<div class="cards g4">${cards.map(([l, v, sub]) => `<div class="c"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`).join('')}</div>
<h2>${t.sstH}</h2>
<p class="sub">${t.sstWhy}</p>
${(() => { const o = sstSummary(sst, s, trs, t); if (!o || o.cur == null) return `<p class="sub">${t.sstNa}</p>`;
  const vlab = (v) => `<span style="color:${v === 'up' ? '#fb7185' : v === 'keep' ? '#fbbf24' : '#7dd3fc'}">${t.sstV[v]}</span>`;
  return `<p class="lead">${esc(t.sstNow(o.cur))}${o.warm ? ` · ${esc(t.warm(o.warm.d, o.warm.v))}` : ''} <button type="button" class="fold" data-t="sstbody" aria-expanded="false">${FOLD[lang] ? FOLD[lang][1] : FOLD.en[1]}</button></p>
<div id="sstbody" style="display:none">
<div class="sstg">${[7, 0, 1, 6, -1, 2, 5, 4, 3].map(i => { const x = i < 0 ? { d: ({ ko: '중심', en: 'Center', ja: '中心', es: 'Centro', zh: '中心' })[lang] || 'Center', v: o.cur } : o.dirs[i]; const w = i >= 0 && o.warm && x.d === o.warm.d; return `<div class="c${i < 0 ? ' ctr' : ''}"${w ? ' style="outline:2px solid #fb7185;font-weight:700"' : ''}><div class="l">${x.d}${w ? ' ▲' : ''}</div><div class="v">${x.v == null ? '–' : sstC(x.v)}</div></div>`; }).join('')}</div><p class="sub">${t.sstDir} · ${t.sstSrc}</p>
${o.paths.length ? (() => { const real = o.paths.filter(p => p.src !== 'avg'), hot = real.length > 1 ? real.reduce((a, b) => b.m > a.m ? b : a) : null;
    return `<ul class="off">${o.paths.map(p => { const isHot = hot && p.src === hot.src; return `<li${isHot ? ' style="font-weight:700"' : ''}><span style="color:${AG[p.src].c}">━ ━</span> ${esc(t.sstPath(AG[p.src].n[lang], p.m, p.mn))} → ${vlab(p.v)}${isHot ? ` <span style="color:#fb7185">${t.sstHot}</span>` : ''}</li>`; }).join('')}</ul>`; })() : ''}
</div>`; })()}
<h2>${t.mapH}</h2>
<style>.fold{font:inherit;font-size:12px;padding:2px 10px;margin-left:6px;border:1px solid var(--line);border-radius:999px;background:transparent;color:inherit;cursor:pointer;vertical-align:middle}</style>
<script>document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.fold');if(!b)return;var el=document.getElementById(b.dataset.t);if(!el)return;var L=${JSON.stringify(FOLD[lang] || FOLD.en)};var open=b.getAttribute('aria-expanded')==='true';el.style.display=open?'none':'';b.setAttribute('aria-expanded',open?'false':'true');b.textContent=open?L[1]:L[0]});</script>
<style>#stmap{height:440px;border-radius:12px;border:1px solid var(--line);background:#0b1120;margin:8px 0 2px}@media(max-width:600px){#stmap{height:340px}}</style>
<div id="stmap"></div><p class="sub">${t.mapNote}${avg ? ' ' + t.avgNote(avg.n) : ''}</p>
<h2>${t.tableH} <button type="button" class="fold" data-t="tblbody" aria-expanded="false">${FOLD[lang] ? FOLD[lang][1] : FOLD.en[1]}</button></h2>
<div id="tblbody" style="display:none">${table}</div>
<h2>${t.spotsH}</h2>
${aff.length ? `<p class="sub">${t.spotsNote(aff.length)}</p><div class="tw"><table class="rt"><tr>${t.sth.map(h => `<th>${h}</th>`).join('')}</tr>${spotRows}</table></div>` : `<p class="sub">${t.spotsNone}</p>`}
<h2>${t.offH}</h2>
<ul class="off">${official(s).map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${esc(n)}</a></li>`).join('')}</ul>
<div class="cta"><a class="btn" href="/?lat=${s.lat}&lon=${s.lon}&z=4&lang=${lang}">${TT.cta}</a></div>
<div class="foot">${t.foot}<br>© otemp.app · <a href="/">${TT.links[0]}</a><a href="/${lang}/t/">${t.list}</a><a href="/${lang}/s/">${TT.links[1]}</a></div>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>(function(){var D=${mapData};if(!window.L)return;var m=L.map('stmap',{worldCopyJump:true,scrollWheelZoom:false});L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Esri',maxZoom:12}).addTo(m);L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{opacity:.7,maxZoom:12}).addTo(m);
var cv=L.canvas({padding:.5});var col=function(v){var t=Math.max(0,Math.min(1,(v-24)/7));var r,g,b2;if(t<.5){var u=t/.5;r=Math.round(56+(251-56)*u);g=Math.round(189+(191-189)*u);b2=Math.round(248+(36-248)*u)}else{var u2=(t-.5)/.5;r=Math.round(251+(239-251)*u2);g=Math.round(191+(68-191)*u2);b2=Math.round(36+(68-36)*u2)}return'rgb('+r+','+g+','+b2+')'};
(D.sst||[]).forEach(function(c){L.rectangle([[c[0]-.5,c[1]-.5],[c[0]+.5,c[1]+.5]],{renderer:cv,stroke:false,fillColor:col(c[2]),fillOpacity:.42,interactive:false}).addTo(m)});
var b=[[D.s.lat,D.s.lon]];if(D.s.track.length>1){L.polyline(D.s.track,{color:'#fff',weight:2,opacity:.7}).addTo(m);D.s.track.forEach(function(p){b.push(p)})}
D.trs.forEach(function(tr){var pts=tr.pts.map(function(p){return[p[0],p[1]]});var av=tr.src==='avg';L.polyline(pts,{color:tr.c,weight:av?4:3,dashArray:av?'2 6':'7 6',opacity:av?.9:.95}).addTo(m);tr.pts.forEach(function(p){b.push([p[0],p[1]]);if(p[2])L.circle([p[0],p[1]],{radius:p[2]*1000,color:tr.c,weight:1,opacity:.5,fillOpacity:.06}).addTo(m);if(p[3])L.circleMarker([p[0],p[1]],{radius:4,color:tr.c,fillColor:tr.c,fillOpacity:1,weight:1}).addTo(m).bindTooltip(tr.n+' +'+p[3]+'h'+(p[4]?' · '+p[4]+' m/s':''))})});
if(D.s.gale)L.circle([D.s.lat,D.s.lon],{radius:D.s.gale*1000,color:'#ffd27a',weight:1,fillOpacity:.1}).addTo(m);if(D.s.storm)L.circle([D.s.lat,D.s.lon],{radius:D.s.storm*1000,color:'#f87171',weight:1,fillOpacity:.15}).addTo(m);
L.marker([D.s.lat,D.s.lon],{icon:L.divIcon({className:'',html:'<div style="font-size:26px;line-height:1;text-shadow:0 0 6px #000">🌀</div>',iconSize:[26,26],iconAnchor:[13,13]})}).addTo(m).bindTooltip(D.s.name);
D.spots.forEach(function(s){L.circleMarker([s[0],s[1]],{radius:5,color:'#0f172a',fillColor:'#4ade80',fillOpacity:.95,weight:1}).addTo(m).bindTooltip(s[2]+' · '+s[3]+' km').on('click',function(){location.href=s[4]})});
D.spots.forEach(function(s){b.push([s[0],s[1]])});var bb=L.latLngBounds(b).pad(.35);var fit=function(){m.invalidateSize();m.fitBounds(bb,{maxZoom:6})};fit();setTimeout(fit,300);setTimeout(fit,1500);window.addEventListener('load',fit);window.addEventListener('resize',fit);var lg=L.control({position:'bottomleft'});lg.onAdd=function(){var d=L.DomUtil.create('div');d.style.cssText='background:rgba(7,11,20,.8);color:#e2e8f0;font-size:11px;padding:6px 8px;border-radius:8px;line-height:1.5';d.innerHTML=D.trs.map(function(t){return'<span style="color:'+t.c+'">━ ━</span> '+t.n}).join('<br>')+(D.sst&&D.sst.length?'<div style="margin-top:5px;border-top:1px solid rgba(255,255,255,.15);padding-top:4px">'+D.sstLabel+'<div style="height:8px;border-radius:4px;margin-top:3px;background:linear-gradient(90deg,'+col(24)+','+col(26.5)+' 36%,'+col(28)+' 57%,'+col(31)+')"></div><div style="display:flex;justify-content:space-between"><span>24°</span><span>26.5°</span><span>28°</span><span>31°C</span></div></div>':'');return d};lg.addTo(m)})();</script>
<style>.sstg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px auto 4px;max-width:360px}.sstg .c{padding:10px 6px;text-align:center}.sstg .c.ctr{opacity:.85;border-style:dashed}.sstg .v{font-size:16px}
h2{font-size:17px;margin:22px 0 6px}
.tw{overflow-x:auto}.rt{width:100%;border-collapse:collapse;font-size:13.5px;margin:8px 0}.rt th{text-align:left;color:var(--muted);font-weight:600;font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.rt td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}.rt td small{color:var(--muted)}.dim{color:var(--dim)}
.note{font-size:13.5px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--line)}.note.warn{border-color:rgba(255,176,0,.5);color:#ffd27a}
.off{padding-left:18px;line-height:1.9;font-size:14px}.off a{color:var(--sky)}.lead b{color:#ffd27a}</style>`;
  return H.page({ lang, title: `${t.h1(name)} | otemp`, desc: t.desc(name, dstr), canonical: hrefs[lang], alternates: hrefs, jsonld, body, base });
}

async function stormPage(req, res, lang, all, base, slug) {
  const t = T[lang], TT = H.T[lang]; slug = String(slug || '').toLowerCase();
  const cur = await loadStorms(); let s = (cur.storms || []).find(x => x.slug === slug);
  if (!s) { try { const [{ result }] = await redisPipeline([['GET', 'st:arc:' + slug]]); if (result) { s = JSON.parse(result); if (!s.noTrack) s.ended = true; } } catch (_) {} }
  if (!s) { res.setHeader('Cache-Control', 'no-store'); return H.sendHtml(res, 404, H.page({ lang, title: `${TT.notFound} | otemp`, desc: t.listDesc, canonical: `/${lang}/t/`, body: `${H.header(lang, Object.fromEntries(LANGS.map(l => [l, `/${l}/t/`])))}<h1 style="margin-top:20px">${TT.notFound}</h1><p><a href="/${lang}/t/">${t.crumb}</a></p>`, base })); }
  const aff = affected(tracksOf(s), s, all);
  const [waves, sst] = await Promise.all([Promise.all(aff.map(({ spot }, i) => i < 12 && !s.ended ? waveDays(spot).catch(() => null) : Promise.resolve(undefined))), loadSst()]);
  res._hit = 'storm:' + slug; res._cache = !!(req.query || {}).lang;
  return H.sendHtml(res, 200, renderStorm(lang, s, all, base, waves, sst));
}
async function stormIndex(req, res, lang, all, base) {
  const t = T[lang], TT = H.T[lang], hrefs = Object.fromEntries(LANGS.map(l => [l, `/${l}/t/`]));
  const cur = await loadStorms(), idx = await loadIndex(); const act = new Set((cur.storms || []).map(s => s.slug));
  const row = (s, live) => `<li><a href="${tpath(lang, s.slug)}">${esc(label(s, lang))}</a> <small class="dim">${live ? `<b style="color:#4ade80">${t.active}</b> · ${s.pressure ? s.pressure + ' hPa · ' : ''}${s.wind ? s.wind + ' m/s' : ''}` : t.peak(s.maxWind || '–', s.minP && s.minP < 9999 ? s.minP : '')} · ${new Date(live ? s.at : s.last).toISOString().slice(0, 10)}</small></li>`;
  const past = idx.filter(s => !act.has(s.slug));
  const body = `${H.header(lang, hrefs)}<h1 style="margin-top:16px">${t.listH1}</h1><p class="sub">${t.listDesc}</p>
${cur.storms && cur.storms.length ? `<ul class="sl">${cur.storms.map(s => row(s, true)).join('')}</ul>` : `<p class="sub">${t.listNone}</p>`}
${past.length ? `<h2>${t.past}</h2><ul class="sl">${past.slice(0, 60).map(s => row(s, false)).join('')}</ul>` : ''}
<div class="foot">${t.foot}<br>© otemp.app · <a href="/">${TT.links[0]}</a><a href="/${lang}/s/">${TT.links[1]}</a></div><style>.sl{padding-left:18px;line-height:2;font-size:15px}.sl small{font-size:12px}h2{font-size:17px;margin:22px 0 6px}.dim{color:var(--dim)}</style>`;
  res._hit = 'storms'; res._cache = !!(req.query || {}).lang;
  return H.sendHtml(res, 200, H.page({ lang, title: `${t.listH1} | otemp`, desc: t.listDesc, canonical: hrefs[lang], alternates: hrefs, body, base }));
}
// 사이트맵용: 목록 + 활동 중·기록 태풍(최근 100개)
async function sitemapUrls(base) {
  const idx = await loadIndex(); const out = [];
  const alt = (paths) => LANGS.map(l => `<xhtml:link rel="alternate" hreflang="${l}" href="${base}${paths[l]}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${base}${paths.en}"/>`;
  const ip = Object.fromEntries(LANGS.map(l => [l, `/${l}/t/`])); LANGS.forEach(l => out.push(`<url><loc>${base}${ip[l]}</loc>${alt(ip)}<changefreq>hourly</changefreq></url>`));
  idx.slice(0, 100).forEach(s => { const p = Object.fromEntries(LANGS.map(l => [l, tpath(l, s.slug)])); const live = Date.now() - (s.last || 0) < 2 * 86400e3; LANGS.forEach(l => out.push(`<url><loc>${base}${p[l]}</loc>${alt(p)}<lastmod>${new Date(s.last || Date.now()).toISOString().slice(0, 10)}</lastmod><changefreq>${live ? 'hourly' : 'yearly'}</changefreq></url>`)); });
  return out;
}
module.exports = { stormPage, stormIndex, sitemapUrls, tpath, label, _test: { renderStorm, closest, tracksOf, spread, backText, moveText, sstAt, sstSummary, consensus } };
