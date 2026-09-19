function latLonToSpherePos(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

    // 해변 포인트용 2D 마커 텍스처 (구체 표면에 밀착되는 Sprite)
    // [FIX] 캔버스 안에서 점(dot)이 정중앙이 아니라 왼쪽(x=22/256)에 그려지는데,
    // 기존 코드는 Sprite의 기준점(center)을 캔버스 정중앙(0.5,0.5)에 그대로 뒀습니다.
    // 그 결과 "점"의 실제 화면 위치가 sprite.position(=진짜 위경도 좌표)보다
    // 화면상 옆으로(대체로 카메라 기준 서쪽 방향) 밀려 보였던 것이 1번 버그의 원인입니다.
    // sprite.center를 점의 실제 캔버스 좌표로 맞춰서 고정합니다.
    function createBeachSprite(station) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');

      const colorRGB = getTempColor(station.curTemp);
      const dotX = 26, dotY = 32, sq = 30;

      // [CHANGE] 작은 원형 점 대신 더 큼직하고 반투명한 사각형 마커로 변경 —
      // 가독성 개선 요청 반영 (원형 + 무지개색보다 인식하기 쉬움)
      ctx.save();
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = `rgb(${colorRGB})`;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(dotX - sq / 2, dotY - sq / 2, sq, sq, 6);
        ctx.fill();
      } else {
        ctx.fillRect(dotX - sq / 2, dotY - sq / 2, sq, sq);
      }
      ctx.restore();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(dotX - sq / 2, dotY - sq / 2, sq, sq, 6);
        ctx.stroke();
      } else {
        ctx.strokeRect(dotX - sq / 2, dotY - sq / 2, sq, sq);
      }

      // 반투명 캡슐 라벨
      if (station.label) {
        ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, sans-serif';
        const textWidth = ctx.measureText(station.label).width;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.roundRect(46, 14, textWidth + 18, 36, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.fillText(station.label, 55, 40);
      }

      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, depthTest: true });
      const sprite = new THREE.Sprite(material);
      sprite.userData.baseScale = [16, 4]; // 줌 반응형 크기 조절 기준값
      sprite.scale.set(16, 4, 1);

      // [FIX] 기준점을 캔버스 정중앙이 아니라 점(dot)의 실제 좌표로 이동
      sprite.center.set(dotX / canvas.width, 1 - dotY / canvas.height);

      const pos = latLonToSpherePos(station.coords[1], station.coords[0], GLOBE_RADIUS + 0.3);
      sprite.position.copy(pos);
      sprite.stationData = station;
      return sprite;
    }

// 현재 화면 정중앙이 가리키는 실제 위경도를 정밀 역산
function getCurrentCenterLatLng() {
  // [FIX] 카메라가 "바라보는" 방향(전방 벡터, -Z)이 아니라
  // "카메라 쪽을 향한" 지구 표면 방향을 써야 합니다.
  // 카메라는 (0,0,+D)에서 -Z를 바라보므로, 실제로 화면 정중앙에 보이는
  // 구 표면의 점은 원점 기준 +Z 방향에 있습니다.
  // 기존 코드가 -Z를 썼던 탓에 매번 "정확히 반대편(대척점)" 좌표가
  // 계산됐고, 그래서 한국(약 37.5N,127E)의 대척점인 남미 파라과이 인근
  // (약 37.5S,53W)으로 튀었던 것이 2번 버그의 원인입니다.
  const viewDir = new THREE.Vector3(0, 0, 1);

  // 현재 지구본의 회전값을 거꾸로 적용하여 지구본 로컬 좌표계 상의 방향 벡터 산출
  const invRotation = globeGroup.quaternion.clone().invert();
  viewDir.applyQuaternion(invRotation).normalize();

  // latLonToSpherePos의 역연산:
  // x = -sin(phi) * cos(theta)
  // y = cos(phi)
  // z = sin(phi) * sin(theta)
  const phi = Math.acos(Math.max(-1, Math.min(1, viewDir.y)));
  const lat = 90 - (phi * 180 / Math.PI);

  const theta = Math.atan2(viewDir.z, -viewDir.x); // [-PI, PI]
  let lon = (theta * 180 / Math.PI) - 180;

  // 경도를 [-180, 180] 범위로 정규화
  lon = ((lon + 180) % 360 + 360) % 360 - 180;

  return { lat, lon };
}

    // 초고해상도 실사 위성 상세 지도 (Leaflet + Esri)
    // 2. 보고 있던 위치 그대로 확대되도록 수정한 zoomIn 함수
    function zoomIn() {
      if (isDetailMode) {
        leafletMap.zoomIn();
      } else {
        cameraDistance = Math.max(MIN_DIST, cameraDistance - 25);
        camera.position.z = cameraDistance;
        updateZoomGauge();

        // 확대 임계치 도달 시 현재 화면 중심점으로 상세 지도 전환
        if (cameraDistance <= MIN_DIST + 15) {
          const center = getCurrentCenterLatLng();
          showDetailMap(center.lat, center.lon, 6);
        }
      }
    }

    function zoomOut() {
      if (isDetailMode) {
        leafletMap.zoomOut();
      } else {
        cameraDistance = Math.min(MAX_DIST, cameraDistance + 25);
        camera.position.z = cameraDistance;
        updateZoomGauge();
      }
    }

    function resetGlobeView() {
      if (isDetailMode) switchToGlobe();
      cameraDistance = 270;
      camera.position.set(0, 0, cameraDistance);
      globeGroup.rotation.set(0.35, -2.1, 0);
      updateZoomGauge();
    }

    // [ADD] 지구본을 축소(줌아웃)해도 마커가 너무 작아져서 안 보이지 않도록,
    // 카메라 거리에 비례해서 마커의 월드 스케일을 키워 화면상 크기를 어느 정도
    // 일정하게 유지합니다 (거리가 멀어질수록 실제 크기를 키우는 방식).
    function updateBeachSpriteScale() {
      const factor = cameraDistance / 170; // 170 = 기본(리셋) 거리 기준
      beachSprites.forEach(s => {
        const [bw, bh] = s.userData.baseScale;
        s.scale.set(bw * factor, bh * factor, 1);
      });
    }

    function updateZoomGauge() {
      const ratio = 1 - (cameraDistance - MIN_DIST) / (MAX_DIST - MIN_DIST);
      updateZoomGaugeByRatio(ratio);
      updateBeachSpriteScale();
    }

    function updateZoomGaugeByRatio(ratio) {
      const percent = (Math.max(0, Math.min(1, ratio)) * 100).toFixed(1);
      document.getElementById('zoom-fill').style.height = `${percent}%`;
      document.getElementById('zoom-handle').style.bottom = `${percent}%`;
    }

    // [ADD] windy.com / earth.nullschool 스타일 아이디어 반영 - 정점 색상 사각형
    // 하나하나만으론 "어디가 따뜻하고 어디가 차가운지"가 한눈에 안 들어온다는
    // 지적에 대해, 바다 전체에 부드럽게 보간된 반투명 수온 색상 레이어를
    // 지구본 표면 위에 한 겹 더 씌웁니다. 육지는 완전히 투명 처리합니다.
    // 저해상도 캔버스를 구체에 입히면 GPU가 자동으로 부드럽게 보간해 줘서
    // 계산량을 줄이면서도 매끄러운 그라데이션 느낌을 낼 수 있어요.
    function buildHeatOverlayTexture() {
      const W = 180, H = 90;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);

      const pts = stations.map(s => ({ lat: s.coords[1], lon: s.coords[0], temp: s.curTemp }));

      for (let py = 0; py < H; py++) {
        const lat = 90 - (py + 0.5) / H * 180;
        for (let px = 0; px < W; px++) {
          const lon = (px + 0.5) / W * 360 - 180;
          if (isOnLand(lon, lat)) continue;

          let ambient = 31.0 - Math.abs(lat) * 0.45;
          if (lat >= 22 && lat <= 28 && lon >= 48 && lon <= 56) ambient += 6.5; // 페르시아만 예시 보정

          let wSum = 0, tSum = 0, nearest = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const dLat = lat - pts[i].lat, dLon = lon - pts[i].lon;
            const d = Math.sqrt(dLat * dLat + dLon * dLon);
            if (d < nearest) nearest = d;
            const w = 1 / Math.pow(d + 1, 2);
            wSum += w; tSum += w * pts[i].temp;
          }
          const idw = wSum > 0 ? tSum / wSum : ambient;
          const influence = Math.max(0, Math.min(1, 1 - nearest / 35));
          const finalTemp = ambient * (1 - influence) + idw * influence;

          ctx.fillStyle = `rgba(${getTempColor(finalTemp)}, 0.55)`;
          ctx.fillRect(px, py, 1, 1);
        }
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return texture;
    }

    function initThreeGlobe() {
      // [FIX-지연로딩] 처음엔 해변/다이빙 정점(가벼움, ~80개)만 만들고,
      // 무거운 전세계 해양 격자(~2천여 개, 육지 판정 포함)는 실제로 확대해서
      // 상세지도로 들어갈 때(showDetailMap) 딱 한 번만 계산합니다.
      stations = generateBeachStations();
      refreshMaxTempStation();
      document.getElementById('point-counter').innerText = t.stationCount(stations.length) + ' · ' + t.expandNote;

      const container = document.getElementById('globe-canvas-container');
      const width = container.clientWidth;
      const height = container.clientHeight;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2500);
      camera.position.z = cameraDistance;

      // [ADD] 별/행성 배경 장식 - globeGroup이 아니라 scene에 직접 붙여서
      // 지구본을 드래그해도 별자리처럼 고정된 배경으로 보이게 합니다.
      scene.add(buildStarfield());
      scene.add(buildSolarSystemDecor());

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      container.appendChild(renderer.domElement);

      globeGroup = new THREE.Group();
      scene.add(globeGroup);

      // 위성 지구본 본체
      const globeGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
      const textureLoader = new THREE.TextureLoader();
      const earthTexture = textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
      const globeMaterial = new THREE.MeshBasicMaterial({ map: earthTexture });
      globeMesh = new THREE.Mesh(globeGeometry, globeMaterial);
      globeGroup.add(globeMesh);

      // [ADD] 바다 위에 덧씌우는 부드러운 수온 색상 필드 (windy.com/earth.nullschool 느낌)
      const heatTexture = buildHeatOverlayTexture();
      const heatGeometry = new THREE.SphereGeometry(GLOBE_RADIUS + 0.15, 64, 64);
      const heatMaterial = new THREE.MeshBasicMaterial({ map: heatTexture, transparent: true, depthWrite: false });
      const heatMesh = new THREE.Mesh(heatGeometry, heatMaterial);
      globeGroup.add(heatMesh);

      // 해변 정점 (초기 로딩엔 이것만 표시 - 원양 격자는 상세지도 진입 시 지연 로드)
      const beachStations = stations.filter(d => d.isBeach);
      beachStations.forEach(st => {
        const sprite = createBeachSprite(st);
        beachSprites.push(sprite);
        globeGroup.add(sprite);
      });

      // 태평양 방면 기본 회전
      globeGroup.rotation.set(0.35, -2.1, 0);

      // 드래그 회전 인터랙션
      let isDragging = false;
      let prevMousePos = { x: 0, y: 0 };
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      function onPointerDown(e) {
        isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        prevMousePos = { x: clientX, y: clientY };
      }

      function onPointerMove(e) {
        if (!isDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const deltaX = clientX - prevMousePos.x;
        const deltaY = clientY - prevMousePos.y;

        globeGroup.rotation.y += deltaX * 0.005;
        globeGroup.rotation.x += deltaY * 0.005;
        globeGroup.rotation.x = Math.max(-1.2, Math.min(1.2, globeGroup.rotation.x));

        prevMousePos = { x: clientX, y: clientY };
      }

      function onPointerUp(e) {
        if (isDragging) {
          isDragging = false;
          const rect = container.getBoundingClientRect();
          const clientX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : e.clientX;
          const clientY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : e.clientY;

          mouse.x = ((clientX - rect.left) / width) * 2 - 1;
          mouse.y = -((clientY - rect.top) / height) * 2 + 1;

          raycaster.setFromCamera(mouse, camera);
          const intersects = raycaster.intersectObjects(globeGroup.children);
          for (let hit of intersects) {
            // 지구본 표면을 직접 클릭했을 때 실제 텍스처 UV를 찍어볼 수 있는 보정용 로그.
            // (혹시 나중에 육지 텍스처와 정점 좌표가 다시 어긋나 보이면,
            //  지도에서 잘 아는 지점을 클릭해 콘솔의 u값과
            //  (lon+180)/360 계산값을 비교해서 오프셋을 역산할 수 있습니다.)
            if (hit.object === globeMesh && hit.uv) {
              console.log('[calibration] clicked texture UV =', hit.uv.x.toFixed(4), hit.uv.y.toFixed(4));
            }
            if (hit.object.stationData) {
              selectStation(hit.object.stationData);
              break;
            }
          }
        }
      }

      container.addEventListener('mousedown', onPointerDown);
      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);

      container.addEventListener('touchstart', onPointerDown, { passive: true });
      window.addEventListener('touchmove', onPointerMove, { passive: true });
      window.addEventListener('touchend', onPointerUp, { passive: true });

      container.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn();
        else zoomOut();
      }, { passive: false });

      function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
      }
      animate();

      updateZoomGauge();
      const defaultSpot = stations.find(s => s.name.includes("Ocean Beach")) || stations[0];
      selectStation(defaultSpot);
    }

    // [ADD] 전체화면 버튼. 안드로이드 Chrome 등에서는 Fullscreen API로 주소창까지
    // 완전히 숨길 수 있습니다. iOS Safari는 이 API를 사실상 지원하지 않아서
    // (일부 최신 버전만 제한적으로 지원) 그 경우엔 "홈 화면에 추가" 방법을 안내합니다.
