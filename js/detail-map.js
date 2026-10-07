// [FIX] 지도 글자(지명) 층: CARTO가 키 없는 요청에 "API KEY REQUIRED" 그림을 돌려줘서 Esri 무료 지명 층으로 교체(출처 표시 켬)
/*! otemp.app — © 2026 All rights reserved. Unauthorized copying or redistribution prohibited. See /LICENSE. */
function showDetailMap(o,a,n=6){if(isDetailMode=!0,document.body.classList.add("detail-mode"),document.getElementById("globe-canvas-container").style.opacity="0",document.getElementById("globe-canvas-container").style.pointerEvents="none",document.getElementById("leafletMap").classList.add("active"),leafletMap)leafletMap.setView([o,a],n,{animate:!0,duration:.4});else{if(leafletMap=L.map("leafletMap",{zoomControl:!1,attributionControl:!0,minZoom:4,maxZoom:18}).setView([o,a],n),leafletMap.attributionControl.setPrefix(!1),setupCoordPicker(leafletMap),L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:18,attribution:"Imagery &copy; Esri, Maxar, Earthstar Geographics"}).addTo(leafletMap),L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",{maxZoom:18,attribution:"Labels &copy; Esri"}).addTo(leafletMap),leafletMap.on("zoom",()=>{const e=leafletMap.getZoom();if(updateZoomGaugeByRatio((e-4)/14),e<5){const c=leafletMap.getCenter();switchToGlobe(c.lat,c.lng)}}),!fullGridLoaded){const e=generateOceanGridStations();stations=stations.concat(e),fullGridLoaded=!0,refreshMaxTempStation(),document.getElementById("point-counter").innerText=t.stationCount(stations.length)}stations.forEach(e=>{const c=getTempColor(e.curTemp),i=e.isBeach&&e.label?`<span class="lf-label">${String(e.label).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[ch])}</span>`:"",s=L.divIcon({className:"lf-marker-wrap",html:(window.spotDotHTML?spotDotHTML(e,c):`<div class="lf-dot ${e.isBeach?"beach":""}" style="background-color: rgba(${c}, 0.78);"></div>`)+i,iconSize:[20,20],iconAnchor:[e.isBeach?7:5.5,10]}),r=L.marker([e.coords[1],e.coords[0]],{icon:s}).addTo(leafletMap).on("click",()=>selectStation(e));leafletMarkersByStationId[e.id]=r})}}function updateLeafletSelection(){Object.keys(leafletMarkersByStationId).forEach(o=>{const a=leafletMarkersByStationId[o],n=a.getElement&&a.getElement();if(!n)return;const l=n.querySelector(".lf-dot");if(!l)return;const e=selectedStation&&String(selectedStation.id)===o;l.classList.toggle("selected",!!e)})}function switchToGlobe(o,a){isDetailMode=!1,document.body.classList.remove("detail-mode"),document.getElementById("leafletMap").classList.remove("active");const n=document.getElementById("globe-canvas-container");if(n.style.opacity="1",n.style.pointerEvents="auto",cameraDistance=170,camera.position.z=cameraDistance,typeof o=="number"&&typeof a=="number"){const l=computeRotationForLatLon(o,a);globeGroup.rotation.set(l.x,l.y,0)}updateZoomGauge()}function locateUser(){
  // [FIX] "지도랑 GPS 값이랑 위치가 안맞아" - 예전엔 위치를 못 받으면 조용히 샌프란시스코(37.78,-122.45)로
  // 갔고, 10분 묵은 위치를 재사용했고, 내 위치 표시도 없었어요. 정밀 GPS로 새로 받고, 파란 점+오차 원을 그립니다.
  const msg=(txt)=>{let d=document.getElementById('locate-msg');if(!d){d=document.createElement('div');d.id='locate-msg';document.body.appendChild(d)}d.textContent=txt;d.classList.add('show');clearTimeout(d._t);d._t=setTimeout(()=>d.classList.remove('show'),3500)};
  if(!navigator.geolocation){msg(t.locateFail||'위치를 가져올 수 없어요');return}
  msg(t.locateWait||'위치 확인 중...');
  navigator.geolocation.getCurrentPosition(o=>{
    const la=o.coords.latitude,lo=o.coords.longitude,acc=Math.max(5,o.coords.accuracy||50);
    // [CHANGE] "현위치 누르면 가까운 정점을 최대로" - 내 위치에서 가장 가까운 포인트를 골라 그 포인트를 줌 SPOT_ZOOM으로 열어요(내 위치 파란 점은 그대로 표시)
    const R=Math.PI/180,km=(a,b,c,d)=>12742*Math.asin(Math.sqrt(Math.sin((c-a)*R/2)**2+Math.cos(a*R)*Math.cos(c*R)*Math.sin((d-b)*R/2)**2));
    let near=null,nd=Infinity;
    (typeof stations!=='undefined'?stations:[]).forEach(s=>{if(!s.isBeach||!s.coords)return;const dd=km(la,lo,s.coords[1],s.coords[0]);if(dd<nd){nd=dd;near=s}});
    if(near){showDetailMap(near.coords[1],near.coords[0],typeof SPOT_ZOOM==='number'?SPOT_ZOOM:16);try{selectStation(near)}catch(_){}}
    else{const z=acc<60?17:acc<300?15:acc<1500?13:11;showDetailMap(la,lo,z)}
    if(window.__meDot){leafletMap.removeLayer(__meDot);leafletMap.removeLayer(__meAcc)}
    window.__meAcc=L.circle([la,lo],{radius:acc,color:'#3b82f6',weight:1,fillColor:'#3b82f6',fillOpacity:.12,interactive:!1}).addTo(leafletMap);
    window.__meDot=L.circleMarker([la,lo],{radius:7,color:'#fff',weight:2.5,fillColor:'#2563eb',fillOpacity:1,interactive:!1}).addTo(leafletMap);
    const ko=typeof lang==='undefined'||lang==='ko';
    msg(near?(ko?`가장 가까운 포인트: ${near.name} (${nd<10?nd.toFixed(1):Math.round(nd)}km) · 내 위치 오차 약 ${Math.round(acc)}m`:`Nearest spot: ${near.name} (${nd<10?nd.toFixed(1):Math.round(nd)} km) · accuracy ~${Math.round(acc)} m`):(t.locateAcc||((a)=>`내 위치 (오차 약 ${a}m)`))(Math.round(acc)));
  },e=>{msg(e&&e.code===1?(t.locateDenied||'위치 권한이 꺼져 있어요'):(t.locateFail||'위치를 가져올 수 없어요'))},{enableHighAccuracy:!0,timeout:15000,maximumAge:0})}

// [ADD] 좌표 찍기 - 위성 지도에서 원하는 곳을 우클릭(휴대폰은 길게 누르기)하면 위도·경도를 보여주고 복사.
// 한국은 구글·네이버 지도에서 정확한 좌표 얻기가 어려워서, 이 지도(Esri 위성, WGS84 = GPS와 같은 기준)에서 바로 따도록.
// [CHANGE] 좌표 찍기(GPS 추출)는 관리자 로그인 상태에서만. 관리 페이지에 저장된 비밀번호가 서버에서 맞는지 확인(비밀번호별로 한 번만)
let __adminChk=null;
function isAdminLoggedIn(){
  let pw='';try{const o=JSON.parse(localStorage.getItem('otemp.admin')||'null');if(o&&o.pw&&o.exp>Date.now())pw=o.pw}catch(_){}
  if(!pw){try{pw=sessionStorage.getItem('adminPw')||''}catch(_){}}
  if(!pw)return Promise.resolve(false);
  if(__adminChk&&__adminChk.pw===pw)return __adminChk.p;
  const p=fetch('/api/stats?svc=settings',{headers:{'x-admin-password':pw}}).then(r=>r.ok).catch(()=>false);
  __adminChk={pw,p};return p;
}
function setupCoordPicker(map){
  const fmt=(v)=>v.toFixed(5);
  const dms=(v,pos,neg)=>{const a=Math.abs(v),d=Math.floor(a),m=Math.floor((a-d)*60),s=((a-d)*60-m)*60;return `${d}°${m}'${s.toFixed(1)}"${v>=0?pos:neg}`};
  let pin=null;
  map.on('contextmenu',async(ev)=>{
    if(!(await isAdminLoggedIn()))return; // 일반 방문자는 아무 일도 안 일어남
    const la=ev.latlng.lat,lo=L.Util.wrapNum(ev.latlng.lng,[-180,180],!0);
    const txt=`${fmt(la)}, ${fmt(lo)}`;
    if(pin)map.removeLayer(pin);
    pin=L.circleMarker([la,lo],{radius:5,color:'#fff',weight:2,fillColor:'#ef4444',fillOpacity:1}).addTo(map);
    const html=`<div class="cp-box"><div class="cp-val">${txt}</div><div class="cp-dms">${dms(la,'N','S')} ${dms(lo,'E','W')}</div><button class="cp-copy" type="button">${t.coordCopy||'복사'}</button><a class="cp-spot" href="/spot/?lat=${fmt(la)}&lon=${fmt(lo)}&z=${map.getZoom()}" target="_blank" rel="noopener">${t.spotHere||'이 위치로 포인트 등록'}</a></div>`;
    const pop=L.popup({closeButton:!0,autoPan:!0,offset:[0,-4]}).setLatLng([la,lo]).setContent(html).openOn(map);
    pop.once('remove',()=>{if(pin){map.removeLayer(pin);pin=null}});
    setTimeout(()=>{const b=pop.getElement()&&pop.getElement().querySelector('.cp-copy');if(!b)return;
      b.onclick=async()=>{try{await navigator.clipboard.writeText(txt)}catch(_){const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(__){}ta.remove()}b.textContent=t.coordCopied||'복사됨'}},0);
  });
}
