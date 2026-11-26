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
//  DeepL은 Skull Cave → 해골 동굴처럼 뜻으로 옮겨서, 포인트 이름은 통합 LLM 어댑터(api/_llm.js)로
//  현지 발음대로 적어요. Skull Cave → 스컬 케이브, Pescador Island → 페스카도르섬.
//  (지원 환경변수: GEMINI_API_KEY / LLM_API_KEY / OPENAI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY)
const LLM = require('./_llm');
const NAMES_V = 2; // 이 규칙으로 만든 자동 이름 표시. 예전(DeepL) 자동 이름은 '채우기' 때 다시 만들어요
const hasNameKey = () => LLM.hasLLMKey();
const activeProvider = () => LLM.activeProvider();
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

const NAME_BATCH_RULES = NAME_RULES.replace(
  'Reply with JSON only: {"en":"...","ko":"...","es":"...","zh":"...","ja":"..."}',
  'Input is a JSON object mapping string IDs to spot names, e.g. {"1":"Skull Cave","2":"Pescador Island"}.\nReply with JSON only mapping each exact same string ID to {"en":"...","ko":"...","es":"...","zh":"...","ja":"..."}.'
);

async function nameByLLM(text, ms) {
  return await LLM.completeJSON({
    system: NAME_RULES,
    user: 'Spot name: ' + text,
    maxTokens: 512,
    ms: ms || 15000,
  });
}

async function namesByLLMBatch(entries, ms) {
  if (!entries.length) return null;
  const input = {};
  for (const e of entries) input[e.id] = e.text;
  return await LLM.completeJSON({
    system: NAME_BATCH_RULES,
    user: JSON.stringify(input),
    maxTokens: Math.min(4096, Math.max(800, entries.length * 260)),
    ms: ms || 20000,
  });
}

function prepSpotName(spot, opt) {
  const names = Object.assign({}, spot.names || {}), auto = Object.assign({}, spot.namesAuto || {});
  const redo = spot.namesV !== NAMES_V || opt.force;
  const human = LANGS.filter(l => names[l] && !auto[l]);
  let src = human.includes('ko') ? 'ko' : human.includes('en') ? 'en' : human[0] || null;
  const text = src ? names[src] : String(spot.name || '').trim();
  if (!src) { src = srcOf(text); if (!names[src]) { names[src] = text; auto[src] = false; } }
  const todo = text ? LANGS.filter(l => l !== src && !(names[l] && !auto[l]) && (!names[l] || redo)) : [];
  return { names, auto, text, todo };
}

function applyNameOut(spot, prep, out) {
  if (!out || typeof out !== 'object') return false;
  let filled = false;
  for (const l of prep.todo) {
    const v = String(out[l] || '').trim().slice(0, 80);
    if (v) { prep.names[l] = v; prep.auto[l] = true; filled = true; }
  }
  if (!filled) return false;
  spot.names = prep.names; spot.namesAuto = prep.auto; spot.namesV = NAMES_V;
  return true;
}

// spot.names 를 채워요. 반환: 바뀐 게 있으면 true. 원문 = 사람이 넣은 칸 중 하나(ko → en → 그 외 순), 없으면 spot.name
//  사람이 고친 칸은 절대 덮어쓰지 않아요. 예전 DeepL 자동 칸(namesV 없음)은 새 규칙으로 다시 만들어요
async function fillNames(spot, opt) {
  opt = opt || {};
  if (!hasNameKey()) return false;
  const prep = prepSpotName(spot, opt);
  if (!prep.text) return false;
  if (!prep.todo.length) { if (spot.namesV !== NAMES_V) { spot.namesV = NAMES_V; return true; } return false; }
  const out = await nameByLLM(prep.text, opt.ms && opt.ms > 12000 ? opt.ms : 15000);
  return applyNameOut(spot, prep, out);
}

// 여러 스팟을 한 번의 LLM 호출로 묶어 채워요(무료 티어 RPM 절약 + 속도 개선). 누락분은 개별 재시도
async function fillNamesBatch(spots, opt) {
  opt = opt || {};
  if (!hasNameKey() || !spots.length) return [];
  const updated = [], todoItems = [];
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const prep = prepSpotName(sp, opt);
    if (!prep.text) continue;
    if (!prep.todo.length) {
      if (sp.namesV !== NAMES_V) { sp.namesV = NAMES_V; updated.push(sp); }
      continue;
    }
    todoItems.push({ id: String(sp.no != null ? sp.no : i), sp, prep, text: prep.text });
  }
  if (!todoItems.length) return updated;

  const batchOut = todoItems.length > 1
    ? await namesByLLMBatch(todoItems, opt.ms || 20000)
    : null;
  const missed = [];
  for (const item of todoItems) {
    if (batchOut && applyNameOut(item.sp, item.prep, batchOut[item.id])) updated.push(item.sp);
    else missed.push(item);
  }
  // 배치 응답이 실패했거나 일부 빠진 항목은 4개씩 개별 호출로 보완
  for (let i = 0; i < missed.length; i += 4) {
    await Promise.all(missed.slice(i, i + 4).map(async (item) => {
      try {
        const out = await nameByLLM(item.text, opt.ms || 15000);
        if (applyNameOut(item.sp, item.prep, out)) updated.push(item.sp);
      } catch (_) {}
    }));
  }
  return updated;
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
// ───────── [ADD] 공지 번역 (통합 LLM API 우선, 키가 없거나 실패하면 DeepL 폴백) ─────────
//  공지 안에 포인트·지명이 나오면 뜻으로 옮기지 않고 현지 발음대로 적어요 (Skull Cave → 스컬 케이브, 해골 동굴 X).
const NOTICE_RULES = `You translate short notices for a diving / ocean-conditions map website into several languages.
Translate naturally for ordinary readers (friendly, concise, same tone). Keep numbers, dates, URLs, emoji and the order of list items.
IMPORTANT: names of dive spots, beaches, islands, cities and other places are NEVER translated by meaning. Write them by sound, the way local people pronounce them
(e.g. "Skull Cave" -> ko "스컬 케이브", ja "スカル・ケイブ", zh "骷髏洞" is WRONG, use phonetic "斯庫爾洞穴" style only if no established name exists; "Pescador Island" -> ko "페스카도르섬").
Only generic geographic words attached to a name (Island, Strait, Cape...) may be translated. Established names of well-known cities/countries use their normal name in that language.
Chinese must be Traditional (繁體). Korean follows 외래어 표기법 for sounds.
Input is JSON {"from":"<lang code>","texts":[...]}. Reply with JSON only: {"en":[...],"ko":[...],"es":[...],"zh":[...],"ja":[...]} where each array has exactly the same length and order as texts (leave the source language as given).`;
async function noticeByLLM(texts, from, ms) {
  const o = await LLM.completeJSON({
    system: NOTICE_RULES,
    user: JSON.stringify({ from, texts }),
    maxTokens: 2048,
    ms: ms || 25000,
  });
  if (!o) return null;
  const out = {};
  for (const l of LANGS) if (Array.isArray(o[l]) && o[l].length === texts.length) out[l] = o[l].map(x => String(x == null ? '' : x).trim());
  return Object.keys(out).length ? out : null;
}
const needsNames = (sp) => { const n = sp.names || {}; return LANGS.some(l => !n[l]) || (sp.namesV !== NAMES_V && Object.values(sp.namesAuto || {}).some(Boolean)); };
module.exports = { LANGS, NAMES_V, hasKey, hasNameKey, activeProvider, needsNames, translate, fillNames, fillNamesBatch, srcOf, noticeByLLM };
