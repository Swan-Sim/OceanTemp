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

// ───────── [CHANGE] 포인트 이름은 '뜻 번역'이 아니라 '현지 발음 표기' ─────────
//  DeepL은 Skull Cave → 해골 동굴처럼 뜻으로 옮겨서, 포인트 이름은 Claude API(환경변수 ANTHROPIC_API_KEY)로
//  현지 발음대로 적어요. Skull Cave → 스컬 케이브, Pescador Island → 페스카도르섬.
//  (공지 번역은 그대로 DeepL)
const NAMES_V = 2; // 이 규칙으로 만든 자동 이름 표시. 예전(DeepL) 자동 이름은 '채우기' 때 다시 만들어요
const hasNameKey = () => !!process.env.ANTHROPIC_API_KEY;
const NAME_RULES = `You write names of dive/surf/water-sports spots in other languages for a map app.
Rules:
1. NEVER translate the meaning of a name. Write it by sound, the way local people pronounce it
   (Spanish names by Spanish pronunciation, Filipino/Malay/Thai/Indonesian names by local pronunciation, Korean by Korean, Japanese by Japanese reading).
   English descriptive words that are part of a spot name (Cave, Wall, Point, Reef, Garden, Rock, Beach, Cove, Wreck, Corner, Canyon, Arch, Pinnacle, Bay...) are ALSO written by sound,
   e.g. "Skull Cave" -> ko "스컬 케이브", ja "スカル・ケイブ"; "Blue Corner" -> ko "블루 코너".
2. Only these geographic words are translated: Island/Isla/Pulau → ko 섬 (attached, no space: "페스카도르섬"), ja 島, zh 島, es Isla, en Island;
   Islands → ko 제도, ja/zh 群島, es Islas; Strait → 해협/海峡/海峽/Estrecho; Cape → 곶; Peninsula → 반도; Mount/Mountain → 산; Lake → 호; River → 강.
   e.g. "Pescador Island" -> ko "페스카도르섬", ja "ペスカドール島", zh "佩斯卡多島", es "Isla Pescador".
3. Well-known cities, regions and countries use their established local name in that language (San Francisco → 샌프란시스코 / サンフランシスコ / 舊金山; Cebu → 세부 / セブ / 宿霧; Jeju → 제주 / 済州 / 濟州).
4. Korean: follow the official Korean loanword orthography (외래어 표기법) for sound. Japanese: katakana for foreign names. Chinese: Traditional characters (繁體), standard phonetic transliteration characters.
   English/Spanish for a Korean name: Revised Romanization (문섬 → Munseom, 범섬 → Beomseom); Spanish keeps the same romanization.
5. Keep text in parentheses, numbers and brand-like parts by the same rules. Keep it short (max 60 chars).
Reply with JSON only: {"en":"...","ko":"...","es":"...","zh":"...","ja":"..."}`;

async function nameByClaude(text, ms) {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms || 15000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: c.signal,
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5', max_tokens: 400, system: NAME_RULES,
        messages: [{ role: 'user', content: 'Spot name: ' + text }] }) });
    if (!r.ok) throw new Error('claude ' + r.status);
    const j = await r.json(); const t = ((j.content || [])[0] || {}).text || ''; const m = t.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (_) { return null; } finally { clearTimeout(tm); }
}

// spot.names 를 채워요. 반환: 바뀐 게 있으면 true. 원문 = 사람이 넣은 칸 중 하나(ko → en → 그 외 순), 없으면 spot.name
//  사람이 고친 칸은 절대 덮어쓰지 않아요. 예전 DeepL 자동 칸(namesV 없음)은 새 규칙으로 다시 만들어요
async function fillNames(spot, opt) {
  opt = opt || {};
  if (!hasNameKey()) return false;
  const names = Object.assign({}, spot.names || {}), auto = Object.assign({}, spot.namesAuto || {});
  const redo = spot.namesV !== NAMES_V || opt.force;
  const human = LANGS.filter(l => names[l] && !auto[l]);
  let src = human.includes('ko') ? 'ko' : human.includes('en') ? 'en' : human[0] || null, text = src ? names[src] : String(spot.name || '').trim();
  if (!src) { src = srcOf(text); if (!names[src]) { names[src] = text; auto[src] = false; } }
  if (!text) return false;
  const todo = LANGS.filter(l => l !== src && !(names[l] && !auto[l]) && (!names[l] || redo));
  if (!todo.length) { if (spot.namesV !== NAMES_V) { spot.namesV = NAMES_V; return true; } return false; }
  const out = await nameByClaude(text, opt.ms && opt.ms > 12000 ? opt.ms : 15000); if (!out) return false;
  let changed = false;
  for (const l of todo) { const v = String(out[l] || '').trim().slice(0, 80); if (v && v !== names[l]) { names[l] = v; auto[l] = true; changed = true; } }
  spot.names = names; spot.namesAuto = auto; spot.namesV = NAMES_V;
  return true;
}
// [CHANGE] 이전 DeepL 방식(참고용으로 남김, 안 씀)
async function fillNamesDeepL(spot, opt) {
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
// ───────── [ADD] 공지 번역 (Claude API 우선, 키가 없으면 DeepL) ─────────
//  공지 안에 포인트·지명이 나오면 뜻으로 옮기지 않고 현지 발음대로 적어요 (Skull Cave → 스컬 케이브, 해골 동굴 X).
const NOTICE_RULES = `You translate short notices for a diving / ocean-conditions map website into several languages.
Translate naturally for ordinary readers (friendly, concise, same tone). Keep numbers, dates, URLs, emoji and the order of list items.
IMPORTANT: names of dive spots, beaches, islands, cities and other places are NEVER translated by meaning. Write them by sound, the way local people pronounce them
(e.g. "Skull Cave" -> ko "스컬 케이브", ja "スカル・ケイブ", zh "骷髏洞" is WRONG, use phonetic "斯庫爾洞穴" style only if no established name exists; "Pescador Island" -> ko "페스카도르섬").
Only generic geographic words attached to a name (Island, Strait, Cape...) may be translated. Established names of well-known cities/countries use their normal name in that language.
Chinese must be Traditional (繁體). Korean follows 외래어 표기법 for sounds.
Input is JSON {"from":"<lang code>","texts":[...]}. Reply with JSON only: {"en":[...],"ko":[...],"es":[...],"zh":[...],"ja":[...]} where each array has exactly the same length and order as texts (leave the source language as given).`;
async function noticeByClaude(texts, from, ms) {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms || 25000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: c.signal,
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5', max_tokens: 2000, system: NOTICE_RULES,
        messages: [{ role: 'user', content: JSON.stringify({ from, texts }) }] }) });
    if (!r.ok) throw new Error('claude ' + r.status);
    const j = await r.json(); const t = ((j.content || [])[0] || {}).text || ''; const m = t.match(/\{[\s\S]*\}/);
    const o = m ? JSON.parse(m[0]) : null; if (!o) return null;
    const out = {};
    for (const l of LANGS) if (Array.isArray(o[l]) && o[l].length === texts.length) out[l] = o[l].map(x => String(x == null ? '' : x).trim());
    return out;
  } catch (_) { return null; } finally { clearTimeout(tm); }
}
const needsNames = (sp) => { const n = sp.names || {}; return LANGS.some(l => !n[l]) || (sp.namesV !== NAMES_V && Object.values(sp.namesAuto || {}).some(Boolean)); };
module.exports = { LANGS, NAMES_V, hasKey, hasNameKey, needsNames, translate, fillNames, srcOf, noticeByClaude };
