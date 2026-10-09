
// ───────── [ADD] 주변 수심(api/_depth.js): 요약 숫자 + 수심 색 지도(10m 간격 선) + 동서 단면 ─────────
const DEPTH_T = {
  ko: { h: '주변 수심', max: (r) => `${r}m 안 최대`, avg: (r) => `${r}m 안 평균`, far: '1km 안 최대', at: '포인트 지점', prof: '동서 단면', land: '육지', depth: '수심',
    note: (n, r) => `자료: ${n} (약 ${r}m 격자). 해도가 아니라서 실제 수심, 특히 직벽이나 수중 바위와 다를 수 있어요. 다이빙 계획은 현지 정보와 다이브 컴퓨터를 기준으로 하세요.`, tap: '지도를 누르면 그 지점 수심' },
  en: { h: 'Depth around the spot', max: (r) => `Max within ${r}m`, avg: (r) => `Avg within ${r}m`, far: 'Max within 1km', at: 'At the spot', prof: 'West–east profile', land: 'Land', depth: 'Depth',
    note: (n, r) => `Source: ${n} (~${r}m grid). Not a nautical chart; real depths (walls, pinnacles) can differ. Plan dives with local knowledge and your dive computer.`, tap: 'Tap the map for depth' },
  ja: { h: '周辺の水深', max: (r) => `${r}m以内の最大`, avg: (r) => `${r}m以内の平均`, far: '1km以内の最大', at: 'ポイント地点', prof: '東西断面', land: '陸地', depth: '水深',
    note: (n, r) => `出典：${n}（約${r}m格子）。海図ではないため、実際の水深（壁・根など）とは異なる場合があります。ダイビング計画は現地情報とダイブコンピューターを基準にしてください。`, tap: '地図をタップで水深表示' }
};
function depthHtml(lang, dp) {
  if (!dp || !dp.ok || !dp.grid) return '';
  const T = DEPTH_T[lang] || DEPTH_T.en, g = dp.grid;
  const facts = [];
  if (dp.max300 != null) facts.push([`${dp.max300}m`, T.max(dp.radius || 300)]);
  if (dp.avg300 != null) facts.push([`${dp.avg300}m`, T.avg(dp.radius || 300)]);
  if (dp.max1k != null) facts.push([`${dp.max1k}m`, T.far]);
  // 단면: 포인트 위도를 지나는 줄(쌍선형)
  const zAt = (lat, lon) => { const fi = (lat - g.la0) / g.dla, fj = (lon - g.lo0) / g.dlo, i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= g.rows - 1 || j >= g.cols - 1) return null; const q = [g.z[i * g.cols + j], g.z[i * g.cols + j + 1], g.z[(i + 1) * g.cols + j], g.z[(i + 1) * g.cols + j + 1]];
    if (q.some(v => v == null)) return null; const a = fi - i, b = fj - j; return q[0] * (1 - a) * (1 - b) + q[1] * (1 - a) * b + q[2] * a * (1 - b) + q[3] * a * b; };
  const W = 320, H = 110, ml = 30, mb = 16, kx = 111.32 * Math.cos(dp.lat * Math.PI / 180);
  const lo0 = g.lo0, lo1 = g.lo0 + (g.cols - 1) * g.dlo, pts = [];
  for (let k = 0; k <= 120; k++) { const lon = lo0 + (lo1 - lo0) * k / 120, v = zAt(dp.lat, lon); if (v != null) pts.push([(lon - dp.lon) * kx, v]); }
  let prof = '';
  if (pts.length > 10) {
    const deep = Math.max(30, Math.ceil(Math.max(...pts.map(p => -p[1])) / 10) * 10), x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    const X = (x) => ml + (x - x0) / (x1 - x0) * (W - ml - 4), Y = (z) => 4 + (15 - Math.min(z, 15)) / (deep + 15) * (H - mb - 8);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const step = deep > 60 ? 30 : 10, ticks = []; for (let v = 0; v <= deep; v += step) ticks.push(v);
    prof = `<p class="note" style="margin:10px 0 2px">${T.prof}</p><svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">
${ticks.map(v => `<line x1="${ml}" x2="${W - 4}" y1="${Y(-v).toFixed(1)}" y2="${Y(-v).toFixed(1)}" stroke="rgba(255,255,255,.08)"/><text x="${ml - 4}" y="${(Y(-v) + 3).toFixed(1)}" fill="#64708A" font-size="9" text-anchor="end">${v}m</text>`).join('')}
<path d="${line}L${X(x1).toFixed(1)},${H - mb}L${X(x0).toFixed(1)},${H - mb}Z" fill="rgba(56,189,248,.18)"/><path d="${line}" fill="none" stroke="#38BDF8" stroke-width="1.6"/>
<line x1="${X(0).toFixed(1)}" x2="${X(0).toFixed(1)}" y1="4" y2="${H - mb}" stroke="#F43F5E"/>
${[Math.ceil(x0), 0, Math.floor(x1)].map(v => `<text x="${X(v).toFixed(1)}" y="${H - 3}" fill="#64708A" font-size="9" text-anchor="middle">${v ? (v > 0 ? '+' : '') + v + 'km' : '●'}</text>`).join('')}</svg>`;
  }
  const data = JSON.stringify({ g: { la0: g.la0, lo0: g.lo0, dla: g.dla, dlo: g.dlo, rows: g.rows, cols: g.cols, z: g.z.map(v => v == null ? null : Math.round(v)) }, lat: dp.lat, lon: dp.lon, land: T.land, depth: T.depth });
  return `<h2>${T.h}</h2><div class="card">
<div class="dfacts">${facts.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
<div class="dmap"><canvas id="dmap" width="300" height="300"></canvas><div class="dro" id="dro">${T.tap}</div></div>
<div class="dleg"><span>0</span><i></i><span>60m+</span></div>
${prof}
<p class="note">${T.note(esc(dp.srcName), dp.res)}${dp.license ? ` · ${esc(dp.license)}` : ''}</p></div>
<script>(function(){var D=${data.replace(/</g, '\\u003c')},g=D.g,c=document.getElementById('dmap');if(!c)return;var x=c.getContext('2d'),W=c.width,H=c.height,img=x.createImageData(W,H);
function z(la,lo){var fi=(la-g.la0)/g.dla,fj=(lo-g.lo0)/g.dlo,i=Math.floor(fi),j=Math.floor(fj);if(i<0||j<0||i>=g.rows-1||j>=g.cols-1)return null;var q=[g.z[i*g.cols+j],g.z[i*g.cols+j+1],g.z[(i+1)*g.cols+j],g.z[(i+1)*g.cols+j+1]];for(var k=0;k<4;k++)if(q[k]==null)q[k]=8;var a=fi-i,b=fj-j;return q[0]*(1-a)*(1-b)+q[1]*(1-a)*b+q[2]*a*(1-b)+q[3]*a*b}
var la1=g.la0+(g.rows-1)*g.dla,lo1=g.lo0+(g.cols-1)*g.dlo;function P(px,py){return[la1-py/H*(la1-g.la0),g.lo0+px/W*(lo1-g.lo0)]}
function col(d){var t=Math.min(1,d/60);return[Math.round(190-170*t),Math.round(235-150*t),Math.round(225-75*t)]}
var Z=new Float32Array(W*H);for(var py=0;py<H;py++)for(var px=0;px<W;px++){var p=P(px,py),v=z(p[0],p[1]);Z[py*W+px]=v==null?NaN:v}
for(var py=0;py<H;py++)for(var px=0;px<W;px++){var v=Z[py*W+px],o=(py*W+px)*4,cc;if(isNaN(v))cc=[11,17,32];else if(v>=0)cc=[110,100,76];else{cc=col(-v);var b0=Math.floor(-v/10),r=px<W-1?Z[py*W+px+1]:v,d=py<H-1?Z[(py+1)*W+px]:v;if((!isNaN(r)&&r<0&&Math.floor(-r/10)!==b0)||(!isNaN(d)&&d<0&&Math.floor(-d/10)!==b0)){var strong=[3,4,6].indexOf(Math.max(b0,Math.floor(-(isNaN(r)?v:r)/10),Math.floor(-(isNaN(d)?v:d)/10)))>=0;cc=strong?[255,255,255]:[cc[0]+40,cc[1]+40,cc[2]+30]}}img.data[o]=cc[0];img.data[o+1]=cc[1];img.data[o+2]=cc[2];img.data[o+3]=255}
x.putImageData(img,0,0);var sx=(D.lon-g.lo0)/(lo1-g.lo0)*W,sy=(la1-D.lat)/(la1-g.la0)*H;x.beginPath();x.arc(sx,sy,5,0,7);x.fillStyle='#F43F5E';x.fill();x.lineWidth=2;x.strokeStyle='#fff';x.stroke();
x.strokeStyle='rgba(244,63,94,.6)';x.setLineDash([4,3]);x.beginPath();x.moveTo(0,sy);x.lineTo(W,sy);x.stroke();
var ro=document.getElementById('dro');function sh(e){var r=c.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*W,py=(e.clientY-r.top)/r.height*H,v=Z[Math.max(0,Math.min(H-1,Math.round(py)))*W+Math.max(0,Math.min(W-1,Math.round(px)))];ro.textContent=isNaN(v)?'–':v>=0?D.land:D.depth+' ~'+Math.round(-v)+'m'}c.addEventListener('pointermove',sh);c.addEventListener('pointerdown',sh)})();</script>`;
}
