const csv = 'id,spots,name,phone,kakao,whatsapp,instagram,web,lang,note,plan,expires,checked,show\r\n1,"253;254",A샵,+82-64-000-0000,https://pf.kakao.com/_x,,@abc.dive,https://a.com,ko,노트,paid,2099-01-01,2026-10,Y\r\n2,253,B샵,010 1234 5678,javascript:alert(1),82101234,,http://x.com,,,free,,,\r\n3,253,만료샵,1,,,,,,,paid,2020-01-01,,\r\n4,253,숨김,1,,,,,,,paid,,,N\r\n';
global.fetch = async (u) => ({ ok: true, text: async () => csv });
process.env.SHOPS_CSV_URL = 'https://x';
require.cache[require.resolve('./api/_redis')] = { exports: { redisPipeline: async (c) => { console.log('REDIS', JSON.stringify(c)); return []; } } };
const h = require('./api/shops.js');
const mk = (query) => ({ query, headers: { host: 'x' } });
const res = { setHeader(){}, status(c){ this.c=c; return this; }, send(b){ console.log(this.c, b); }, end(){ console.log(this.c,'end'); } };
(async () => { await h(mk({}), res); await h(mk({ svc:'click', id:'1', k:'tel' }), res); await h(mk({ svc:'click', id:'1;x', k:'tel' }), res); })();
