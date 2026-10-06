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
// [ADD] 코드에 넣어 둔 기본 포인트(구글 시트에 없어도 보임). 시트에 같은 번호가 생기면 시트 쪽이 우선.
//   서울시 한강 수질 자동측정소 4곳 - 좌표는 하천 하류 대략 위치
const BUILTIN_SPOTS = [
  { no: 265, country: 'South Korea', name: '한강 선유 관측지점', label: '선유', lat: 37.5438, lon: 126.8975, network: 'River/Seoul' },
  { no: 266, country: 'South Korea', name: '안양천 관측지점', label: '안양천', lat: 37.5360, lon: 126.8830, network: 'River/Seoul' },
  { no: 267, country: 'South Korea', name: '중랑천 관측지점', label: '중랑천', lat: 37.5440, lon: 127.0230, network: 'River/Seoul' },
  { no: 268, country: 'South Korea', name: '탄천 관측지점', label: '탄천', lat: 37.5150, lon: 127.0710, network: 'River/Seoul' }
];
// (아래 STATION_SHEET는 관리 페이지로 옮기기 전까지만 읽어요)
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
// [CHANGE] 샵 하나당 포인트: 다이브샵 20곳, 리브어보드 40곳. 언어는 5개까지
const MAX_SPOTS = 20, MAX_SPOTS_LIVEABOARD = 40, MAX_LANGS = 5;
const shopType = (v) => { v = String(v || '').toLowerCase(); return v === 'liveaboard' || v === 'pool' ? v : 'shop'; }; // [ADD] pool = 다이빙 풀장
const maxSpotsFor = (type) => shopType(type) === 'liveaboard' ? MAX_SPOTS_LIVEABOARD : shopType(type) === 'pool' ? 0 : MAX_SPOTS;
const spotList = (v, max = MAX_SPOTS) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[;,\s]+/)).map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 100000))].slice(0, max);
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

// [ADD] 가능한 언어: "ko,en,ja" 코드로 저장(5개까지). 예전 글자 입력("한국어 · English")은 그대로 둠
function langList(v) {
  v = str(v, 60);
  const codes = v.toLowerCase().split(/[,\s]+/).filter(Boolean);
  if (codes.length && codes.every(c => /^[a-z]{2,3}$/.test(c))) return [...new Set(codes)].slice(0, MAX_LANGS).join(',');
  return str(v, 40);
}

// 샵이 직접 고칠 수 있는 칸
function shopFields(b) {
  b = b || {};
  const type = shopType(b.type);
  return {
    name: str(b.name, 60), type, spots: spotList(b.spots, maxSpotsFor(type)),
    phone: phone(b.phone), kakao: httpsUrl(b.kakao), whatsapp: whatsapp(b.whatsapp),
    instagram: instagram(b.instagram), web: httpsUrl(b.web),
    address: str(b.address, 160), lang: langList(b.lang), note: str(b.note, 120),
    ...(type === 'pool' ? poolFields(b) : {})
  };
}
// [ADD] 풀장 칸: 위치(지도 핀) · 최대 수심 · 수온 · 실내/실외/계절 · 용도 · 입장 방식 · 운영시간 · 가격
const POOL_USES = ['scuba', 'free', 'edu', 'photo'];
function poolFields(b) {
  const num = (v, lo, hi, d) => { const n = parseFloat(v); return Number.isFinite(n) && n >= lo && n <= hi ? +n.toFixed(d) : null; };
  const lat = num(b.lat, -90, 90, 5), lon = num(b.lon, -180, 180, 5);
  const uses = (Array.isArray(b.uses) ? b.uses : String(b.uses || '').split(/[,\s]+/)).map(x => String(x).toLowerCase()).filter(x => POOL_USES.includes(x));
  return { lat, lon, depthMax: num(b.depthMax, 0.5, 150, 1), waterTemp: num(b.waterTemp, 5, 40, 1),
    env: ['in', 'out', 'season'].includes(b.env) ? b.env : '', uses: [...new Set(uses)].join(','),
    entry: ['open', 'shop'].includes(b.entry) ? b.entry : '', hours: str(b.hours, 120), price: str(b.price, 80) };
}
// 등록 가능한지: 이름 + (풀장은 위치, 샵·리브어보드는 포인트 하나 이상)
const shopValid = (f) => !!(f && f.name && (f.type === 'pool' ? f.lat != null && f.lon != null : f.spots && f.spots.length));
const hasContact = (f) => !!(f.phone || f.kakao || f.whatsapp || f.instagram || f.web);

// 사이트에 보내는 칸(이메일·링크해시 등은 절대 안 보냄)
function publicShop(s) {
  return { id: String(s.id), type: shopType(s.type), spots: s.spots || [], name: s.name, phone: s.phone || '', kakao: s.kakao || '', whatsapp: s.whatsapp || '',
    instagram: s.instagram || '', web: s.web || '', address: s.address || '', lang: s.lang || '', note: s.note || '',
    paid: s.plan === 'paid', checked: s.checked || '',
    ...(shopType(s.type) === 'pool' ? { lat: s.lat, lon: s.lon, depthMax: s.depthMax ?? null, waterTemp: s.waterTemp ?? null, env: s.env || '', uses: s.uses || '', entry: s.entry || '', hours: s.hours || '', price: s.price || '' } : {}) };
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
// ───────── [ADD] 전체 포인트 목록(관리 페이지에서 직접 관리) ─────────
//  spots:migrated 가 있으면 → Redis spots:extra 해시 하나가 전체 목록(구글 시트 안 씀)
//  없으면(옮기기 전) → 예전처럼 구글 시트(+저장소 data/stations.csv 대체) + 사용자 등록 + 기본 포인트
const MIGRATED_KEY = 'spots:migrated';
// 이름 군더더기(이모지, "다이빙포인트" 등) 빼기 - 앱 js/stations.js cleanSpotName과 같은 규칙
function cleanName(n) {
  const out = String(n || '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s*\((다이빙|다이빙\s*포인트|diving|dive)\)/gi, '')
    .replace(/\s*(다이빙\s*포인트|다이빙\s*스팟|diving\s*(area|site|spot|point)|dive\s*(site|spot|point))(?=\s*(\(|$))/gi, '').replace(/\s{2,}/g, ' ').trim();
  return out || String(n || '').trim();
}
const truthy = (v, def) => v === undefined || v === null || v === '' ? def : !(v === false || /^(n|no|false|0)$/i.test(String(v).trim()));
function normSpot(o) {
  const no = parseInt(o.no, 10), lat = +o.lat, lon = +o.lon;
  if (!(no > 0) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { no, country: str(o.country, 40), name: str(o.name, 80), label: str(o.label, 30) || str(o.name, 30), lat: +lat.toFixed(5), lon: +lon.toFixed(5),
    network: str(o.network, 40) || 'Beach/local', depth: truthy(o.depth, true), show: truthy(o.show, true) };
}
async function legacySpots(base) {
  let text = await getText(STATION_SHEET, 8000);
  if ((!text || !/(^|,)lat(,|$)/im.test(text.split('\n')[0])) && base) text = await getText(`${base}/data/stations.csv`, 8000);
  const out = new Map();
  csvObjects(text || '').forEach(r => { const s = normSpot(r); if (s && !out.has(s.no)) out.set(s.no, s); });
  try { Object.values(await hgetallJSON(K.spots)).forEach(r => { const s = normSpot({ ...r, network: r.network || 'Beach/user' }); if (s && !out.has(s.no)) out.set(s.no, s); }); } catch (_) {}
  BUILTIN_SPOTS.forEach(b => { if (!out.has(b.no)) out.set(b.no, normSpot(b)); });
  return [...out.values()];
}
let spotsMemo = null;
async function allSpots(base, opts) {
  opts = opts || {};
  if (!opts.fresh && spotsMemo && Date.now() - spotsMemo.at < 60e3) return opts.hidden ? spotsMemo.list : spotsMemo.list.filter(s => s.show);
  let list, migrated = false;
  try { const [m] = await R(['GET', MIGRATED_KEY]); migrated = !!m; } catch (_) {}
  if (migrated) list = Object.values(await hgetallJSON(K.spots)).map(normSpot).filter(Boolean);
  else list = await legacySpots(base);
  list.sort((a, b) => a.no - b.no);
  spotsMemo = { at: Date.now(), list, migrated };
  return opts.hidden ? list : list.filter(s => s.show);
}
async function spotsMigrated() { try { const [m] = await R(['GET', MIGRATED_KEY]); return !!m; } catch (_) { return false; } }
async function nextSpotNo(base) { const all = await allSpots(base, { hidden: true, fresh: true }); return Math.max(0, ...all.map(s => s.no), ...BUILTIN_SPOTS.map(b => b.no)) + 1; }
function clearSpotsMemo() { spotsMemo = null; }

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
// [ADD] 관리자 설정(비밀번호·이메일)을 관리 페이지에서 바꿀 수 있게 Redis에 저장(admin:cfg).
//  - 비밀번호는 원문 대신 scrypt 해시만 저장. 한 번 바꾸면 Vercel의 ADMIN_PASSWORD는 더 이상 안 통해요.
//  - 비밀번호를 잊으면 Upstash 콘솔에서 admin:cfg 키를 지우면 다시 ADMIN_PASSWORD로 들어갈 수 있어요.
//  - 이메일은 여기 값이 있으면 그걸, 없으면 ADMIN_EMAIL 환경변수를 써요.
async function adminCfg() { try { const [v] = await R(['GET', 'admin:cfg']); return v ? JSON.parse(v) : {}; } catch (_) { return {}; } }
function hashPw(pw, salt) { salt = salt || crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex'); }
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
async function checkAdminPw(pw) {
  if (!pw) return false;
  const c = await adminCfg();
  if (c.pwHash) return safeEq(hashPw(pw, c.pwHash.split(':')[0]), c.pwHash);
  return !!process.env.ADMIN_PASSWORD && safeEq(pw, process.env.ADMIN_PASSWORD);
}
async function adminEmail() { const c = await adminCfg(); return c.email || process.env.ADMIN_EMAIL || ''; }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baseOf = (req) => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

module.exports = { adminCfg, hashPw, checkAdminPw, adminEmail, TERMS_VERSION, PAID_START, defaultExpires, MAX_SPOTS, MAX_SPOTS_LIVEABOARD, maxSpotsFor, shopType, shopValid, POOL_USES, planOf, PLAN_KO, plusYear, K, R, hgetallJSON, shopFields, hasContact, publicShop, isLive, sha, newToken, editUrl, spotFields, email, dateStr, str,
  csvObjects, getText, sheetMaxNo, sendMail, esc, baseOf, STATION_SHEET, BUILTIN_SPOTS,
  allSpots, legacySpots, normSpot, cleanName, spotsMigrated, nextSpotNo, clearSpotsMemo, MIGRATED_KEY };
