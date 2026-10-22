// [ADD] 정점 이름 자동 번역 (DeepL API, Vercel 환경변수 DEEPL_API_KEY - Free 키는 ":fx"로 끝나요)
//  관리자가 한국어나 영어 이름 하나만 넣으면 나머지 언어(en/ko, es, zh, ja)를 채워요. 사람이 직접 고친 칸은 다시 덮어쓰지 않아요(namesAuto 로 구분).
//  zh 는 번체(ZH-HANT): 대만·홍콩·동남아 화교권 다이버가 주 대상
const LANGS = ['en', 'ko', 'es', 'zh', 'ja'];
const TARGET = { en: 'EN-US', ko: 'KO', es: 'ES', zh: 'ZH-HANT', ja: 'JA' };
const SOURCE = { en: 'EN', ko: 'KO', es: 'ES', zh: 'ZH', ja: 'JA' };
const hasKey = () => !!process.env.DEEPL_API_KEY;
const endpoint = () => /:fx$/.test(process.env.DEEPL_API_KEY || '') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
const srcOf = (t) => /[가-힣]/.test(t) ? 'ko' : /[ぁ-んァ-ン]/.test(t) ? 'ja' : /[一-龥]/.test(t) ? 'zh' : 'en';

async function translate(texts, target, source, ms) {
  if (!hasKey() || !texts.length) return null;
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms || 8000);
  try {
    const r = await fetch(endpoint(), { method: 'POST', signal: c.signal, headers: { Authorization: 'DeepL-Auth-Key ' + process.env.DEEPL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts, target_lang: TARGET[target], ...(source ? { source_lang: SOURCE[source] } : {}), preserve_formatting: true }) });
    if (!r.ok) throw new Error('deepl ' + r.status);
    const j = await r.json(); return (j.translations || []).map(x => String(x.text || '').trim());
  } catch (_) { return null; } finally { clearTimeout(tm); }
}

// spot.names 를 채워요. 반환: 바뀐 게 있으면 true. 원문 = 사람이 넣은 칸 중 하나(ko → en → 그 외 순), 없으면 spot.name
async function fillNames(spot, opt) {
  opt = opt || {};
  const names = Object.assign({}, spot.names || {}), auto = Object.assign({}, spot.namesAuto || {});
  const human = LANGS.filter(l => names[l] && !auto[l]);
  let src = human.includes('ko') ? 'ko' : human.includes('en') ? 'en' : human[0] || null, text = src ? names[src] : String(spot.name || '').trim();
  if (!src) { src = srcOf(text); if (!names[src]) { names[src] = text; auto[src] = false; } }
  if (!text) return false;
  const todo = LANGS.filter(l => l !== src && (!names[l] || (opt.force && auto[l])));
  if (!todo.length) return false;
  let changed = false;
  for (const l of todo) { const out = await translate([text], l, src, opt.ms); if (out && out[0]) { names[l] = out[0].slice(0, 80); auto[l] = true; changed = true; } }
  if (changed) { spot.names = names; spot.namesAuto = auto; }
  return changed;
}
module.exports = { LANGS, hasKey, translate, fillNames, srcOf };
