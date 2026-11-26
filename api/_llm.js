// [ADD] 통합 LLM API 어댑터 (Claude API 대체)
//  Vercel 환경변수만 넣으면 코드 수정 없이 프로바이더를 전환하고, 여러 키가 있으면 장애·한도 초과 시 자동 폴백해요.
//  기본 우선순위: Gemini → LLM(OpenAI 호환 커스텀) → OpenAI → Groq → OpenRouter
//  - Gemini (무료 티어 지원): GEMINI_API_KEY (또는 GOOGLE_API_KEY), 선택: GEMINI_MODEL (기본 gemini-2.5-flash)
//  - 커스텀 OpenAI 호환:      LLM_API_KEY, 선택: LLM_BASE_URL (기본 https://api.openai.com/v1), LLM_MODEL
//  - OpenAI:                  OPENAI_API_KEY, 선택: OPENAI_MODEL (기본 gpt-4o-mini), OPENAI_BASE_URL
//  - Groq (무료 티어 지원):   GROQ_API_KEY, 선택: GROQ_MODEL (기본 llama-3.3-70b-versatile)
//  - OpenRouter:              OPENROUTER_API_KEY, 선택: OPENROUTER_MODEL (기본 google/gemini-2.5-flash)
//  - 우선순위 지정(선택):     LLM_PROVIDER (예: "gemini", "openai", "groq,gemini")

const DEFAULT_ORDER = ['gemini', 'llm', 'openai', 'groq', 'openrouter'];

function inferCustomModel(baseUrl) {
  const u = String(baseUrl || '').toLowerCase();
  if (u.includes('groq.com')) return 'llama-3.3-70b-versatile';
  if (u.includes('deepseek.com')) return 'deepseek-chat';
  if (u.includes('openrouter.ai')) return 'google/gemini-2.5-flash';
  if (u.includes('mistral.ai')) return 'mistral-small-latest';
  return 'gpt-4o-mini';
}

function buildProvider(name) {
  const env = process.env;
  if (name === 'gemini') {
    const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
    if (!key) return null;
    return { name: 'gemini', kind: 'gemini', key: key.trim(), model: (env.GEMINI_MODEL || 'gemini-2.5-flash').trim() };
  }
  if (name === 'llm') {
    const key = env.LLM_API_KEY;
    if (!key) return null;
    const baseUrl = (env.LLM_BASE_URL || 'https://api.openai.com/v1').trim();
    const model = (env.LLM_MODEL || inferCustomModel(baseUrl)).trim();
    return { name: 'llm', kind: 'openai', key: key.trim(), model, baseUrl };
  }
  if (name === 'openai') {
    const key = env.OPENAI_API_KEY;
    if (!key) return null;
    return {
      name: 'openai',
      kind: 'openai',
      key: key.trim(),
      model: (env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
      baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim(),
    };
  }
  if (name === 'groq') {
    const key = env.GROQ_API_KEY;
    if (!key) return null;
    return {
      name: 'groq',
      kind: 'openai',
      key: key.trim(),
      model: (env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim(),
      baseUrl: 'https://api.groq.com/openai/v1',
    };
  }
  if (name === 'openrouter') {
    const key = env.OPENROUTER_API_KEY;
    if (!key) return null;
    return {
      name: 'openrouter',
      kind: 'openai',
      key: key.trim(),
      model: (env.OPENROUTER_MODEL || 'google/gemini-2.5-flash').trim(),
      baseUrl: 'https://openrouter.ai/api/v1',
    };
  }
  return null;
}

function getProviders() {
  const pref = String(process.env.LLM_PROVIDER || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => DEFAULT_ORDER.includes(s));
  const order = [...new Set([...pref, ...DEFAULT_ORDER])];
  return order.map(buildProvider).filter(Boolean);
}

const hasLLMKey = () => getProviders().length > 0;
const activeProvider = () => {
  const p = getProviders()[0];
  return p ? `${p.name}:${p.model}` : null;
};

function extractJSON(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const tryParse = (s) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch (_) {
      return null;
    }
  };
  let out = tryParse(raw);
  if (out) return out;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    out = tryParse(fenced[1].trim());
    if (out) return out;
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    out = tryParse(raw.slice(start, end + 1));
    if (out) return out;
  }
  return null;
}

async function fetchWithTimeout(url, init, ms) {
  const c = new AbortController();
  const tm = setTimeout(() => c.abort(), Math.max(1000, ms || 15000));
  try {
    return await fetch(url, { ...init, signal: c.signal });
  } finally {
    clearTimeout(tm);
  }
}

async function callGemini(p, opt, ms) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`;
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': p.key };
  const makeBody = (useThinkingCfg, useJsonMime) => {
    const genCfg = {
      maxOutputTokens: Math.max(512, opt.maxTokens || 512),
      temperature: opt.temperature == null ? 0.2 : opt.temperature,
    };
    if (opt.json && useJsonMime) genCfg.responseMimeType = 'application/json';
    if (useThinkingCfg && /^gemini-2\.5/.test(p.model) && process.env.GEMINI_THINKING !== '1') {
      genCfg.thinkingConfig = { thinkingBudget: 0 };
    }
    const body = {
      contents: [{ role: 'user', parts: [{ text: String(opt.user || '') }] }],
      generationConfig: genCfg,
    };
    if (opt.system) body.systemInstruction = { parts: [{ text: String(opt.system) }] };
    return body;
  };

  const deadline = Date.now() + ms;
  let r = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(makeBody(true, true)) }, ms);
  if (r.status === 400 && deadline - Date.now() > 2000) {
    // 모델에 따라 thinkingConfig 또는 responseMimeType 미지원 시 안전 재시도
    r = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(makeBody(false, false)) }, deadline - Date.now());
  }
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const j = await r.json();
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  return parts
    .filter(x => x && !x.thought && typeof x.text === 'string')
    .map(x => x.text)
    .join('')
    .trim();
}

function chatUrl(base) {
  const b = String(base || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(b) ? b : b + '/chat/completions';
}

async function callOpenAI(p, opt, ms) {
  const url = chatUrl(p.baseUrl);
  const headers = { Authorization: 'Bearer ' + p.key, 'Content-Type': 'application/json' };
  if (/openrouter\.ai/i.test(url)) {
    headers['HTTP-Referer'] = 'https://otemp.app';
    headers['X-Title'] = 'otemp.app';
  }
  const messages = [];
  if (opt.system) messages.push({ role: 'system', content: String(opt.system) });
  messages.push({ role: 'user', content: String(opt.user || '') });

  const makePayload = (flags) => {
    const body = { model: p.model, messages };
    if (flags.temp) body.temperature = opt.temperature == null ? 0.2 : opt.temperature;
    const maxTok = Math.max(400, opt.maxTokens || 512);
    if (flags.maxCompletion) body.max_completion_tokens = maxTok;
    else body.max_tokens = maxTok;
    if (opt.json && flags.jsonFmt) body.response_format = { type: 'json_object' };
    return body;
  };

  const deadline = Date.now() + ms;
  const flags = { temp: true, maxCompletion: false, jsonFmt: true };
  let r = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(makePayload(flags)) }, ms);
  if (r.status === 400 && deadline - Date.now() > 2000) {
    const errText = await r.text().catch(() => '');
    let retry = false;
    if (/response_format|json_object/i.test(errText) && flags.jsonFmt) { flags.jsonFmt = false; retry = true; }
    if (/max_completion_tokens/i.test(errText) && !flags.maxCompletion) { flags.maxCompletion = true; retry = true; }
    if (/temperature/i.test(errText) && flags.temp) { flags.temp = false; retry = true; }
    if (retry) {
      r = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(makePayload(flags)) }, deadline - Date.now());
    }
  }
  if (!r.ok) throw new Error(`${p.name} ${r.status}`);
  const j = await r.json();
  const msg = (((j.choices || [])[0] || {}).message) || {};
  if (typeof msg.content === 'string') return msg.content.trim();
  if (Array.isArray(msg.content)) {
    return msg.content.map(c => (c && typeof c.text === 'string' ? c.text : '')).join('').trim();
  }
  return '';
}

async function complete(opt) {
  const providers = getProviders();
  if (!providers.length) return null;
  const totalMs = Math.max(2000, opt.ms || 15000);
  const deadline = Date.now() + totalMs;

  for (let i = 0; i < providers.length; i++) {
    const rem = deadline - Date.now();
    if (rem < 1500) break;
    const p = providers[i];
    const hasNext = i < providers.length - 1;
    const stepMs = hasNext ? Math.min(rem, Math.max(4000, Math.floor(rem * 0.7))) : rem;
    try {
      const text = p.kind === 'gemini' ? await callGemini(p, opt, stepMs) : await callOpenAI(p, opt, stepMs);
      if (!text) continue;
      if (opt.json) {
        const data = extractJSON(text);
        if (!data) continue;
        return { text, data, provider: p.name, model: p.model };
      }
      return { text, data: null, provider: p.name, model: p.model };
    } catch (_) {
      // 다음 설정된 프로바이더로 자동 폴백
    }
  }
  return null;
}

async function completeJSON(opt) {
  const res = await complete({ ...opt, json: true });
  return res ? res.data : null;
}

module.exports = { getProviders, hasLLMKey, activeProvider, extractJSON, complete, completeJSON };
