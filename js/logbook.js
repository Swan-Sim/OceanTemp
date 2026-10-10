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
    photos: '사진', photoMax: '최대 4장', photoAdd: '+ 사진', photoPub: '지도에 공개 (포인트 이름 아래 작은 사진으로 보여요)', photoBusy: '올리는 중…', photoFail: '사진을 올리지 못했어요', photoBig: '사진이 너무 커요', photoDelAdm: '이 사진 삭제(관리자)',
    al80: '80cf 탱크 기준', suitNone: '슈트 없이', suitDry: '드라이슈트', tempAuto: (sst, d, t) => `자동: 수면 ${sst}°C → ${d}m 약 ${t}°C (추정)`, tempAutoS: (sst) => `자동: 수면 ${sst}°C (추정)`, tempNo: '이 날짜 수온 자료가 없어요 - 직접 넣어 주세요', tempBusy: '수온 불러오는 중…', visAuto: (v) => `위성 추정 ${v}m - 실제와 다르면 ±로 고쳐 주세요`,
    prev: (d) => `지난 기록(${d})에서 불러왔어요`, save: '저장', cancel: '취소', edit: '수정', del: '삭제', delAsk: '이 기록을 지울까요?', saved: '저장했어요', gain: (n) => ` · 크레딧 +${n}`,
    err: { bad_date: '날짜를 확인해 주세요', avg_gt_max: '평균수심이 최대수심보다 클 수 없어요', remain_gt_fill: '잔압이 충전 압력보다 클 수 없어요', too_many: '기록이 너무 많아요', bad_no: '이 지점은 쓸 수 없어요', too_fast: '너무 빨라요. 10초 뒤에 다시 저장해 주세요', daily_limit: '하루(24시간)에 30건까지 쓸 수 있어요' },
    tanks: { al80: '알루미늄 80cf (11.1L)', s10: '스틸 10L', s12: '스틸 12L', s15: '스틸 15L', s7: '7L (스테이지/슬링)', d12: '더블 12L (24L)', d7: '더블 7L (14L)', sm80: '사이드마운트 2×80cf (22.2L)' }
  } : {
    tab: 'Logbook', title: (n) => `My logbook · ${n}`, add: '+ New entry', login: 'Log in to write', needLogin: 'Log in to keep a logbook. Past entries for the same spot show up here.',
    noSpot: 'Logbook is only for numbered spots.', empty: 'No entries for this spot yet.', loading: 'Loading…', fail: 'Could not load',
    date: 'Date', tod: 'Start time (HH:MM)', kind: 'Diver type', rec: 'Recreational', tec: 'Technical', tank: 'Tank', dmax: 'Max depth (m)', davg: 'Avg depth (m)', mins: 'Dive time (min)',
    fill: 'Start pressure (bar)', remain: 'End pressure (bar)', weight: 'Weight (kg)', suit: 'Suit (mm)', temp: 'Water temp (°C)', vis: 'Visibility (m)', buddy: 'Buddy', notes: 'Notes',
    used: 'Used', sac: 'SAC', sacU: 'bar/min (surface)', rmv: 'L/min', needCalc: 'Enter pressures, average depth and time to get your air consumption',
    photos: 'Photos', photoMax: 'up to 4', photoAdd: '+ Photo', photoPub: 'Show on the map (small thumbnail under the spot name)', photoBusy: 'Uploading…', photoFail: 'Could not upload the photo', photoBig: 'Photo is too large', photoDelAdm: 'Delete this photo (admin)',
    al80: '80cf tank', suitNone: 'No suit', suitDry: 'Drysuit', tempAuto: (sst, d, t) => `Auto: surface ${sst}°C → ~${t}°C at ${d} m (estimate)`, tempAutoS: (sst) => `Auto: surface ${sst}°C (estimate)`, tempNo: 'No water temp data for this date - enter it yourself', tempBusy: 'Loading water temp…', visAuto: (v) => `Satellite estimate ${v} m - adjust with ±`,
    prev: (d) => `Filled from your last entry (${d})`, save: 'Save', cancel: 'Cancel', edit: 'Edit', del: 'Delete', delAsk: 'Delete this entry?', saved: 'Saved', gain: (n) => ` · +${n} credits`,
    err: { bad_date: 'Check the date', avg_gt_max: 'Average depth cannot exceed max depth', remain_gt_fill: 'End pressure cannot exceed start pressure', too_many: 'Too many entries', bad_no: 'Not available for this spot', too_fast: 'Too fast - wait 10 seconds and save again', daily_limit: 'Up to 30 entries per 24 hours' },
    tanks: { al80: 'Aluminum 80cf (11.1L)', s10: 'Steel 10L', s12: 'Steel 12L', s15: 'Steel 15L', s7: '7L (stage/sling)', d12: 'Twin 12L (24L)', d7: 'Twin 7L (14L)', sm80: 'Sidemount 2×80cf (22.2L)' }
  };
  const VOL = { al80: 11.1, s10: 10, s12: 12, s15: 15, s7: 7, d12: 24, d7: 14, sm80: 22.2 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { if (v === '' || v == null) return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
  const fmt = (x, d) => x == null ? '' : (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toString();
  const SUITS = ['0', '2', '3', '5', '6', '7', 'dry'];
  const suitTxt = (v) => v === 'dry' ? T.suitDry : (+v === 0 ? T.suitNone : v + 'mm');

  // [ADD] 수온 자동: 포인트 + 날짜·시각의 수면 수온(Open-Meteo 시간별) → 수심 프로파일(그래프와 같은 식)로 평균수심 수온 추정
  const tempMemo = {};
  async function sstAt(st, date, tod) {
    const x = Date.parse(`${date}T${tod || '12:00'}:00Z`); if (!Number.isFinite(x)) return null;
    try { const d = await fetchStationHourly(st); const a = d.temp || []; if (a.length && a[0].x <= x && x <= a[a.length - 1].x) { const v = interpAt(a, x); if (v != null) return v; } } catch (_) {}
    // 최근 6일보다 이전(또는 예보 밖) → 그날 하루치만 따로 받기
    const k = st.no + '|' + date;
    if (!(k in tempMemo)) tempMemo[k] = (async () => {
      try { const j = await fetchJSON(`${LIVE_DATA_BASE}?latitude=${st.coords[1]}&longitude=${st.coords[0]}&hourly=sea_surface_temperature&start_date=${date}&end_date=${date}&timezone=auto`);
        const h = j && j.hourly; if (!h || !h.time) return null;
        return h.time.map((t, i) => ({ x: Date.parse(t + ':00Z'), y: h.sea_surface_temperature[i] })).filter(p => typeof p.y === 'number'); } catch (_) { return null; } })();
    const pts = await tempMemo[k]; if (!pts || !pts.length) return null;
    if (x <= pts[0].x) return pts[0].y; if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y; return interpAt(pts, x);
  }
  function tempAtDepth(st, sst, d) {
    if (!(d > 0) || typeof getDepthProfile !== 'function') return sst;
    const p = getDepthProfile(sst, st.isBeach, d + 5), D = p.depths, P = p.profile;
    for (let i = 0; i < D.length - 1; i++) if (D[i] <= d && d <= D[i + 1]) return P[i] + (P[i + 1] - P[i]) * (d - D[i]) / (D[i + 1] - D[i]);
    return P[P.length - 1];
  }
  // [ADD] 시야 자동: 위성 추정(그 날짜 7일 평균, 없으면 추세선)
  async function visAt(st, date) {
    try {
      const v = st._visCache || await fetchStationVisibility(st); if (!v) return null;
      const day = (v.days || []).find(x => x.d === date); if (day) return day.vis7 || day.vis;
      const t = Date.parse(date + 'T12:00:00Z'), pr = v.projection || [];
      if (pr.length && t >= pr[0].t - 864e5 && t <= pr[pr.length - 1].t + 864e5) return pr.reduce((b, p) => Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b, pr[0]).vis;
    } catch (_) {}
    return null;
  }

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
  .log-hint{grid-column:1/-1;color:#7dd3fc;font-size:11.5px}
  .log-sub{font-size:10.5px;color:#7dd3fc;margin-top:2px;line-height:1.35}
  .log-ph{display:flex;flex-wrap:wrap;gap:6px;align-items:center} .log-ph .pt{position:relative;width:62px;height:62px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.2);background:#111a30}
  .log-ph .pt img{width:100%;height:100%;object-fit:cover;display:block} .log-ph .pt b{position:absolute;top:1px;right:1px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.65);color:#fff;font-size:12px;line-height:20px;text-align:center;cursor:pointer}
  .log-ph .add{width:62px;height:62px;border-radius:8px;border:1px dashed rgba(255,255,255,.35);background:transparent;color:#cbd5e1;font-size:12px;cursor:pointer;padding:0}
  .log-ph .busy{color:#7dd3fc;font-size:11.5px} .log-pub{display:flex;gap:6px;align-items:flex-start;margin-top:6px;font-size:11.5px;color:#cbd5e1;line-height:1.4} .log-pub input{width:auto;height:auto;margin-top:2px}
  .log-phs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px} .log-phs img{width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.2);cursor:zoom-in}
  .ot-pv{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:12px;cursor:zoom-out}
  .ot-pv img{max-width:100%;max-height:82vh;object-fit:contain;border-radius:6px} .ot-pv button{height:32px;padding:0 14px;border-radius:8px;border:1px solid rgba(248,113,113,.5);background:transparent;color:#f87171;cursor:pointer}
  .log-step{display:flex;gap:4px} .log-step input{flex:1;min-width:0;text-align:center} .log-step button{flex:0 0 32px;height:32px;border-radius:7px;border:1px solid rgba(255,255,255,.18);background:#111a30;color:#e2e8f0;font-size:16px;cursor:pointer;padding:0}`;
  document.head.appendChild(css);

  // [ADD] 사진: 올릴 때 브라우저에서 두 장으로 줄여요 - 작은 썸네일(긴 변 320px) + 인스타그램용 큰 사진(원본 비율, 긴 변 1350px)
  const phUrl = (id, sz) => `/api/spotobs?svc=lphoto&id=${encodeURIComponent(id)}&s=${sz}`;
  async function loadImg(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) {} }
    return await new Promise((ok, no) => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = u; });
  }
  function toJpeg(img, max, q, limit) {
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight, k = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k)); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    let d = c.toDataURL('image/jpeg', q); while (d.length * 0.75 > limit && q > 0.5) { q -= 0.08; d = c.toDataURL('image/jpeg', q); } return d;
  }
  async function compressPhoto(file) { const img = await loadImg(file); return { t: toJpeg(img, 320, 0.78, 80 * 1024), b: toJpeg(img, 1350, 0.85, 860 * 1024) }; }
  // 큰 사진 보기(지도 썸네일·기록에서 같이 써요). 관리자는 지우기 버튼도 보여요.
  window.otPhotoView = function (id) {
    const u = acct().user && acct().user(), adm = !!(u && u.role === 'admin');
    const o = document.createElement('div'); o.className = 'ot-pv'; o.innerHTML = `<img src="${phUrl(id, 'b')}" alt="">` + (adm ? `<button type="button">${T.photoDelAdm}</button>` : '');
    o.onclick = (ev) => { if (ev.target.tagName === 'BUTTON') return; o.remove(); };
    const bt = o.querySelector('button'); if (bt) bt.onclick = async () => { try { await post('phdel', { id }); window.dispatchEvent(new Event('otemp:photos')); } catch (_) {} o.remove(); };
    document.body.appendChild(o);
  };

  // 분당 공기소비량 계산 → { used, sac, rmv } (계산할 수 없으면 null)
  function calc(e) {
    const fill = num(e.fill), rem = num(e.remain), mins = num(e.mins), avg = num(e.depthAvg);
    if (fill == null || rem == null || fill < rem) return null;
    const used = fill - rem; if (mins == null || mins <= 0 || avg == null) return { used, sac: null, rmv: null };
    const sac = used / mins / (avg / 10 + 1), vol = e.type === 'tec' && VOL[e.tank] ? VOL[e.tank] : VOL.al80; // [CHANGE] 탱크를 안 고르면 보통 쓰는 알루미늄 80cf(11.1L)로 L/분 계산
    return { used, sac, rmv: vol ? sac * vol : null };
  }
  const calcHTML = (e) => {
    const c = calc(e); if (!c || c.sac == null) return c ? `${T.used}: <b>${fmt(c.used, 0)} bar</b><br>${T.needCalc}` : T.needCalc;
    return `${T.used}: <b>${fmt(c.used, 0)} bar</b> · ${T.sac}: <b>${fmt(c.sac, 1)}</b> ${T.sacU}` + (c.rmv != null ? ` ≈ <b>${fmt(c.rmv, 1)}</b> ${T.rmv}${e.type === 'tec' && VOL[e.tank] ? '' : ' (' + T.al80 + ')'}` : '');
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
      h += `<div class="log-card" data-id="${esc(e.id)}"><div class="l1"><b>${esc(e.date)}${e.tod ? ' ' + esc(e.tod) : ''}</b><span>${e.depthMax != null ? e.depthMax + 'm' : ''}${e.mins != null ? ' · ' + e.mins + (KO ? '분' : ' min') : ''}</span>${c && c.sac != null ? `<span class="log-chip">${fmt(c.sac, 1)} bar/min · ${fmt(c.rmv, 0)} L/min</span>` : ''}</div>`
        + `<div class="det">${[
          e.type === 'tec' ? `${T.tec}${e.tank ? ' · ' + esc(T.tanks[e.tank] || e.tank) : ''}` : T.rec,
          e.depthAvg != null ? `${T.davg}: ${e.depthAvg}` : '', e.weight != null ? `${T.weight}: ${e.weight}` : '', e.suit != null ? `${T.suit}: ${esc(suitTxt(e.suit))}` : '',
          e.temp != null ? `${T.temp}: ${e.temp}` : '', e.vis != null ? `${T.vis}: ${e.vis}` : '', e.buddy ? `${T.buddy}: ${esc(e.buddy)}` : '',
          e.fill != null && e.remain != null ? `${e.fill} → ${e.remain} bar` : ''].filter(Boolean).join('<br>')}`
        + (c && c.sac != null ? `<br><span style="color:#a7f3d0">${calcHTML(e)}</span>` : '') + (e.notes ? `<br>📝 ${esc(e.notes)}` : '')
        + ((e.photos || []).length ? `<div class="log-phs">${e.photos.map(id => `<img src="${phUrl(id, 't')}" data-ph="${esc(id)}" loading="lazy" alt="">`).join('')}</div>` : '')
        + `<div class="row"><button class="log-btn" data-edit="${esc(e.id)}">${T.edit}</button><button class="log-btn red" data-del="${esc(e.id)}">${T.del}</button></div></div></div>`;
    });
    box.innerHTML = h;
    box.querySelector('#log-add').onclick = () => { state.msg = ''; openForm(null); };
    box.querySelectorAll('.log-card').forEach(c => c.onclick = (ev) => { if (ev.target.closest('button')) return; const ph = ev.target.closest('[data-ph]'); if (ph) { window.otPhotoView(ph.dataset.ph); return; } c.classList.toggle('open'); });
    box.querySelectorAll('[data-edit]').forEach(b2 => b2.onclick = () => openForm((state.items || []).find(x => x.id === b2.dataset.edit)));
    box.querySelectorAll('[data-del]').forEach(b2 => b2.onclick = async () => {
      if (!confirm(T.delAsk)) return; try { await post('logdel', { id: b2.dataset.del }); state.items = state.items.filter(x => x.id !== b2.dataset.del); } catch (_) {} draw(); });
  }

  function openForm(e) {
    const L = state.last, base = e || { date: todayStr(), tod: nowStr(), type: L ? L.type : 'rec', tank: L ? L.tank : '', weight: L ? L.weight : null, suit: L ? L.suit : null };
    state.form = { id: e ? e.id : '', v: Object.assign({}, base), photos: e && e.photos ? e.photos.slice() : [], pub: !!(e && e.pub), prev: {}, busy: false, hint: !e && L ? T.prev(L.date) : '',
      tempManual: !!(e && e.temp != null && !e.tempAuto), visManual: !!(e && e.vis != null) }; draw();
  }
  function drawForm() {
    const f = state.form, v = f.v, val = (x) => x == null ? '' : esc(x);
    const fld = (k, label, type, extra) => `<div><label>${label}</label><input name="${k}" type="${type || 'number'}" ${type === 'text' || type === 'date' ? '' : 'inputmode="decimal" step="any"'} value="${val(v[k])}" ${extra || ''}></div>`;
    box.innerHTML = `<form class="log-form" id="log-form">`
      + (f.hint ? `<div class="log-hint">${esc(f.hint)}</div>` : '')
      + fld('date', T.date, 'date') + fld('tod', T.tod, 'text', 'maxlength="5" placeholder="09:30" pattern="([01][0-9]|2[0-3]):[0-5][0-9]"') + `<div class="full"><label>${T.kind}</label><select name="type"><option value="rec"${v.type !== 'tec' ? ' selected' : ''}>${T.rec}</option><option value="tec"${v.type === 'tec' ? ' selected' : ''}>${T.tec}</option></select></div>`
      + (v.type === 'tec' ? `<div class="full"><label>${T.tank}</label><select name="tank"><option value="">—</option>${Object.keys(VOL).map(k => `<option value="${k}"${v.tank === k ? ' selected' : ''}>${esc(T.tanks[k])}</option>`).join('')}</select></div>` : '')
      + fld('depthMax', T.dmax) + fld('depthAvg', T.davg) + fld('mins', T.mins) + fld('weight', T.weight)
      + fld('fill', T.fill) + fld('remain', T.remain)
      + `<div><label>${T.suit}</label><select name="suit"><option value="">—</option>${(v.suit != null && v.suit !== '' && !SUITS.includes(String(v.suit)) ? [String(v.suit)] : []).concat(SUITS).map(k => `<option value="${k}"${v.suit != null && String(v.suit) === k ? ' selected' : ''}>${esc(suitTxt(k))}</option>`).join('')}</select></div>`
      + `<div><label>${T.temp}</label><input name="temp" type="number" inputmode="decimal" step="any" value="${val(v.temp)}"><div class="log-sub" id="log-temp-hint"></div></div>`
      + `<div><label>${T.vis}</label><div class="log-step"><button type="button" data-vis="-1">−</button><input name="vis" type="number" inputmode="decimal" step="1" value="${val(v.vis)}"><button type="button" data-vis="1">+</button></div><div class="log-sub" id="log-vis-hint"></div></div>`
      + fld('buddy', T.buddy, 'text', 'maxlength="60"')
      + `<div class="full"><label>${T.notes}</label><textarea name="notes" maxlength="600">${esc(v.notes || '')}</textarea></div>`
      + `<div class="full"><label>${T.photos} (${T.photoMax})</label><div class="log-ph" id="log-ph"></div><input type="file" id="log-file" accept="image/*" multiple hidden><label class="log-pub"><input type="checkbox" id="log-pub"${f.pub ? ' checked' : ''}><span>${T.photoPub}</span></label></div>`
      + `<div class="log-calc off" id="log-calc"></div>`
      + `<div class="full" style="display:flex;gap:8px"><button type="button" class="log-btn" id="log-cancel" style="flex:1">${T.cancel}</button><button type="submit" class="log-btn pri" style="flex:2">${T.save}</button></div>`
      + `<div class="log-msg full" id="log-err" style="color:#f87171"></div></form>`;
    const form = box.querySelector('#log-form');
    const read = () => { const o = {}; new FormData(form).forEach((x, k) => { o[k] = x; }); o.type = o.type === 'tec' ? 'tec' : 'rec'; return o; };
    const upd = () => { const o = read(), calcEl = box.querySelector('#log-calc'); const c = calc(o); calcEl.innerHTML = calcHTML(o); calcEl.classList.toggle('off', !(c && c.sac != null)); };
    form.addEventListener('input', upd); upd();
    // [ADD] 수온·시야 자동 채우기(직접 고치면 그 뒤로는 안 덮어씀)
    const st = typeof selectedStation !== 'undefined' ? selectedStation : null;
    const tHint = box.querySelector('#log-temp-hint'), vHint = box.querySelector('#log-vis-hint');
    let seq = 0;
    const autoTemp = async () => {
      if (f.tempManual || !st) { tHint.textContent = ''; return; }
      const my = ++seq, o = read(); tHint.textContent = T.tempBusy;
      const sst = await sstAt(st, o.date, o.tod); if (my !== seq || f.tempManual || !form.isConnected) return;
      if (sst == null) { tHint.textContent = T.tempNo; return; }
      const d = num(o.depthAvg) != null ? num(o.depthAvg) : num(o.depthMax);
      const t = tempAtDepth(st, sst, d); form.temp.value = fmt(t, 1); f.v.temp = form.temp.value;
      tHint.textContent = d > 0 ? T.tempAuto(fmt(sst, 1), fmt(d, 1), fmt(t, 1)) : T.tempAutoS(fmt(sst, 1));
    };
    const autoVis = async () => {
      if (!st) return; const o = read(); const v = await visAt(st, o.date); if (!form.isConnected || v == null) return;
      const r = Math.max(1, Math.round(v)); vHint.textContent = T.visAuto(r);
      if (!f.visManual) { form.vis.value = r; f.v.vis = r; }
    };
    let tmr = 0; const later = () => { clearTimeout(tmr); tmr = setTimeout(() => { autoTemp(); autoVis(); }, 400); };
    ['date', 'tod', 'depthAvg', 'depthMax'].forEach(n => form[n] && form[n].addEventListener('input', later));
    form.temp.addEventListener('input', () => { f.tempManual = form.temp.value !== ''; if (f.tempManual) tHint.textContent = ''; else autoTemp(); });
    form.vis.addEventListener('input', () => { f.visManual = form.vis.value !== ''; });
    box.querySelectorAll('[data-vis]').forEach(b2 => b2.onclick = () => { const c = num(form.vis.value) || 0; form.vis.value = Math.max(0, Math.min(100, c + (+b2.dataset.vis))); f.visManual = true; f.v.vis = form.vis.value; });
    autoTemp(); autoVis();
    form.type.addEventListener('change', () => { f.v = Object.assign(f.v, read()); drawForm(); }); // 텍다이버면 탱크 선택이 나타나요
    // 사진 칸: 고르면 바로 줄여서 올려요
    const phEl = box.querySelector('#log-ph'), fileEl = box.querySelector('#log-file'), pubEl = box.querySelector('#log-pub'), errEl = () => box.querySelector('#log-err');
    const drawPh = () => {
      phEl.innerHTML = f.photos.map(id => `<div class="pt"><img src="${f.prev[id] || phUrl(id, 't')}" alt=""><b data-rm="${esc(id)}">×</b></div>`).join('')
        + (f.busy ? `<span class="busy">${T.photoBusy}</span>` : (f.photos.length < 4 ? `<button type="button" class="add" id="log-padd">${T.photoAdd}</button>` : ''));
      phEl.querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { f.photos = f.photos.filter(i => i !== x.dataset.rm); drawPh(); });
      const ad = phEl.querySelector('#log-padd'); if (ad) ad.onclick = () => fileEl.click();
    };
    fileEl.onchange = async () => {
      const files = [...fileEl.files].slice(0, 4 - f.photos.length); fileEl.value = ''; if (!files.length) return;
      f.busy = true; drawPh();
      for (const fl of files) {
        try { const c = await compressPhoto(fl), j = await post('photoup', { t: c.t, b: c.b }); f.photos.push(j.id); f.prev[j.id] = c.t; if (errEl()) errEl().textContent = ''; }
        catch (e3) { if (errEl()) errEl().textContent = e3.code === 'too_big' ? T.photoBig : T.photoFail + ' (' + (e3.code || e3.status || e3.message) + ')'; }
      }
      f.busy = false; if (form.isConnected) drawPh();
    };
    pubEl.onchange = () => { f.pub = pubEl.checked; };
    drawPh();
    box.querySelector('#log-cancel').onclick = () => { state.form = null; draw(); };
    form.onsubmit = async (ev) => {
      ev.preventDefault(); if (f.busy) return; const o = read(), err = box.querySelector('#log-err'); err.textContent = '';
      try {
        const j = await post('logsave', Object.assign({}, o, { no: state.no, id: f.id || undefined, tempAuto: !f.tempManual, photos: f.photos, pub: f.pub }));
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
