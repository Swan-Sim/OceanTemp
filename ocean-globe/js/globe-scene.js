function latLonToSpherePos(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

    // [CHANGE] "정점 선택 방식을 통일" + "왼쪽 반구에서는 라벨이 정점 왼쪽으로
    // 가야 함" 두 요청을 하나의 공용 함수로 처리합니다. selected=true면 해변이든
    // NOAA 격자 정점이든 동일한 스타일(큰 원 + 두꺼운 주황 테두리 + 큰 라벨)로
    // 그려지고, labelOnLeft로 라벨을 점의 왼쪽/오른쪽 중 어디에 그릴지 정합니다.
    function drawMarkerTexture(station, opts) {
      const selected = !!opts.selected;
      const labelOnLeft = !!opts.labelOnLeft;
      const label = opts.label;

      const canvas = document.createElement('canvas');
      canvas.width = 340;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');

      const colorRGB = getTempColor(station.curTemp);
      const dotY = 32;
      const dotR = selected ? 16 : 10;
      const dotX = labelOnLeft ? (canvas.width - 26) : 26;
      const borderColor = selected ? '#f97316' : '#ffffff';
      const borderWidth = selected ? 4 : 2;

      ctx.save();
      if (selected) {
        ctx.shadowColor = '#f97316';
        ctx.shadowBlur = 14;
      }
      ctx.globalAlpha = selected ? 0.95 : 0.85;
      ctx.fillStyle = `rgb(${colorRGB})`;
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.lineWidth = borderWidth;
      ctx.strokeStyle = borderColor;
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.stroke();

      if (label) {
        ctx.font = `bold ${selected ? 26 : 22}px -apple-system, BlinkMacSystemFont, sans-serif`;
        const textWidth = Math.min(ctx.measureText(label).width, canvas.width - dotR * 2 - 40);
        const boxH = selected ? 40 : 36;
        const boxY = dotY - boxH / 2;
        const boxX = labelOnLeft ? (dotX - dotR - 14 - (textWidth + 18)) : (dotX + dotR + 14);

        ctx.fillStyle = selected ? 'rgba(249, 115, 22, 0.28)' : 'rgba(15, 23, 42, 0.72)';
        ctx.strokeStyle = selected ? '#f97316' : 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = selected ? 2 : 1.5;

        ctx.beginPath();
        ctx.roundRect(boxX, boxY, textWidth + 18, boxH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.save();
        ctx.beginPath();
        ctx.rect(boxX, boxY, textWidth + 18, boxH);
        ctx.clip();
        ctx.fillText(label, boxX + 9, dotY + (selected ? 9 : 7));
        ctx.restore();
      }

      return { texture: new THREE.CanvasTexture(canvas), dotX, dotY, canvasW: canvas.width, canvasH: canvas.height };
    }

    function createBeachSprite(station) {
      const label = station.label;
      const rightVariant = drawMarkerTexture(station, { selected: false, labelOnLeft: false, label });
      const leftVariant = drawMarkerTexture(station, { selected: false, labelOnLeft: true, label });

      const material = new THREE.SpriteMaterial({ map: rightVariant.texture, depthTest: true });
      const sprite = new THREE.Sprite(material);
      sprite.userData.baseScale = [16, 3.01]; // [FIX] 캔버스 비율(340:64)에 맞춤 - 세로로 늘어져 보이던 버그
      sprite.userData.stationId = station.id;
      sprite.userData.rightVariant = rightVariant;
      sprite.userData.leftVariant = leftVariant;
      sprite.userData.labelOnLeft = false;
      sprite.scale.set(16, 4, 1);

      // [FIX] 기준점을 캔버스 정중앙이 아니라 점(dot)의 실제 좌표로 이동
      sprite.center.set(rightVariant.dotX / rightVariant.canvasW, 1 - rightVariant.dotY / rightVariant.canvasH);

      const pos = latLonToSpherePos(station.coords[1], station.coords[0], GLOBE_RADIUS + 0.3);
      sprite.position.copy(pos);
      sprite.stationData = station;
      return sprite;
    }

// [ADD] "정점 클릭이 잘 안 됨" 문제 대응 - 클릭한 지점(임의의 월드 좌표)을
// 위경도로 역산합니다. getCurrentCenterLatLng과 같은 수학이지만, 화면
// 정중앙이 아니라 실제로 클릭한 지점 좌표를 입력으로 받습니다.
function worldPointToLatLon(worldPoint) {
  const local = worldPoint.clone();
  const invRotation = globeGroup.quaternion.clone().invert();
  local.applyQuaternion(invRotation).normalize();
  const phi = Math.acos(Math.max(-1, Math.min(1, local.y)));
  const lat = 90 - (phi * 180 / Math.PI);
  const theta = Math.atan2(local.z, -local.x);
  let lon = (theta * 180 / Math.PI) - 180;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return { lat, lon };
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

    // [CHANGE] "선택 표시를 해변 정점 스타일로 통일" 요청 반영 - 해변이든
    // NOAA 격자 정점이든 상관없이, 선택된 정점 자리에 딱 하나의 재사용
    // 마커(크고 주황 테두리+이름표)를 올려서 보여줍니다. 별도의 링이나
    // 정점별 텍스처 스왑이 아니라 이 마커 하나만 관리하면 돼서 더 단순합니다.
    function createSelectionMarker() {
      const material = new THREE.SpriteMaterial({ transparent: true, depthTest: true });
      const sprite = new THREE.Sprite(material);
      sprite.userData.baseScale = [16, 3.01]; // [FIX] 캔버스 비율(340:64)에 맞춤
      sprite.visible = false;
      return sprite;
    }

    function refreshSelectionMarker() {
      if (!selectionMarker) return;
      if (!selectedStation) { selectionMarker.visible = false; return; }
      if (selectionMarker.userData.forId !== selectedStation.id) {
        selectionMarker.userData.forId = selectedStation.id;
        const label = selectedStation.label || selectedStation.name.split(' (')[0];
        selectionMarker.userData.rightVariant = drawMarkerTexture(selectedStation, { selected: true, labelOnLeft: false, label });
        selectionMarker.userData.leftVariant = drawMarkerTexture(selectedStation, { selected: true, labelOnLeft: true, label });
        selectionMarker.userData.labelOnLeft = null; // 강제로 다시 계산되게
        const v = selectionMarker.userData.rightVariant;
        selectionMarker.material.map = v.texture;
        selectionMarker.material.needsUpdate = true;
        selectionMarker.center.set(v.dotX / v.canvasW, 1 - v.dotY / v.canvasH);
      }
      const pos = latLonToSpherePos(selectedStation.coords[1], selectedStation.coords[0], GLOBE_RADIUS + 0.33);
      selectionMarker.position.copy(pos);
      selectionMarker.visible = true;
    }

    // [FIX] "정점명 텍스트 상자가 지구 왼쪽에서 아래로 숨어버림" - 스프라이트는
    // 화면 전체가 하나의 평평한 판이라 하나의 깊이값을 쓰는데, 라벨이 지구
    // 중심 쪽(안쪽)으로 뻗으면 그 자리의 실제 지구 표면(더 가까운 깊이)에
    // 가려지는 문제였어요. 라벨이 지구 중심에서 "바깥쪽"으로(화면에서 정점이
    // 왼쪽 반구에 있으면 라벨도 왼쪽으로) 뻗도록 매 프레임 방향을 다시 계산합니다.
    function updateLabelOrientation() {
      if (!camera) return;
      const tmp = new THREE.Vector3();
      beachSprites.forEach(s => {
        s.getWorldPosition(tmp);
        tmp.project(camera);
        const wantLeft = tmp.x < 0;
        if (s.userData.labelOnLeft !== wantLeft) {
          s.userData.labelOnLeft = wantLeft;
          const v = wantLeft ? s.userData.leftVariant : s.userData.rightVariant;
          s.material.map = v.texture;
          s.material.needsUpdate = true;
          s.center.set(v.dotX / v.canvasW, 1 - v.dotY / v.canvasH);
        }
      });
      if (selectionMarker && selectionMarker.visible) {
        selectionMarker.getWorldPosition(tmp);
        tmp.project(camera);
        const wantLeft = tmp.x < 0;
        if (selectionMarker.userData.labelOnLeft !== wantLeft) {
          selectionMarker.userData.labelOnLeft = wantLeft;
          const v = wantLeft ? selectionMarker.userData.leftVariant : selectionMarker.userData.rightVariant;
          if (v) {
            selectionMarker.material.map = v.texture;
            selectionMarker.material.needsUpdate = true;
            selectionMarker.center.set(v.dotX / v.canvasW, 1 - v.dotY / v.canvasH);
          }
        }
      }
    }

    // [ADD] 지구본을 축소(줌아웃)해도 마커가 너무 작아져서 안 보이지 않도록,
    // 카메라 거리에 비례해서 마커의 월드 스케일을 키워 화면상 크기를 어느 정도
    // 일정하게 유지합니다 (거리가 멀어질수록 실제 크기를 키우는 방식).
    function updateBeachSpriteScale() {
      const factor = cameraDistance / 170; // 170 = 기본(리셋) 거리 기준
      beachSprites.forEach(s => {
        const [bw, bh] = s.userData.baseScale;
        s.scale.set(bw * factor, bh * factor, 1);
        // [FIX] "선택하면 원래 있던 글씨가 안 사라지고 겹쳐 보임" - 선택된
        // 해변 정점은 원래(작은) 마커를 숨기고, 그 자리엔 확대된 선택 마커
        // 하나만 보이도록 합니다.
        s.visible = !(selectedStation && s.userData.stationId === selectedStation.id);
      });
      refreshSelectionMarker();
      if (selectionMarker && selectionMarker.visible) {
        const [bw, bh] = selectionMarker.userData.baseScale;
        selectionMarker.scale.set(bw * factor, bh * factor, 1);
      }
      updateLabelOrientation();
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
    // [ADD] 참고 이미지처럼 지구 테두리에 대기권 느낌의 하얀 빛(림 라이트)을
    // 추가합니다. 지구보다 살짝 큰 구를 안쪽 면만 렌더링하고, 시야각이
    // 표면에 거의 스치듯 얕아지는(테두리) 곳일수록 밝아지는 프레넬 효과를
    // 셰이더로 계산합니다.
    function buildAtmosphereGlow() {
      const geometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.025, 64, 64); // [CHANGE] 두께 절반 (1.05 → 1.025)
      const material = new THREE.ShaderMaterial({
        uniforms: { glowColor: { value: new THREE.Color('#cfe8ff') } },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vViewDir = normalize(-mvPosition.xyz);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          varying vec3 vViewDir;
          uniform vec3 glowColor;
          void main() {
            // [CHANGE] 지수를 3.0 → 5.0으로 올려서 얇고 또렷한 띠로, 최대 밝기는 95%로
            float intensity = pow(0.75 - dot(vNormal, vViewDir), 5.0) * 1.6;
            gl_FragColor = vec4(glowColor, clamp(intensity, 0.0, 0.95));
          }
        `,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
      });
      return new THREE.Mesh(geometry, material);
    }

    function buildHeatOverlayTexture() {
      // [FIX] 해상도를 올려서(180x90 → 320x160) 확대했을 때 보이던 계단현상을
      // 줄였습니다. 완전 불투명(1.0)으로 바꿔서 아래 위성 텍스처의 구름(흰색)이
      // 비쳐 보이던 것도 없앴어요 - "여전히 하얀색이 있다"의 실제 원인이
      // 색상표가 아니라 구름이 살짝 비쳐 보이던 거였습니다.
      const W = 320, H = 160;
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
            const dLat = lat - pts[i].lat;
            // [FIX] "뉴질랜드 옆에 세로줄" - 경도차를 그냥 뺄셈으로 구하면
            // 날짜변경선(180도) 근처에서 실제로는 몇 도 안 떨어진 두 지점이
            // 350도 넘게 떨어진 것처럼 계산돼서, 그 지점 정점들의 영향력이
            // 사실상 0이 되어버렸어요(뉴질랜드가 딱 그 경계에 걸쳐 있습니다).
            // -180~180 범위로 정규화해서 "짧은 쪽" 거리를 쓰도록 고쳤습니다.
            let dLon = lon - pts[i].lon;
            if (dLon > 180) dLon -= 360;
            if (dLon < -180) dLon += 360;
            const d = Math.sqrt(dLat * dLat + dLon * dLon);
            if (d < nearest) nearest = d;
            const w = 1 / Math.pow(d + 1, 2);
            wSum += w; tSum += w * pts[i].temp;
          }
          const idw = wSum > 0 ? tSum / wSum : ambient;
          const influence = Math.max(0, Math.min(1, 1 - nearest / 35));
          const finalTemp = ambient * (1 - influence) + idw * influence;

          ctx.fillStyle = `rgba(${getTempColor(finalTemp)}, 1)`;
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
      // [FIX] 아래에서 globeGroup.rotation을 (0.35, -2.1, 0)으로 설정할
      // 예정이라, 장식을 먼저 그 회전의 "역방향"으로 보정해서 넣어야
      // 최종적으로 의도한 화면 위치에 나타납니다.
      const initialRotQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -2.1, 0));
      const initialRotQuatInv = initialRotQuat.clone().invert();
      globeGroup.add(buildSolarSystemDecor(initialRotQuatInv));

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
      globeGroup.add(buildAtmosphereGlow());

      // [ADD] "지구공 상태에서도 NOAA 정점들 보이게" 요청 반영 -
      // 전세계 해양 격자 정점을 여기서 바로 생성해 지구본에도 표시합니다.
      // (이전엔 상세지도 진입 시에만 지연 로드했는데, 육지 판정이 이미
      //  가벼워졌으니 처음부터 만들어도 부담이 적어요.)
      const gridStations = generateOceanGridStations();
      stations = stations.concat(gridStations);
      fullGridLoaded = true;
      refreshMaxTempStation();
      document.getElementById('point-counter').innerText = t.stationCount(stations.length);

      const dotGeometry = new THREE.SphereGeometry(0.55, 6, 6);
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

      // [ADD] "NOAA 정점도 확대 전에 선택 가능하게" - InstancedMesh는 정점 하나하나가
      // 별도 오브젝트가 아니라서, 클릭 시 instanceId로 원래 정점을 찾을 수 있도록
      // 참조를 저장해둡니다.
      gridStationsRef = gridStations;
      instancedDotsRef = instancedDots;

      // 해변 정점 (사람이 알아보는 지명 - 스프라이트로 표시)
      const beachStations = stations.filter(d => d.isBeach);
      beachStations.forEach(st => {
        const sprite = createBeachSprite(st);
        beachSprites.push(sprite);
        globeGroup.add(sprite);
      });

      // [ADD] 선택된 정점 표시용 링 (처음엔 숨김, selectStation 시 표시)
      selectionMarker = createSelectionMarker();
      globeGroup.add(selectionMarker);

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
        updateLabelOrientation();

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
          let matched = false;
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
              matched = true;
              break;
            }
            // [ADD] NOAA 격자 정점(InstancedMesh)은 개별 오브젝트가 아니라
            // instanceId로 어떤 정점인지 찾아야 합니다.
            if (hit.object === instancedDotsRef && typeof hit.instanceId === 'number') {
              const st = gridStationsRef[hit.instanceId];
              if (st) { selectStation(st); matched = true; break; }
            }
          }
          // [FIX] "정점 선택이 잘 안 됨" - 점 자체가 작아서(특히 NOAA 격자)
          // 정확히 맞히기 어려웠어요. 정확히 안 맞았어도 지구 표면은 맞혔다면
          // 그 위경도에서 가장 가까운 정점을 찾아 (일정 범위 안이면) 대신
          // 선택해주는 "관대한 클릭 판정"을 추가했습니다.
          if (!matched && intersects.length > 0) {
            const { lat: cLat, lon: cLon } = worldPointToLatLon(intersects[0].point);
            let nearest = null, nearestDist = Infinity;
            stations.forEach(st => {
              const dLat = cLat - st.coords[1];
              let dLon = cLon - st.coords[0];
              if (dLon > 180) dLon -= 360;
              if (dLon < -180) dLon += 360;
              const d = Math.sqrt(dLat * dLat + dLon * dLon);
              if (d < nearestDist) { nearestDist = d; nearest = st; }
            });
            if (nearest && nearestDist < 4) selectStation(nearest);
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
