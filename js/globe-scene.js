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
      const dotX = 22, dotY = 32, dotR = 10;

      // [CHANGE] 네모 마커를 다시 원형으로, 크기도 줄였습니다.
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = `rgb(${colorRGB})`;
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.stroke();

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

          ctx.fillStyle = `rgba(${getTempColor(finalTemp)}, 0.92)`;
          ctx.fillRect(px, py, 1, 1);
        }
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return texture;
    }

    function initThreeGlobe() {
      stations = generateBeachStations();
      refreshMaxTempStation();

      const container = document.getElementById('globe-canvas-container');
      const width = container.clientWidth;
      const height = container.clientHeight;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2500);
      camera.position.z = cameraDistance;

      // [FIX] 별(starfield)은 아주 먼 배경이라 scene에 그대로 두지만,
      // 태양/달/행성은 지구를 드래그해서 돌릴 때 같이 움직여야 한다는 요청 반영 -
      // globeGroup의 자식으로 넣어서 지구 회전에 함께 딸려가게 합니다.
      scene.add(buildStarfield());
      scene.add(buildMilkyWay());

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      container.appendChild(renderer.domElement);

      globeGroup = new THREE.Group();
      scene.add(globeGroup);
      globeGroup.add(buildSolarSystemDecor());

      // 위성 지구본 본체
      const globeGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
      const textureLoader = new THREE.TextureLoader();
      const earthTexture = textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
      const globeMaterial = new THREE.MeshBasicMaterial({ map: earthTexture });
      globeMesh = new THREE.Mesh(globeGeometry, globeMaterial);
      globeGroup.add(globeMesh);

      // [ADD] 히트필드는 해변(실제 지명) 정점만으로 계산합니다 -
      // 격자 정점까지 넣으면 IDW 보간 계산량이 커져서 무겁고, 의미도 크게
      // 달라지지 않아요. 바다 위에 덧씌우는 부드러운 수온 색상 필드
      // (windy.com/earth.nullschool 느낌)
      const heatTexture = buildHeatOverlayTexture();
      const heatGeometry = new THREE.SphereGeometry(GLOBE_RADIUS + 0.15, 64, 64);
      const heatMaterial = new THREE.MeshBasicMaterial({ map: heatTexture, transparent: true, depthWrite: false });
      const heatMesh = new THREE.Mesh(heatGeometry, heatMaterial);
      globeGroup.add(heatMesh);

      // [ADD] "지구공 상태에서도 NOAA 정점들 보이게" 요청 반영 -
      // 전세계 해양 격자 정점을 여기서 바로 생성해 지구본에도 표시합니다.
      // (이전엔 상세지도 진입 시에만 지연 로드했는데, 육지 판정이 이미
      //  가벼워졌으니 처음부터 만들어도 부담이 적어요.)
      const gridStations = generateOceanGridStations();
      stations = stations.concat(gridStations);
      fullGridLoaded = true;
      refreshMaxTempStation();
      document.getElementById('point-counter').innerText = t.stationCount(stations.length);

      const dotGeometry = new THREE.SphereGeometry(0.4, 6, 6);
      const dotMaterial = new THREE.MeshBasicMaterial();
      const instancedDots = new THREE.InstancedMesh(dotGeometry, dotMaterial, gridStations.length);
      const dummy = new THREE.Object3D();
      const colorHelper = new THREE.Color();
      gridStations.forEach((st, i) => {
        const pos = latLonToSpherePos(st.coords[1], st.coords[0], GLOBE_RADIUS + 0.25);
        dummy.position.copy(pos);
        dummy.updateMatrix();
        instancedDots.setMatrixAt(i, dummy.matrix);
        colorHelper.setStyle(`rgb(${getTempColor(st.curTemp)})`);
        instancedDots.setColorAt(i, colorHelper);
      });
      instancedDots.instanceMatrix.needsUpdate = true;
      instancedDots.instanceColor.needsUpdate = true;
      globeGroup.add(instancedDots);

      // 해변 정점 (사람이 알아보는 지명 - 스프라이트로 표시)
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

      // [ADD] 핀치 줌(두 손가락으로 오므리기/벌리기) 상태
      let pinchStartDist = null;
      let pinchStartCameraDist = null;
      function getTouchDist(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }

      function onPointerDown(e) {
        // [ADD] 손가락 두 개면 핀치 줌 시작, 드래그 회전은 하지 않음
        if (e.touches && e.touches.length === 2) {
          pinchStartDist = getTouchDist(e.touches);
          pinchStartCameraDist = cameraDistance;
          isDragging = false;
          return;
        }
        isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        prevMousePos = { x: clientX, y: clientY };
      }

      function onPointerMove(e) {
        // [ADD] 손가락 두 개 - 핀치 줌 처리
        if (e.touches && e.touches.length === 2 && pinchStartDist) {
          if (e.cancelable) e.preventDefault();
          const newDist = getTouchDist(e.touches);
          const ratio = pinchStartDist / Math.max(newDist, 1);
          let newCam = pinchStartCameraDist * ratio;
          newCam = Math.max(MIN_DIST, Math.min(MAX_DIST, newCam));
          cameraDistance = newCam;
          camera.position.z = cameraDistance;
          updateZoomGauge();
          return;
        }
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
        // [ADD] 핀치 줌이 끝나는 시점 - 충분히 확대됐으면 상세지도로 전환
        if (pinchStartDist !== null) {
          const wasPinching = pinchStartDist;
          pinchStartDist = null;
          if (wasPinching && (!e.touches || e.touches.length < 2)) {
            if (cameraDistance <= MIN_DIST + 15) {
              const center = getCurrentCenterLatLng();
              showDetailMap(center.lat, center.lon, 6);
            }
            return;
          }
        }
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

      // [FIX] 핀치 줌에서 브라우저 기본 동작(페이지 확대)을 막으려면
      // preventDefault를 호출할 수 있어야 해서 passive: false로 바꿨습니다.
      container.addEventListener('touchstart', onPointerDown, { passive: false });
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp, { passive: false });

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
