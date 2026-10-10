// [ADD] Cloudflare R2(S3 호환) 저장소 도우미 - 추가 패키지 없이 AWS 서명 v4를 직접 만들어요.
//  Vercel 환경변수: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (키 값은 코드에 없음)
//  수심·해안선처럼 크고 잘 안 바뀌는 캐시를 Redis 대신 여기에 둬요. 만료는 메타데이터(x-amz-meta-exp, 초)로 직접 확인.
const crypto = require('crypto');
const ACC = process.env.R2_ACCOUNT_ID, AK = process.env.R2_ACCESS_KEY_ID, SK = process.env.R2_SECRET_ACCESS_KEY, BUCKET = process.env.R2_BUCKET;
const on = !!(ACC && AK && SK && BUCKET);
const HOST = on ? `${ACC}.r2.cloudflarestorage.com` : '';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function sign(method, key, payload, extra, now, o) {
  o = o || {}; const host = o.host || HOST, region = o.region || 'auto', svc = o.service || 's3', sk = o.sk || SK, ak = o.ak || AK;
  const amzDate = (now || new Date()).toISOString().replace(/[:-]|\.\d{3}/g, ''), date = amzDate.slice(0, 8);
  const path = o.path || ('/' + enc(BUCKET) + '/' + enc(key));
  const ph = sha(payload || '');
  const h = Object.assign({ host, 'x-amz-content-sha256': ph, 'x-amz-date': amzDate }, extra || {});
  const names = Object.keys(h).map(n => n.toLowerCase()).sort();
  const lower = {}; Object.keys(h).forEach(n => { lower[n.toLowerCase()] = String(h[n]).trim(); });
  const signed = names.join(';');
  const canon = [method, path, '', names.map(n => `${n}:${lower[n]}`).join('\n') + '\n', signed, ph].join('\n');
  const scope = `${date}/${region}/${svc}/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canon)].join('\n');
  const kS = hmac(hmac(hmac(hmac('AWS4' + sk, date), region), svc), 'aws4_request');
  const sig = crypto.createHmac('sha256', kS).update(sts).digest('hex');
  delete lower.host; // fetch가 같은 값으로 넣어줌
  lower.authorization = `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signed}, Signature=${sig}`;
  return { url: `https://${host}${path}`, headers: lower };
}
async function call(method, key, payload, extra) {
  const { url, headers } = sign(method, key, payload, extra);
  const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
  try { return await fetch(url, { method, headers, body: payload == null ? undefined : payload, signal: c.signal }); } finally { clearTimeout(t); }
}
const alive = (r) => { const e = +r.headers.get('x-amz-meta-exp'); return !e || e * 1000 > Date.now(); };
// 문자열 또는 null(없음·만료)
async function get(key) { const r = await call('GET', key); if (r.status === 404) return null; if (!r.ok) throw new Error('R2 GET ' + r.status); if (!alive(r)) return null; return r.text(); }
async function exists(key) { const r = await call('HEAD', key); if (r.status === 404) return false; if (!r.ok) throw new Error('R2 HEAD ' + r.status); return alive(r); }
async function put(key, text, ttlSec) {
  const body = Buffer.from(String(text), 'utf8');
  const extra = { 'content-type': 'application/json' }; if (ttlSec) extra['x-amz-meta-exp'] = String(Math.floor(Date.now() / 1000) + (+ttlSec));
  const r = await call('PUT', key, body, extra); if (!r.ok) throw new Error('R2 PUT ' + r.status + ' ' + (await r.text()).slice(0, 200)); return true;
}
async function del(key) { const r = await call('DELETE', key); return r.ok || r.status === 404; }
// [ADD] 사진 같은 바이너리 저장/읽기(로그북 사진: lph/{회원}/{사진}_t|_b)
async function putBin(key, buf, ctype) {
  const r = await call('PUT', key, buf, { 'content-type': ctype || 'application/octet-stream' });
  if (!r.ok) throw new Error('R2 PUT ' + r.status + ' ' + (await r.text()).slice(0, 200)); return true;
}
async function getBin(key) {
  const r = await call('GET', key); if (r.status === 404) return null; if (!r.ok) throw new Error('R2 GET ' + r.status);
  return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'image/jpeg' };
}
module.exports = { on, get, put, exists, del, putBin, getBin, _sign: sign };
