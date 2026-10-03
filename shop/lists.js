// [ADD] 국가·언어 목록 (샵 등록·포인트 등록·관리 페이지 공용)
// 이름은 브라우저 내장 Intl.DisplayNames로 만들어서 번역 파일이 필요 없어요.
(function (g) {
  // 다이빙샵에서 자주 쓰는 언어(코드). 목록 맨 위 순서대로 보여요.
  const LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'th', 'vi', 'id', 'ms', 'fil', 'ar', 'he', 'tr', 'nl', 'el', 'hr', 'pl', 'sv', 'no', 'da', 'fi', 'cs', 'hu', 'ro', 'uk', 'hi', 'ta', 'si', 'my', 'km', 'lo', 'mn', 'fa', 'sw', 'af'];
  // ISO 3166-1 alpha-2 전체
  const REGIONS = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
    'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
    'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
    'OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
    'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');
  const dn = (loc, type) => { try { return new Intl.DisplayNames([loc], { type }); } catch (_) { return null; } };
  const enRegion = dn('en', 'region');
  // 언어 이름은 그 언어 자체로(한국어, English, 日本語 …) - 보는 사람 언어와 상관없이 알아보기 쉬움
  const langNative = (code) => { const d = dn(code, 'language'); const n = d && d.of(code); return n ? n.charAt(0).toUpperCase() + n.slice(1) : code; };
  const langIn = (code, ui) => { const d = dn(ui, 'language'); return (d && d.of(code)) || code; };
  const regionIn = (code, ui) => { const d = dn(ui, 'region'); return (d && d.of(code)) || code; };
  // 시트의 영어 나라 이름("South Korea") → 코드("KR")
  const alias = { 'south korea': 'KR', 'korea': 'KR', 'north korea': 'KP', 'usa': 'US', 'united states': 'US', 'uk': 'GB', 'united kingdom': 'GB', 'russia': 'RU', 'vietnam': 'VN', 'taiwan': 'TW', 'micronesia': 'FM', 'turkey': 'TR', 'czech republic': 'CZ', 'norway (svalbard)': 'SJ', 'antarctica': 'AQ', 'bahamas': 'BS', 'laos': 'LA', 'iran': 'IR', 'syria': 'SY', 'tanzania': 'TZ', 'bolivia': 'BO', 'venezuela': 'VE', 'moldova': 'MD', 'palestine': 'PS' };
  const byEnglish = {}; REGIONS.forEach(c => { const n = enRegion && enRegion.of(c); if (n) byEnglish[n.toLowerCase()] = c; });
  const regionCode = (name) => { const k = String(name || '').trim().toLowerCase(); return alias[k] || byEnglish[k] || (/^[a-z]{2}$/i.test(k) ? k.toUpperCase() : ''); };
  const regionEnglish = (code) => (enRegion && enRegion.of(code)) || code;
  // 브라우저 설정에서 나라(ko-KR → KR), 언어(ko)
  const browserLang = () => (navigator.language || 'en').split('-')[0].toLowerCase();
  const browserRegion = () => { const m = (navigator.languages || [navigator.language || '']).map(l => (l.split('-')[1] || '')).find(r => /^[A-Z]{2}$/i.test(r)); return m ? m.toUpperCase() : ''; };
  g.OTLists = { LANGS, REGIONS, langNative, langIn, regionIn, regionCode, regionEnglish, browserLang, browserRegion };
})(window);
