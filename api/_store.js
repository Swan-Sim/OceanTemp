// [ADD] 다이빙샵·정점 등록 데이터 저장소(Upstash Redis) 공용 도우미.
// 키
//   shops:v1    해시 { 샵id: JSON }        승인된 샵(사이트에 보이는 원본)
//   shopreq:v1  해시 { 요청id: JSON }      승인 대기(새 등록 'n…', 수정 'e{샵id}')
//   shoptok:v1  해시 { 링크해시: 's:샵id' | 'r:요청id' }  수정 전용 링크(원문은 저장 안 하고 해시만)
//   shops:seq   새 샵 번호
//   spots:extra 해시 { 정점번호: JSON }    승인된 사용자 등록 정점(구글 시트 정점에 더해져요)
//   spotreq:v1  해시 { 요청id: JSON }      정점 등록 대기
const crypto = require('crypto');
const { redisPipeline } = require('./_redis');

const K = { reports: 'shoprep:v1', shops: 'shops:v1', req: 'shopreq:v1', tok: 'shoptok:v1', seq: 'shops:seq', spots: 'spots:extra', spotreq: 'spotreq:v1' };
const STATION_SHEET = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSN3HofGgc9HEUOIag-2EQpPnpJ9gZi2DTXLvu1t9LP3WAeAe-IYIFmJ6H_buloREnhfLsbWWRN9S9j/pub?output=csv';

async function R(...cmds) {
  const out = await redisPipeline(cmds);
  out.forEach(x => { if (x && x.error) throw new Error('Redis: ' + x.error); });
  return out.map(x => x.result);
}
async function hgetallJSON(key) {
  const [arr] = await R(['HGETALL', key]);
  const o = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) { try { o[arr[i]] = JSON.parse(arr[i + 1]); } catch (_) {} }
  return o;
}

// ── 입력 정리(시트·폼·관리자 어디서 와도 같은 규칙) ──
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const httpsUrl = (v) => { v = str(v, 300); return /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : ''; };
const phone = (v) => { const s = str(v, 40).replace(/[^\d+]/g, ''); return /^\+?\d{6,16}$/.test(s) ? s : ''; };
function instagram(v) {
  v = str(v, 300); if (!v) return '';
  if (/^https:\/\//i.test(v)) return httpsUrl(v);
  const h = v.replace(/^@/, ''); return /^[\w.]{1,30}$/.test(h) ? `https://www.instagram.com/${h}` : '';
}
function whatsapp(v) {
  v = str(v, 300); if (!v) return '';
  if (/^https:\/\//i.test(v)) return httpsUrl(v);
  const n = v.replace(/\D/g, ''); return n.length >= 6 ? `https://wa.me/${n}` : '';
}
const email = (v) => { v = str(v, 120).toLowerCase(); return /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/.test(v) ? v : ''; };
const MAX_SPOTS = 5; // [CHANGE] 샵 하나당 포인트는 5곳까지
const spotList = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[;,\s]+/)).map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 100000))].slice(0, MAX_SPOTS);
// [ADD] 요금제: trial = 무료(제한, 1년 뒤 종료) · friend = 무료(지인, 기간 없음) · paid = 유료. 예전 'free'는 지인으로 봄
const planOf = (v) => { v = String(v || '').toLowerCase(); return /^paid|^유료/.test(v) ? 'paid' : /^trial|제한|체험/.test(v) ? 'trial' : /^friend|^free|지인|^무료/.test(v) ? 'friend' : 'trial'; };
// [ADD] 약관 버전(terms/index.html과 같게). 바꾸면 기존 샵은 다음 수정 때 다시 동의
const TERMS_VERSION = '2026-10-03';
// [ADD] 유료화는 2028-01-01부터. 그 전 무료(제한)는 2027-12-31까지, 이후엔 1년
const PAID_START = '2028-01-01';
const defaultExpires = (plan) => plan === 'friend' ? '' : plan === 'paid' ? plusYear()
  : (new Date().toISOString().slice(0, 10) < PAID_START ? '2027-12-31' : plusYear());
const PLAN_KO = { trial: '무료(제한)', friend: '무료(지인)', paid: '유료' };
const plusYear = (from) => { const d = from ? new Date(from) : new Date(); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); };
const dateStr = (v) => { v = str(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; };

// 샵이 직접 고칠 수 있는 칸
function shopFields(b) {
  b = b || {};
  return {
    name: str(b.name, 60), spots: spotList(b.spots),
    phone: phone(b.phone), kakao: httpsUrl(b.kakao), whatsapp: whatsapp(b.whatsapp),
    instagram: instagram(b.instagram), web: httpsUrl(b.web),
    address: str(b.address, 160), lang: str(b.lang, 40), note: str(b.note, 120)
  };
}
const hasContact = (f) => !!(f.phone || f.kakao || f.whatsapp || f.instagram || f.web);

// 사이트에 보내는 칸(이메일·링크해시 등은 절대 안 보냄)
function publicShop(s) {
  return { id: String(s.id), spots: s.spots || [], name: s.name, phone: s.phone || '', kakao: s.kakao || '', whatsapp: s.whatsapp || '',
    instagram: s.instagram || '', web: s.web || '', address: s.address || '', lang: s.lang || '', note: s.note || '',
    paid: s.plan === 'paid', checked: s.checked || '' };
}
// 만료일: 그 날짜가 지구 어디선가 아직 그날이면 보임(UTC-12 기준 오늘)
const todayLoose = () => new Date(Date.now() - 12 * 3600e3).toISOString().slice(0, 10);
const isLive = (s) => s && s.show !== false && !(s.expires && s.expires < todayLoose());

// 수정 전용 링크: 원문은 한 번만 보여주고 서버엔 해시만 저장
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function newToken() { const token = crypto.randomBytes(24).toString('base64url'); return { token, hash: sha(token) }; }
const editUrl = (base, token) => `${base}/shop/#t=${token}`;

// 정점 칸
function spotFields(b) {
  b = b || {};
  const lat = +b.lat, lon = +b.lon;
  return {
    name: str(b.name, 80), label: str(b.label, 30) || str(b.name, 30), country: str(b.country, 40),
    lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? +lat.toFixed(5) : null,
    lon: Number.isFinite(lon) && Math.abs(lon) <= 180 ? +lon.toFixed(5) : null,
    note: str(b.note, 300)
  };
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
function csvObjects(text) {
  const [head, ...rows] = parseCsv(text || '');
  if (!head) return [];
  const keys = head.map(h => h.trim().toLowerCase());
  return rows.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()])));
}
async function getText(url, ms) {
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), ms || 10000);
  try { const r = await fetch(url, { signal: c.signal, redirect: 'follow' }); if (!r.ok) return null; return await r.text(); }
  catch (_) { return null; } finally { clearTimeout(tm); }
}
// 구글 시트 정점 중 가장 큰 번호(새 정점 번호를 겹치지 않게)
async function sheetMaxNo() {
  const text = await getText(STATION_SHEET, 10000);
  return Math.max(0, ...csvObjects(text).map(o => parseInt(o.no, 10) || 0));
}

// 메일(Resend). RESEND_API_KEY 없으면 보내지 않고 false
async function sendMail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM || 'otemp.app <onboarding@resend.dev>', to: [to], subject, html })
    });
    return r.ok;
  } catch (_) { return false; }
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baseOf = (req) => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

module.exports = { TERMS_VERSION, PAID_START, defaultExpires, MAX_SPOTS, planOf, PLAN_KO, plusYear, K, R, hgetallJSON, shopFields, hasContact, publicShop, isLive, sha, newToken, editUrl, spotFields, email, dateStr, str,
  csvObjects, getText, sheetMaxNo, sendMail, esc, baseOf, STATION_SHEET };
