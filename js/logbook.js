// [ADD] 다이빙 로그북 - 아래 패널의 "로그북" 탭. 로그인한 회원 본인만 볼 수 있고, 포인트(정점)별로 지난 기록이 쌓여요.
//  서버: api/_logbook.js (주소 /api/shops?svc=auth&a=logs|logsave|logdel)
//  분당 공기소비량(SAC) = (충전압 − 잔압) ÷ 다이빙 시간 ÷ (평균수심/10 + 1)   → bar/분(수면 기준)
//  탱크를 고르면(텍다이버) 용량을 곱해 L/분(RMV)도 보여줘요.
(function () {
  const KO = typeof lang === 'undefined' || lang === 'ko';
  const T = KO ? {
    tab: '로그북', title: (n) => `내 로그북 · ${n}`, add: '+ 새 기록', login: '로그인하고 쓰기', needLogin: '로그북은 로그인하면 쓸 수 있어요. 같은 포인트에 쓴 지난 기록도 여기서 볼 수 있어요.',
    noSpot: '이 지점은 로그북을 쓸 수 없어요(번호가 있는 포인트만).', empty: '아직 이 포인트에 쓴 기록이 없어요.', loading: '불러오는 중…', fail: '불러오지 못했어요',
    date: '날짜', tod: '시작 시각 (HH:MM)', kind: '다이버 종류', rec: '레크레이션', tec: '텍다이버', tank: '탱크 종류', dmax: '최대수심 (m)', davg: '평균수심 (m)', mins: '다이빙 시간 (분)',
    fill: '충전 압력 (bar)', remain: '잔압 (bar)', weight: '웨이트 (kg)', suit: '슈트 두께 (mm)', temp: '수온 (°C)', vis: '시야 (m)', buddy: '버디', notes: '메모',
    used: '사용량', sac: '분당 소비량', sacU: 'bar/분 (수면 환산)', rmv: 'L/분', needCalc: '충전·잔압·평균수심·시간을 넣으면 분당 공기소비량이 계산돼요',
    prev: (d) => `지난 기록(${d})에서 불러왔어요`, save: '저장', cancel: '취소', edit: '수정', del: '삭제', delAsk: '이 기록을 지울까요?', saved: '저장했어요', gain: (n) => ` · 크레딧 +${n}`,
    err: { bad_date: '날짜를 확인해 주세요', avg_gt_max: '평균수심이 최대수심보다 클 수 없어요', remain_gt_fill: '잔압이 충전 압력보다 클 수 없어요', too_many: '기록이 너무 많아요', bad_no: '이 지점은 쓸 수 없어요', too_fast: '너무 빨라요. 10초 뒤에 다시 저장해 주세요', daily_limit: '하루(24시간)에 30건까지 쓸 수 있어요' },
    tanks: { al80: '알루미늄 80cf (11.1L)', s10: '스틸 10L', s12: '스틸 12L', s15: '스틸 15L', s7: '7L (스테이지/슬링)', d12: '더블 12L (24L)', d7: '더블 7L (14L)', sm80: '사이드마운트 2×80cf (22.2L)' }
  } : {
    tab: 'Logbook', title: (n) => `My logbook · ${n}`, add: '+ New entry', login: 'Log in to write', needLogin: 'Log in to keep a logbook. Past entries for the same spot show up here.',
    noSpot: 'Logbook is only for numbered spots.', empty: 'No entries for this spot yet.', loading: 'Loading…', fail: 'Could not load',
    date: 'Date', tod: 'Start time (HH:MM)', kind: 'Diver type', rec: 'Recreational', tec: 'Technical', tank: 'Tank', dmax: 'Max depth (m)', davg: 'Avg depth (m)', mins: 'Dive time (min)',
    fill: 'Start pressure (bar)', remain: 'End pressure (bar)', weight: 'Weight (kg)', suit: 'Suit (mm)', temp: 'Water temp (°C)', vis: 'Visibility (m)', buddy: 'Buddy', notes: 'Notes',
    used: 'Used', sac: 'SAC', sacU: 'bar/min (surface)', rmv: 'L/min', needCalc: 'Enter pressures, average depth and time to get your air consumption',
    prev: (d) => `Filled from your last entry (${d})`, save: 'Save', cancel: 'Cancel', edit: 'Edit', del: 'Delete', delAsk: 'Delete this entry?', saved: 'Saved', gain: (n) => ` · +${n} credits`,
    err: { bad_date: 'Check the date', avg_gt_max: 'Average depth cannot exceed max depth', remain_gt_fill: 'End pressure cannot exceed start pressure', too_many: 'Too many entries', bad_no: 'Not available for this spot', too_fast: 'Too fast - wait 10 seconds and save again', daily_limit: 'Up to 30 entries per 24 hours' },
    tanks: { al80: 'Aluminum 80cf (11.1L)', s10: 'Steel 10L', s12: 'Steel 12L', s15: 'Steel 15L', s7: '7L (stage/sling)', d12: 'Twin 12L (24L)', d7: 'Twin 7L (14L)', sm80: 'Sidemount 2×80cf (22.2L)' }
  };
  const VOL = { al80: 11.1, s10: 10, s12: 12, s15: 15, s7: 7, d12: 24, d7: 14, sm80: 22.2 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { if (v === '' || v == null) return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
  const fmt = (x, d) => x == null ? '' : (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toString();

  const css = document.createElement('style');
  css.textContent = `
  .log-box{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 2px 8px;color:#e2e8f0;font-size:13px;display:none}
  .log-top{display:flex;align-items:center;gap:8px;margin:2px 0 8px} .log-top b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px}
  .log-btn{height:30px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#e2e8f0;cursor:pointer;font-size:12.5px}
  .log-btn.pri{background:#FFB000;border-color:#FFB000;color:#111;font-weight:700} .log-btn.red{color:#f87171;border-color:rgba(248,113,113,.4)}
  .log-msg{color:#94a3b8;font-size:12.5px;line-height:1.5;padding:6px 2px}
  .log-card{background:#111a30;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 10px;margin:6px 0;cursor:pointer}
  .log-card .l1{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap} .log-card .l1 b{font-size:13.5px} .log-card .l1 span{color:#cbd5e1}
  .log-chip{display:inline-block;font-size:11.5px;padding:1px 8px;border-radius:999px;border:1px solid rgba(255,176,0,.45);color:#FFB000}
  .log-card .det{display:none;margin-top:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:6px;color:#cbd5e1;line-height:1.6}
  .log-card.open .det{display:block} .log-card .det .row{display:flex;gap:8px;margin-top:8px}
  .log-form{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px} .log-form label{display:block;font-size:11.5px;color:#94a3b8;margin-bottom:2px}
  .log-form input,.log-form select,.log-form textarea{width:100%;box-sizing:border-box;height:32px;border-radius:7px;border:1px solid rgba(255,255,255,.16);background:#0B1120;color:#f1f5f9;padding:0 8px;font-size:13px;font-family:inherit}
  .log-form textarea{height:56px;padding:6px 8px;resize:none} .log-form .full{grid-column:1/-1}
  .log-calc{grid-column:1/-1;background:#0f2a1f;border:1px solid rgba(52,211,153,.3);border-radius:8px;padding:7px 10px;color:#a7f3d0;font-size:12.5px;line-height:1.55}
  .log-calc.off{background:#111a30;border-color:rgba(255,255,255,.1);color:#94a3b8}
  .log-hint{grid-column:1/-1;color:#7dd3fc;font-size:11.5px}`;
  document.head.appendChild(css);

  // 분당 공기소비량 계산 → { used, sac, rmv } (계산할 수 없으면 null)
  function calc(e) {
    const fill = num(e.fill), rem = num(e.remain), mins = num(e.mins), avg = num(e.depthAvg);
    if (fill == null || rem == null || fill < rem) return null;
    const used = fill - rem; if (mins == null || mins <= 0 || avg == null) return { used, sac: null, rmv: null };
    const sac = used / mins / (avg / 10 + 1), vol = e.type === 'tec' && VOL[e.tank] ? VOL[e.tank] : null;
    return { used, sac, rmv: vol ? sac * vol : null };
  }
  const calcHTML = (e) => {
    const c = calc(e); if (!c || c.sac == null) return c ? `${T.used}: <b>${fmt(c.used, 0)} bar</b><br>${T.needCalc}` : T.needCalc;
    return `${T.used}: <b>${fmt(c.used, 0)} bar</b> · ${T.sac}: <b>${fmt(c.sac, 1)}</b> ${T.sacU}` + (c.rmv != null ? `<br>≈ <b>${fmt(c.rmv, 1)}</b> ${T.rmv}` : '');
  };

  async function post(a, body) {
    const r = await fetch(`/api/shops?svc=auth&a=${a}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) { const er = new Error(j.error || r.status); er.code = j.error; er.status = r.status; throw er; } return j;
  }
  const acct = () => window.otAccount || {};
  const nowStr = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

  let box = null, state = { no: 0, items: null, last: null, loading: false, form: null, msg: '' };
  const getBox = (b) => { box = b; b.classList.add('log-box'); return b; };

  async function refresh(no) {
    state.loading = true; state.items = null; draw();
    try { const j = await post('logs', { no }); if (state.no !== no) return; state.items = j.items || []; state.last = j.last || null; state.loading = false; state.fail = false; }
    catch (e) { if (e.status === 401) { state.loading = false; state.items = null; } else { state.loading = false; state.fail = true; } }
    draw();
  }

  window.renderLogTab = function (b) {
    getBox(b); b.style.display = 'block'; // '' 로 두면 CSS의 display:none 이 되살아나 통째로 안 보여요
    const st = typeof selectedStation !== 'undefined' ? selectedStation : null, no = st && st.no ? st.no : 0;
    if (no !== state.no) { state = { no, items: null, last: null, loading: false, form: null, msg: '' }; if (no && acct().user && acct().user()) refresh(no); }
    else if (no && state.items == null && !state.loading && acct().user && acct().user()) refresh(no);
    draw();
  };

  function spotName() { const st = typeof selectedStation !== 'undefined' ? selectedStation : null; return st ? ((typeof stationDisplayName === 'function' ? stationDisplayName(st) : st.name) || '') : ''; }

  function draw() {
    if (!box || box.style.display === 'none') return;
    const user = acct().user && acct().user();
    if (!state.no) { box.innerHTML = `<div class="log-msg">${T.noSpot}</div>`; return; }
    if (!user) { box.innerHTML = `<div class="log-msg">${T.needLogin}</div><button class="log-btn pri" id="log-login">${T.login}</button>`; box.querySelector('#log-login').onclick = () => acct().open && acct().open(); return; }
    if (state.form) return drawForm();
    let h = `<div class="log-top"><b>${esc(T.title(spotName()))}</b><button class="log-btn pri" id="log-add">${T.add}</button></div>`;
    if (state.msg) h += `<div class="log-msg" style="color:#a7f3d0">${esc(state.msg)}</div>`;
    if (state.loading) h += `<div class="log-msg">${T.loading}</div>`;
    else if (state.fail) h += `<div class="log-msg">${T.fail}</div>`;
    else if (state.items && !state.items.length) h += `<div class="log-msg">${T.empty}</div>`;
    else (state.items || []).forEach(e => {
      const c = calc(e);
      h += `<div class="log-card" data-id="${esc(e.id)}"><div class="l1"><b>${esc(e.date)}${e.tod ? ' ' + esc(e.tod) : ''}</b><span>${e.depthMax != null ? e.depthMax + 'm' : ''}${e.mins != null ? ' · ' + e.mins + (KO ? '분' : ' min') : ''}</span>${c && c.sac != null ? `<span class="log-chip">${fmt(c.sac, 1)} bar/min</span>` : ''}</div>`
        + `<div class="det">${[
          e.type === 'tec' ? `${T.tec}${e.tank ? ' · ' + esc(T.tanks[e.tank] || e.tank) : ''}` : T.rec,
          e.depthAvg != null ? `${T.davg}: ${e.depthAvg}` : '', e.weight != null ? `${T.weight}: ${e.weight}` : '', e.suit != null ? `${T.suit}: ${e.suit}` : '',
          e.temp != null ? `${T.temp}: ${e.temp}` : '', e.vis != null ? `${T.vis}: ${e.vis}` : '', e.buddy ? `${T.buddy}: ${esc(e.buddy)}` : '',
          e.fill != null && e.remain != null ? `${e.fill} → ${e.remain} bar` : ''].filter(Boolean).join('<br>')}`
        + (c && c.sac != null ? `<br><span style="color:#a7f3d0">${calcHTML(e)}</span>` : '') + (e.notes ? `<br>📝 ${esc(e.notes)}` : '')
        + `<div class="row"><button class="log-btn" data-edit="${esc(e.id)}">${T.edit}</button><button class="log-btn red" data-del="${esc(e.id)}">${T.del}</button></div></div></div>`;
    });
    box.innerHTML = h;
    box.querySelector('#log-add').onclick = () => { state.msg = ''; openForm(null); };
    box.querySelectorAll('.log-card').forEach(c => c.onclick = (ev) => { if (ev.target.closest('button')) return; c.classList.toggle('open'); });
    box.querySelectorAll('[data-edit]').forEach(b2 => b2.onclick = () => openForm((state.items || []).find(x => x.id === b2.dataset.edit)));
    box.querySelectorAll('[data-del]').forEach(b2 => b2.onclick = async () => {
      if (!confirm(T.delAsk)) return; try { await post('logdel', { id: b2.dataset.del }); state.items = state.items.filter(x => x.id !== b2.dataset.del); } catch (_) {} draw(); });
  }

  function openForm(e) {
    const L = state.last, base = e || { date: todayStr(), tod: nowStr(), type: L ? L.type : 'rec', tank: L ? L.tank : '', weight: L ? L.weight : null, suit: L ? L.suit : null };
    state.form = { id: e ? e.id : '', v: Object.assign({}, base), hint: !e && L ? T.prev(L.date) : '' }; draw();
  }
  function drawForm() {
    const f = state.form, v = f.v, val = (x) => x == null ? '' : esc(x);
    const fld = (k, label, type, extra) => `<div><label>${label}</label><input name="${k}" type="${type || 'number'}" ${type === 'text' || type === 'date' ? '' : 'inputmode="decimal" step="any"'} value="${val(v[k])}" ${extra || ''}></div>`;
    box.innerHTML = `<form class="log-form" id="log-form">`
      + (f.hint ? `<div class="log-hint">${esc(f.hint)}</div>` : '')
      + fld('date', T.date, 'date') + fld('tod', T.tod, 'text', 'maxlength="5" placeholder="09:30" pattern="([01][0-9]|2[0-3]):[0-5][0-9]"') + `<div class="full"><label>${T.kind}</label><select name="type"><option value="rec"${v.type !== 'tec' ? ' selected' : ''}>${T.rec}</option><option value="tec"${v.type === 'tec' ? ' selected' : ''}>${T.tec}</option></select></div>`
      + (v.type === 'tec' ? `<div class="full"><label>${T.tank}</label><select name="tank"><option value="">—</option>${Object.keys(VOL).map(k => `<option value="${k}"${v.tank === k ? ' selected' : ''}>${esc(T.tanks[k])}</option>`).join('')}</select></div>` : '')
      + fld('depthMax', T.dmax) + fld('depthAvg', T.davg) + fld('mins', T.mins) + fld('weight', T.weight)
      + fld('fill', T.fill) + fld('remain', T.remain) + fld('suit', T.suit) + fld('temp', T.temp) + fld('vis', T.vis) + fld('buddy', T.buddy, 'text', 'maxlength="60"')
      + `<div class="full"><label>${T.notes}</label><textarea name="notes" maxlength="600">${esc(v.notes || '')}</textarea></div>`
      + `<div class="log-calc off" id="log-calc"></div>`
      + `<div class="full" style="display:flex;gap:8px"><button type="button" class="log-btn" id="log-cancel" style="flex:1">${T.cancel}</button><button type="submit" class="log-btn pri" style="flex:2">${T.save}</button></div>`
      + `<div class="log-msg full" id="log-err" style="color:#f87171"></div></form>`;
    const form = box.querySelector('#log-form');
    const read = () => { const o = {}; new FormData(form).forEach((x, k) => { o[k] = x; }); o.type = o.type === 'tec' ? 'tec' : 'rec'; return o; };
    const upd = () => { const o = read(), calcEl = box.querySelector('#log-calc'); const c = calc(o); calcEl.innerHTML = calcHTML(o); calcEl.classList.toggle('off', !(c && c.sac != null)); };
    form.addEventListener('input', upd); upd();
    form.type.addEventListener('change', () => { f.v = Object.assign(f.v, read()); drawForm(); }); // 텍다이버면 탱크 선택이 나타나요
    box.querySelector('#log-cancel').onclick = () => { state.form = null; draw(); };
    form.onsubmit = async (ev) => {
      ev.preventDefault(); const o = read(), err = box.querySelector('#log-err'); err.textContent = '';
      try {
        const j = await post('logsave', Object.assign({}, o, { no: state.no, id: f.id || undefined }));
        const i = (state.items || []).findIndex(x => x.id === j.item.id); if (i >= 0) state.items[i] = j.item; else (state.items = state.items || []).unshift(j.item);
        state.items.sort((a, z) => (z.date || '').localeCompare(a.date || '') || (z.at || 0) - (a.at || 0)); state.last = state.items[0] || j.item;
        state.form = null; state.msg = T.saved + (j.gain ? T.gain(j.gain) : ''); if (j.gain && acct().reload) acct().reload(); draw();
      } catch (e2) { err.textContent = T.err[e2.code] || T.fail; }
    };
  }

  // 탭 이름(언어별) + 로그인 상태가 바뀌면 다시 그리기
  document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('btn-log'); if (b) b.textContent = T.tab; });
  window.addEventListener('otemp:account', () => { state.items = null; state.form = null; if (typeof activeMode !== 'undefined' && activeMode === 'log') window.renderLogTab(box); });
})();
