// [ADD] 관리자용 포인트 조류 보정 입력 - 지도 오른쪽 버튼(⇄) → 작은 창. 저장은 /api/shops?svc=auth&a=curfixsave, 적용은 js/strait-tide.js
//  값은 "조위가 시간당 30cm 변할 때(대조 중간쯤)의 노트"라서 조석에 비례해 자동으로 늘고 줄어요.
(function () {
  const ko = () => typeof lang !== 'undefined' && lang === 'ko';
  const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const css = document.createElement('style');
  css.textContent = `#btn-curfix{display:none} body.detail-mode.is-admin #btn-curfix.on{display:flex}
  .cf-wrap{position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:12px}
  .cf-box{background:#0b1329;border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:14px 16px;width:min(420px,100%);color:#e2e8f0;font-size:13px;max-height:90vh;overflow:auto}
  .cf-box h3{margin:0 0 4px;font-size:14px} .cf-sub{color:#94a3b8;font-size:11.5px;line-height:1.45;margin-bottom:10px}
  .cf-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px} .cf-grid label{display:block;font-size:11.5px;color:#94a3b8;margin-bottom:2px}
  .cf-grid input,.cf-grid select,.cf-box textarea{width:100%;box-sizing:border-box;height:32px;border-radius:7px;border:1px solid rgba(255,255,255,.16);background:#0B1120;color:#f1f5f9;padding:0 8px;font-size:13px}
  .cf-box textarea{height:48px;padding:6px 8px;resize:none;margin-top:8px} .cf-row{display:flex;gap:8px;margin-top:12px}
  .cf-btn{height:32px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#e2e8f0;cursor:pointer;font-size:12.5px}
  .cf-btn.pri{background:#FFB000;border-color:#FFB000;color:#111;font-weight:700;flex:2} .cf-btn.red{color:#f87171;border-color:rgba(248,113,113,.4)}
  .cf-now{background:#111a30;border-radius:8px;padding:6px 10px;font-size:12px;color:#7dd3fc;margin-bottom:10px;line-height:1.5} .cf-err{color:#f87171;font-size:12px;margin-top:6px}`;
  document.head.appendChild(css);

  async function post(a, body) {
    const r = await fetch(`/api/shops?svc=auth&a=${a}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || r.status); return j;
  }
  const isAdmin = () => { try { const u = window.otAccount && window.otAccount.user && window.otAccount.user(); return !!(u && u.role === 'admin'); } catch (_) { return false; } };
  const dirSel = (name, val) => `<select name="${name}">${DIRS.map((d, i) => `<option value="${i * 22.5}"${val != null && Math.round(val / 22.5) % 16 === i ? ' selected' : ''}>${d} (${i * 22.5}°)</option>`).join('')}</select>`;

  function open() {
    const st = typeof selectedStation !== 'undefined' ? selectedStation : null; if (!st || !st.no) return;
    const cur = (window.curfixGet && window.curfixGet(st.no)) || {}, K = ko();
    const d = st._hourlyCache, c = d && d.current && d.current.find(x => x.strait) ;
    const nowTxt = c ? `${K ? '지금 적용 중' : 'Active'}: ${window.straitName ? straitName(c.strait) : c.strait} · ${K ? '조위 변화율' : 'tide rate'} ${c.rate != null ? (c.rate * 100).toFixed(0) + 'cm/h' : '-'} · ${K ? '보정 후' : 'result'} ${(c.speed / 0.514444).toFixed(1)}kn` : (K ? '이 포인트엔 아직 보정이 적용되지 않았어요' : 'No correction applied yet');
    const w = document.createElement('div'); w.className = 'cf-wrap';
    w.innerHTML = `<div class="cf-box"><h3>${K ? '조류 보정' : 'Current fix'} · ${(typeof stationDisplayName === 'function' ? stationDisplayName(st) : st.name) || ''} (#${st.no})</h3>
      <div class="cf-sub">${K ? '노트는 <b>조위가 시간당 30cm 변할 때</b>(대조 중간쯤) 기준이에요. 실제 변화율에 비례해 자동으로 세지고 약해지며, 만조·간조 근처에선 0에 가까워져요.' : 'Knots are for a tide rate of <b>30 cm/h</b> (about mid-tide at springs); scaled by the actual rate, near zero at high/low water.'}</div>
      <div class="cf-now">${nowTxt}</div>
      <form class="cf-grid" id="cf-form">
        <div><label>${K ? '밀물 때 흘러가는 방향' : 'Flood flows toward'}</label>${dirSel('floodTo', cur.floodTo)}</div><div><label>${K ? '밀물 노트 (30cm/h 기준)' : 'Flood kn @30cm/h'}</label><input name="floodKn" type="number" step="0.1" min="0" max="10" value="${cur.floodKn != null ? cur.floodKn : 1}"></div>
        <div><label>${K ? '썰물 때 흘러가는 방향' : 'Ebb flows toward'}</label>${dirSel('ebbTo', cur.ebbTo != null ? cur.ebbTo : (cur.floodTo != null ? (cur.floodTo + 180) % 360 : 180))}</div><div><label>${K ? '썰물 노트 (30cm/h 기준)' : 'Ebb kn @30cm/h'}</label><input name="ebbKn" type="number" step="0.1" min="0" max="10" value="${cur.ebbKn != null ? cur.ebbKn : 1}"></div>
        <div><label>${K ? '지연 (시간, 0=만조에 정확히 멈춤)' : 'Lag (h, 0 = slack at HW)'}</label><input name="lagH" type="number" step="0.5" min="-3" max="6" value="${cur.lagH != null ? cur.lagH : 0.5}"></div>
        <div><label>${K ? '모델 배경 가중치 (0~1)' : 'Model background weight'}</label><input name="bgW" type="number" step="0.05" min="0" max="1" value="${cur.bgW != null ? cur.bgW : 0.25}"></div>
      </form>
      <textarea id="cf-note" maxlength="200" placeholder="${K ? '메모 (예: 가이드 말 - 밀물 북, 썰물 남)' : 'Note'}">${cur.note || ''}</textarea>
      <div class="cf-err" id="cf-err"></div>
      <div class="cf-row"><button class="cf-btn" id="cf-cancel">${K ? '닫기' : 'Close'}</button>${cur.floodTo != null ? `<button class="cf-btn red" id="cf-del">${K ? '보정 삭제' : 'Remove'}</button>` : ''}<button class="cf-btn pri" id="cf-save">${K ? '저장' : 'Save'}</button></div></div>`;
    document.body.appendChild(w);
    const close = () => w.remove(), err = w.querySelector('#cf-err');
    w.addEventListener('click', (e) => { if (e.target === w) close(); });
    w.querySelector('#cf-cancel').onclick = close;
    const after = async () => { try { if (window.curfixReload) await window.curfixReload(); } catch (_) {} close(); };
    const del = w.querySelector('#cf-del'); if (del) del.onclick = async () => { if (!confirm(K ? '이 포인트의 보정을 지울까요?' : 'Remove this fix?')) return; try { await post('curfixsave', { no: st.no, remove: true }); await after(); } catch (e) { err.textContent = String(e.message); } };
    w.querySelector('#cf-save').onclick = async () => {
      const o = { no: st.no, note: w.querySelector('#cf-note').value }; new FormData(w.querySelector('#cf-form')).forEach((v, k) => { o[k] = v; });
      try { await post('curfixsave', o); await after(); } catch (e) { err.textContent = (K ? '저장 실패: ' : 'Save failed: ') + e.message; }
    };
  }
  function paint() {
    let b = document.getElementById('btn-curfix');
    if (!b) { const ctr = document.querySelector('.map-controls'); if (!ctr) return; b = document.createElement('button'); b.id = 'btn-curfix'; b.className = 'ctrl-btn'; b.type = 'button'; b.title = ko() ? '조류 보정(관리자)' : 'Current fix (admin)';
      b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3"/></svg>';
      b.onclick = open; const before = document.getElementById('btn-spot-add'); before ? ctr.insertBefore(b, before) : ctr.appendChild(b); }
    document.body.classList.toggle('is-admin', isAdmin());
    const st = typeof selectedStation !== 'undefined' ? selectedStation : null; b.classList.toggle('on', !!(st && st.no));
  }
  window.addEventListener('otemp:account', paint);
  (function hook() { const wrap = (name) => { const f = window[name]; if (typeof f !== 'function') return; window[name] = function () { const r = f.apply(this, arguments); try { setTimeout(paint, 80); } catch (_) {} return r; }; };
    wrap('selectStation'); wrap('showDetailMap'); })();
  setTimeout(paint, 1500);
})();
