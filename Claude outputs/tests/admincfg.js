const path = require('path'); const root = path.resolve(__dirname, '../..');
const kv = {};
require.cache[require.resolve(root + '/api/_redis')] = { exports: { redisPipeline: async (cmds) => cmds.map(([c, k, v]) => c === 'GET' ? { result: kv[k] ?? null } : c === 'SET' ? (kv[k] = v, { result: 'OK' }) : { result: null }) } };
process.env.ADMIN_PASSWORD = 'envpw'; process.env.ADMIN_EMAIL = 'env@x.com';
const stats = require(root + '/api/stats.js');
const call = (pw, svc, body) => new Promise(r => { const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(o) { r([this.c, o]); } }; stats({ method: 'POST', query: { svc }, body, headers: { host: 'x', 'x-admin-password': pw } }, res); });
(async () => {
  console.log('settings', (await call('envpw', 'settings', {}))[1]);
  console.log('short', (await call('envpw', 'setPassword', { current: 'envpw', next: 'short', confirm: 'short' }))[1].error);
  console.log('wrong cur', (await call('envpw', 'setPassword', { current: 'nope', next: 'longpassword1', confirm: 'longpassword1' }))[1].error);
  console.log('set', (await call('envpw', 'setPassword', { current: 'envpw', next: 'longpassword1', confirm: 'longpassword1' }))[1]);
  console.log('old pw now', (await call('envpw', 'settings', {}))[0]);
  console.log('new pw', (await call('longpassword1', 'settings', {}))[1].pwFrom);
  console.log('email', (await call('longpassword1', 'setEmail', { email: 'Me@New.com', current: 'longpassword1' }))[1]);
  console.log('clear email', (await call('longpassword1', 'setEmail', { email: '', current: 'longpassword1' }))[1]);
  console.log('stored', kv['admin:cfg'].slice(0, 60));
})();
