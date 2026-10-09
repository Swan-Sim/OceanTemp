const path = require('path'); const root = path.resolve(__dirname, '../..');
const db = {};
const h = (k) => (db[k] = db[k] || {});
require.cache[require.resolve(root + '/api/_redis')] = { exports: { redisPipeline: async (cmds) => cmds.map(([c, k, f, v]) => {
  if (c === 'HSET') { h(k)[f] = v; return { result: 1 }; }
  if (c === 'HGET') return { result: (db[k] || {})[f] ?? null };
  if (c === 'HDEL') { delete h(k)[f]; return { result: 1 }; }
  if (c === 'HGETALL') return { result: Object.entries(db[k] || {}).flat() };
  if (c === 'INCR') { db[k] = (+db[k] || 0) + 1; return { result: db[k] }; }
  if (c === 'HINCRBY') { h(k)[f] = (+h(k)[f] || 0) + v; return { result: 1 }; }
  return { result: 1 };
}) } };
global.fetch = async (u) => ({ ok: true, text: async () => u.includes('pub?output=csv') ? 'no,name,lat,lon\n1,a,1,1\n254,b,2,2\n' : 'id,spots,name,phone,kakao,whatsapp,instagram,web,lang,note,plan,expires,checked,show,address\r\n1,39;254;253,다이브랜드,+82-507-1362-2187,https://pf.kakao.com/diverji,,@diveland_official,,한국어 · English,문섬·섶섬·범섬 보트 · 체험 다이빙,free,2027-10-02,2026-10,Y,제주특별자치도 서귀포시 보목포로 29 (보목동)' });
process.env.ADMIN_PASSWORD = 'pw';
const shops = require(root + '/api/shops.js'), stats = require(root + '/api/stats.js');
const call = (fn, method, query, body, hdr) => new Promise(resolve => {
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; }, json(o) { resolve([this.c, o]); }, send(b) { resolve([this.c, JSON.parse(b)]); }, end() { resolve([this.c]); } };
  fn({ method, query, body, headers: { host: 'otemp.app', 'x-forwarded-for': '1.2.3.4', ...(hdr || {}) } }, res);
});
const A = (svc, body) => call(stats, 'POST', { svc }, body, { 'x-admin-password': 'pw' });
(async () => {
  let r;
  r = await call(shops, 'POST', { svc: 'register' }, { name: '<b>테스트샵</b>', spots: '253;999', phone: '010-1234-5678', email: 'A@x.com', agree: true, terms: '2026-10-03', kakao: 'javascript:alert(1)' });
  console.log('register', r[0], !!r[1].token); const tok = r[1].token;
  console.log('noauth', (await call(stats, 'POST', { svc: 'list' }, {}, { 'x-admin-password': 'no' }))[0]);
  r = await call(shops, 'POST', { svc: 'me' }, { t: tok }); console.log('me', r[1].status, r[1].data.kakao === '', r[1].data.name);
  r = await call(shops, 'POST', { svc: 'edit' }, { t: tok, name: '테스트샵2', spots: [253], phone: '0101234', email: 'a@x.com' }); console.log('edit pending_new', r[1].status);
  r = await A('list'); const rq = r[1].reqs[0]; console.log('list reqs', r[1].reqs.length, rq.data.name, 'tok hidden', !('tok' in rq));
  r = await A('shopApprove', { reqId: rq.id, plan: 'paid', expires: '2027-10-03' }); console.log('approve', r[1]);
  r = await call(shops, 'GET', {}, {}); console.log('public', r[1].count, r[1].shops[0].name, r[1].shops[0].paid, 'email leak', JSON.stringify(r[1]).includes('x.com'));
  r = await call(shops, 'POST', { svc: 'me' }, { t: tok }); console.log('me after approve', r[1].status);
  r = await call(shops, 'POST', { svc: 'edit' }, { t: tok, name: '바뀐이름', spots: [253, 254], phone: '0101234', email: 'a@x.com' }); console.log('edit', r[1].status);
  r = await call(shops, 'GET', {}, {}); console.log('still old until approve', r[1].shops[0].name);
  r = await A('list'); r = await A('shopApprove', { reqId: r[1].reqs[0].id }); r = await call(shops, 'GET', {}, {}); console.log('after edit approve', r[1].shops[0].name, r[1].shops[0].spots, r[1].shops[0].paid);
  r = await A('shopLink', { id: '1' }); console.log('newlink', r[1].url.startsWith('https://otemp.app/shop/#t='));
  r = await call(shops, 'POST', { svc: 'me' }, { t: tok }); console.log('old link dead', r[0]);
  r = await A('shopImport', { url: 'https://docs.google.com/spreadsheets/d/10hYBsx5ndeMaALef1G7RREZ0jfgpoMf7OjQBrr9y2AI/edit?usp=sharing' }); console.log('import', r[1]);
  r = await call(shops, 'GET', {}, {}); console.log('public', r[1].shops.map(s => s.name + ' ' + s.spots + ' ' + s.address));
  r = await call(shops, 'POST', { svc: 'spot' }, { name: '새 포인트', lat: 33.1, lon: 126.2, email: 'b@y.com' }); console.log('spot', r[1]);
  r = await A('list'); r = await A('spotApprove', { reqId: r[1].spotreqs[0].id }); console.log('spot approve', r[1]);
  r = await call(shops, 'GET', { svc: 'spots' }, {}); console.log('spots', JSON.stringify(r[1].spots));
  r = await A('shopSave', { id: '1', name: '바뀐이름', spots: [253], phone: '0101234', email: 'a@x.com', plan: 'paid', expires: '2020-01-01' }); r = await call(shops, 'GET', {}, {}); console.log('expired hidden', r[1].shops.map(s => s.name));
  for (let i = 0; i < 6; i++) r = await call(shops, 'POST', { svc: 'register' }, { name: 'x', spots: '1', phone: '0101234567', email: 'a@x.com', agree: true }); console.log('ratelimit', r[0]);
})();
setTimeout(async () => {
  let r = await call(shops, 'POST', { svc: 'register' }, { name: 'noterms', spots: '1', phone: '0101234567', email: 'z@x.com', agree: true });
  console.log('no terms ->', r[0], r[1].error);
  // 가져온 샵(약관 없음) 수정 시 동의 필요
  r = await A('shopLink', { id: '2' }); const t = r[1].url.split('#t=')[1];
  r = await call(shops, 'POST', { svc: 'me' }, { t }); console.log('imported termsOk', r[1].termsOk);
  r = await call(shops, 'POST', { svc: 'edit' }, { t, name: '다이브랜드', spots: [253], phone: '0101234567', email: 'd@x.com' }); console.log('edit w/o terms', r[1].error);
  r = await call(shops, 'POST', { svc: 'edit' }, { t, name: '다이브랜드', spots: [253], phone: '0101234567', email: 'd@x.com', terms: '2026-10-03' }); console.log('edit with terms', r[1].status);
  r = await A('list'); const rq = r[1].reqs.find(x => x.type === 'edit'); await A('shopApprove', { reqId: rq.id });
  r = await A('list'); console.log('terms saved', r[1].shops.find(s => s.id === '2').terms);
}, 1500);
setTimeout(async () => {
  let r = await call(shops, 'POST', { svc: 'report' }, { id: '2', reason: 'owner_changed', who: 'owner', detail: '9월에 인수했어요', email: 'new@owner.com' }, { 'x-forwarded-for': '9.9.9.9' });
  console.log('report', r[1]);
  r = await call(shops, 'POST', { svc: 'report' }, { id: '2', reason: 'bad', who: 'owner', detail: 'x', email: 'a@b.com' }, { 'x-forwarded-for': '9.9.9.9' }); console.log('bad reason', r[1].error);
  r = await A('list'); const rp = r[1].reports[0]; console.log('reports', r[1].reports.length, rp.shopName, rp.reason);
  r = await A('reportTransfer', { id: rp.id }); const t = r[1].url.split('#t=')[1]; console.log('transfer url', !!t);
  r = await call(shops, 'POST', { svc: 'me' }, { t }); console.log('new owner me', r[1].email, 'termsOk', r[1].termsOk);
  r = await A('list'); console.log('reports left', r[1].reports.length, 'shop email', r[1].shops.find(s => s.id === '2').email);
}, 3000);
