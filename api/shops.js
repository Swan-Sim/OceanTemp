// [ADD] 다이빙샵(제휴) 목록 + 연락 버튼 클릭 수.
//   /api/shops                → { shops: [{ id, spots:[정점번호], name, phone, kakao, whatsapp, instagram, web, lang, note, paid, checked }] }
//   /api/shops?svc=click&id=3&k=tel  → 클릭 1 올리기(204). Redis sc:{UTC날짜} 해시에 "샵id|종류"로 셉니다.
// 샵 목록은 구글 시트의 "샵" 탭(웹에 게시 → CSV) 주소를 Vercel 환경변수 SHOPS_CSV_URL에 넣으면 거기서 읽고,
// 없으면 저장소의 data/shops.csv를 씁니다.
// 만료일(expires)이 지났거나 show가 N인 샵은 여기서 빼서 아예 화면에 보내지 않아요(시트에서 날짜만 늘리면 다시 보임).
const { redisPipeline } = require('./_redis');

const KINDS = new Set(['tel', 'kakao', 'whatsapp', 'instagram', 'web', 'all']);

async function getText(url, ms) {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms || 8000);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) return null; return await r.text(); }
  catch (_) { return null; } finally { clearTimeout(tm); }
}

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

// 링크는 정해진 모양만 통과(시트에 이상한 값이 들어가도 화면에 위험한 링크가 안 생기게)
const httpsUrl = (v) => /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : '';
const phone = (v) => { const s = v.replace(/[^\d+]/g, ''); return /^\+?\d{6,16}$/.test(s) ? s : ''; };
function instagram(v) {
  if (!v) return '';
  if (/^https:\/\//i.test(v)) return httpsUrl(v);
  const h = v.replace(/^@/, ''); return /^[\w.]{1,30}$/.test(h) ? `https://www.instagram.com/${h}` : '';
}
function whatsapp(v) {
  if (!v) return '';
  if (/^https:\/\//i.test(v)) return httpsUrl(v);
  const n = v.replace(/\D/g, ''); return n.length >= 6 ? `https://wa.me/${n}` : '';
}

function toShops(text) {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const idx = Object.fromEntries(head.map((h, i) => [h.trim().toLowerCase(), i]));
  const get = (r, k) => (idx[k] != null ? String(r[idx[k]] || '') : '').trim();
  // 만료일: 그 날짜가 지구 어디선가 아직 그날이면 보이게(UTC-12 기준 오늘)
  const today = new Date(Date.now() - 12 * 3600e3).toISOString().slice(0, 10);
  return rows.map(r => {
    const expires = get(r, 'expires');
    if (/^n/i.test(get(r, 'show'))) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(expires) && expires < today) return null;
    const id = get(r, 'id'), name = get(r, 'name');
    if (!/^[\w-]{1,20}$/.test(id) || !name) return null;
    const spots = get(r, 'spots').split(/[;,\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (!spots.length) return null;
    return {
      id, spots, name: name.slice(0, 60),
      phone: phone(get(r, 'phone')), kakao: httpsUrl(get(r, 'kakao')), whatsapp: whatsapp(get(r, 'whatsapp')),
      instagram: instagram(get(r, 'instagram')), web: httpsUrl(get(r, 'web')),
      lang: get(r, 'lang').slice(0, 40), note: get(r, 'note').slice(0, 120),
      paid: /^paid|^유료/i.test(get(r, 'plan')), checked: get(r, 'checked').slice(0, 10)
    };
  }).filter(Boolean);
}

module.exports = async function handler(req, res) {
  const q = req.query || {};
  if (q.svc === 'click') {
    res.setHeader('Cache-Control', 'no-store');
    const id = String(q.id || ''), k = String(q.k || '');
    if (/^[\w-]{1,20}$/.test(id) && KINDS.has(k)) {
      const day = new Date().toISOString().slice(0, 10);
      try { await redisPipeline([['HINCRBY', `sc:${day}`, `${id}|${k}`, 1], ['EXPIRE', `sc:${day}`, String(800 * 86400)]]); } catch (_) {}
    }
    return res.status(204).end();
  }
  const base = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  let text = process.env.SHOPS_CSV_URL ? await getText(process.env.SHOPS_CSV_URL) : null;
  if (!text || !/name/i.test(text.split('\n')[0])) text = await getText(`${base}/data/shops.csv`);
  const shops = text ? toShops(text) : [];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 시트를 고치면 10분 안에 반영(그동안은 저장본을 바로 줌)
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400');
  res.status(200).send(JSON.stringify({ ok: true, count: shops.length, shops }));
};
