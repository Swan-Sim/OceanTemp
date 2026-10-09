// [ADD] 다이빙 로그북 저장. 회원 한 명의 기록은 Redis 해시 ulog:{uid} { 기록id: JSON } 에 모아요(본인만 읽고 쓰기).
//  api/_auth.js 가 로그인 확인 뒤에 a=logs | logsave | logdel 로 불러요.
const C = require('./_credits');
const TANKS = { al80: 11.1, s10: 10, s12: 12, s15: 15, s7: 7, d12: 24, d7: 14, sm80: 22.2 }; // 탱크 종류 → 용량(L). 더블·사이드마운트는 합계
const MAX_LOGS = 2000;
const DAY_LIMIT = 30;      // 24시간 안에 새로 쓸 수 있는 기록 수(몰아서 쓰는 경우를 위해 넉넉히)
const GAP_SECONDS = 10;    // 새 기록 사이 최소 간격(연속 저장 제한)
const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const num = (v, lo, hi, d = 1) => { if (v === '' || v == null) return null; const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) return null; const m = Math.pow(10, d); return Math.round(x * m) / m; };

function clean(b) {
  const no = parseInt(b.no, 10); if (!(no > 0 && no < 100000)) return { error: 'bad_no' };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? String(b.date) : null; if (!date) return { error: 'bad_date' };
  const type = (b.type === 'tec' || b.diverType === 'tec') ? 'tec' : 'rec'; // 기본은 레크리에이션 [FIX] 화면은 type으로 보냄
  const e = {
    no, date, type,
    tod: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.tod)) ? String(b.tod) : '', // 다이빙 시작 시각(HH:MM)
    tank: type === 'tec' && TANKS[b.tank] ? String(b.tank) : '',
    depthMax: num(b.depthMax, 0, 332), depthAvg: num(b.depthAvg, 0, 332), mins: num(b.mins, 0, 1500, 0),
    fill: num(b.fill, 0, 400, 0), remain: num(b.remain, 0, 400, 0),
    weight: num(b.weight, 0, 60), suit: b.suit === 'dry' ? 'dry' : num(b.suit, 0, 12), // [CHANGE] 0 = 슈트 없이, 'dry' = 드라이슈트
    tempAuto: !!b.tempAuto && b.temp !== '' && b.temp != null, // 수온을 자동 추정값 그대로 썼는지
    temp: num(b.temp, -3, 45), vis: num(b.vis, 0, 100, 0),
    buddy: txt(b.buddy, 60), notes: txt(b.notes, 600)
  };
  if (e.depthAvg != null && e.depthMax != null && e.depthAvg > e.depthMax) return { error: 'avg_gt_max' };
  if (e.fill != null && e.remain != null && e.remain > e.fill) return { error: 'remain_gt_fill' };
  return { e };
}

// handler(a, b, uid, R, json) → 처리했으면 true
module.exports = async function logbook(a, b, uid, R, json) {
  const key = 'ulog:' + uid;
  if (a === 'logs') {
    const [arr] = await R(['HGETALL', key]); const all = [];
    if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) { try { all.push(JSON.parse(arr[i + 1])); } catch (_) {} }
    all.sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.at || 0) - (x.at || 0));
    const no = parseInt(b.no, 10);
    const items = no > 0 ? all.filter(x => x.no === no) : all;
    const lim = Math.max(1, Math.min(200, parseInt(b.limit, 10) || 200)); // [ADD] 회원정보 최근 기록용(limit=3)
    json(200, { ok: true, items: items.slice(0, lim), total: all.length, last: all[0] || null }); return true; // last: 가장 최근 기록(웨이트·슈트·탱크 미리 채우기용)
  }
  if (a === 'logsave') {
    const r = clean(b); if (r.error) { json(400, { ok: false, error: r.error }); return true; }
    const e = r.e; let id = txt(b.id, 20).replace(/[^\w]/g, '');
    if (id) { const [old] = await R(['HGET', key, id]); if (!old) { json(404, { ok: false, error: 'not_found' }); return true; } try { e.at = JSON.parse(old).at; } catch (_) {} }
    else {
      // 연속 저장 제한: 새 기록은 10초에 한 번만(SET NX EX가 이미 있으면 거절)
      const [lock] = await R(['SET', 'ulogt:' + uid, '1', 'NX', 'EX', String(GAP_SECONDS)]);
      if (lock !== 'OK') { json(429, { ok: false, error: 'too_fast', wait: GAP_SECONDS }); return true; }
      const [n] = await R(['HLEN', key]); if (n >= MAX_LOGS) { json(400, { ok: false, error: 'too_many' }); return true; }
      const [arr] = await R(['HGETALL', key]); const since = Date.now() - 86400000; let recent = 0;
      if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) { try { if ((JSON.parse(arr[i + 1]).at || 0) >= since) recent++; } catch (_) {} }
      if (recent >= DAY_LIMIT) { json(429, { ok: false, error: 'daily_limit', limit: DAY_LIMIT }); return true; }
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); e.at = Date.now();
    }
    e.id = id; e.upd = Date.now();
    await R(['HSET', key, id, JSON.stringify(e)]);
    let gain = 0; if (!b.id) gain = await C.award(R, uid, 'log'); // 새로 쓸 때만 크레딧(수정은 안 쳐줘요)
    json(200, { ok: true, item: e, gain }); return true;
  }
  if (a === 'logdel') {
    const id = txt(b.id, 20).replace(/[^\w]/g, ''); if (!id) { json(400, { ok: false, error: 'no_id' }); return true; }
    await R(['HDEL', key, id]); json(200, { ok: true }); return true;
  }
  return false;
};
module.exports.TANKS = TANKS;
// 계정 합칠 때 from 의 로그북을 to 로 옮기는 명령들(to 에 같은 id가 있을 일은 없어요)
module.exports.mergeCmds = async function (R, from, to) {
  const [arr] = await R(['HGETALL', 'ulog:' + from]); const cmds = [];
  if (Array.isArray(arr) && arr.length) cmds.push(['HSET', 'ulog:' + to, ...arr]);
  cmds.push(['DEL', 'ulog:' + from]); return cmds;
};
