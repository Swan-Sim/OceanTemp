// [ADD] 포인트별 조류 보정(관리자 입력) - 바다 모델이 못 잡는 섬·해협 조류를 현지 지식으로 보정해요.
//  Redis: curfix:v1 (포인트번호 → JSON). 값은 조석에 비례: 조위가 시간당 REF_RATE(0.3m) 변할 때의 노트를 적으면, 실제 변화율에 맞춰 늘고 줄어요.
//  { floodTo: 밀물(조위 오르는 중) 때 흘러가는 방향(도), floodKn: 그때 노트, ebbTo/ebbKn: 썰물, lagH: 조위→조류 지연(시간), bgW: 모델 배경 가중치(0~1), note, at }
const KEY = 'curfix:v1', REF_RATE = 0.3;
const num = (v, lo, hi, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
async function list(R) {
  const [arr] = await R(['HGETALL', KEY]), out = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) { try { out[arr[i]] = JSON.parse(arr[i + 1]); } catch (_) {} }
  return { ok: true, ref: REF_RATE, spots: out };
}
async function save(R, b) {
  const no = parseInt(b.no, 10); if (!(no > 0 && no < 100000)) return { ok: false, error: 'bad_no' };
  if (b.remove) { await R(['HDEL', KEY, String(no)]); return { ok: true, removed: true }; }
  const cfg = {
    floodTo: num(b.floodTo, 0, 360, null), floodKn: num(b.floodKn, 0, 10, 0),
    ebbTo: num(b.ebbTo, 0, 360, null), ebbKn: num(b.ebbKn, 0, 10, 0),
    lagH: num(b.lagH, -3, 6, 0.5), bgW: num(b.bgW, 0, 1, 0.25),
    note: String(b.note || '').slice(0, 200), at: Date.now()
  };
  if (cfg.floodTo == null && cfg.ebbTo == null) return { ok: false, error: 'need_dir' };
  if (cfg.floodTo == null) cfg.floodTo = (cfg.ebbTo + 180) % 360; if (cfg.ebbTo == null) cfg.ebbTo = (cfg.floodTo + 180) % 360;
  await R(['HSET', KEY, String(no), JSON.stringify(cfg)]);
  return { ok: true, cfg };
}
module.exports = { list, save, REF_RATE };
