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
    buddy: txt(b.buddy, 60), notes: txt(b.notes, 600),
    seq: num(b.seq, 1, 99999, 0) // 로그 번호(사용자가 고칠 수 있음)
  };
  if (e.depthAvg != null && e.depthMax != null && e.depthAvg > e.depthMax) return { error: 'avg_gt_max' };
  if (e.fill != null && e.remain != null && e.remain > e.fill) return { error: 'remain_gt_fill' };
  return { e };
}

// handler(a, b, uid, R, json) → 처리했으면 true
// [ADD] 공개 기록 목록(HASH lopen: 기록id → {no, uid, name, date, tod, depthMax, mins, temp, vis, photos, at}) - "기록 공개" 동의한 기록만. 작성자 실명(로그인 계정 이름)을 함께 보여줘요
function pubEntry(e, uid, name) { return { no: e.no, uid, name: String(name || '').slice(0, 40), date: e.date, tod: e.tod || '', depthMax: e.depthMax, mins: e.mins, temp: e.temp, vis: e.vis, type: e.type, notes: String(e.notes || '').slice(0, 140), photos: e.pub ? (e.photos || []).slice(0, 4) : [], at: e.at || Date.now() }; }
module.exports.listOpen = async function (R, no, limit) { // 포인트의 공개 기록(최근 순)
  const [arr] = await R(['HGETALL', 'lopen']); const out = [];
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) { try { const o = JSON.parse(arr[i + 1]); if (!no || o.no === no) out.push(Object.assign({ id: arr[i] }, o)); } catch (_) {} }
  out.sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.at || 0) - (x.at || 0));
  return out.slice(0, limit || 20).map(({ uid, ...rest }) => rest); // 회원 id는 밖으로 안 내보내요
};
module.exports = Object.assign(async function logbook(a, b, uid, R, json, user) {
  const key = 'ulog:' + uid;
  if (a === 'logs') {
    const [arr] = await R(['HGETALL', key]); const all = [];
    if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) { try { all.push(JSON.parse(arr[i + 1])); } catch (_) {} }
    { // 번호가 없는 옛 기록은 날짜 오름차순으로 이어서 번호를 매겨요(저장은 수정할 때)
      const asc = all.slice().sort((x, y) => (x.date || '').localeCompare(y.date || '') || (x.at || 0) - (y.at || 0)); let mx = 0;
      asc.forEach(x => { if (x.seq > 0) mx = Math.max(mx, x.seq); });
      asc.forEach(x => { if (!(x.seq > 0)) x.seq = ++mx; });
    }
    const nextSeq = all.reduce((m, x) => Math.max(m, x.seq || 0), 0) + 1;
    all.sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.at || 0) - (x.at || 0));
    const no = parseInt(b.no, 10);
    const items = no > 0 ? all.filter(x => x.no === no) : all;
    const lim = Math.max(1, Math.min(200, parseInt(b.limit, 10) || 200)), off = Math.max(0, parseInt(b.offset, 10) || 0); // [ADD] 회원정보 목록용 페이지(offset)
    json(200, { ok: true, items: items.slice(off, off + lim), total: all.length, count: items.length, nextSeq, last: all[0] || null }); return true; // last: 가장 최근 기록(웨이트·슈트·탱크 미리 채우기용)
  }
  if (a === 'logsave') {
    const r = clean(b); if (r.error) { json(400, { ok: false, error: r.error }); return true; }
    const e = r.e; let id = txt(b.id, 20).replace(/[^\w]/g, ''), oldE = null;
    if (id) { const [old] = await R(['HGET', key, id]); if (!old) { json(404, { ok: false, error: 'not_found' }); return true; } try { oldE = JSON.parse(old); e.at = oldE.at; } catch (_) {} }
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
    const P = require('./_photos'); // [ADD] 사진(최대 4장, 내 것만) · pub = 지도에 공개
    e.photos = await P.owned(R, uid, b.photos); e.pub = !!b.pub && e.photos.length > 0;
    e.use = !!b.use; e.open = !!b.open; // 동의: 정보 사용(익명 통계) · 기록 공개
    await R(['HSET', key, id, JSON.stringify(e)]);
    try { await P.sync(R, uid, oldE, e, user && user.name); } catch (_) {}
    try { if (e.open) await R(['HSET', 'lopen', id, JSON.stringify(pubEntry(e, uid, user && user.name))]); else await R(['HDEL', 'lopen', id]); } catch (_) {} // 공개 목록 맞추기
    let gain = 0; if (!b.id) gain = await C.award(R, uid, 'log'); // 새로 쓸 때만 크레딧(수정은 안 쳐줘요)
    json(200, { ok: true, item: e, gain }); return true;
  }
  if (a === 'logdel') {
    const id = txt(b.id, 20).replace(/[^\w]/g, ''); if (!id) { json(400, { ok: false, error: 'no_id' }); return true; }
    const [old] = await R(['HGET', key, id]); await R(['HDEL', key, id], ['HDEL', 'lopen', id]);
    try { if (old) await require('./_photos').sync(R, uid, JSON.parse(old), null); } catch (_) {}
    json(200, { ok: true }); return true;
  }
  return false;
}, module.exports);
module.exports.TANKS = TANKS;
// 계정 합칠 때 from 의 로그북을 to 로 옮기는 명령들(to 에 같은 id가 있을 일은 없어요)
module.exports.mergeCmds = async function (R, from, to) {
  const [arr] = await R(['HGETALL', 'ulog:' + from]); const cmds = [];
  if (Array.isArray(arr) && arr.length) cmds.push(['HSET', 'ulog:' + to, ...arr]);
  cmds.push(['DEL', 'ulog:' + from]); return cmds;
};
