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

        // [FIX] "텍스트가 너무 투명해서 안 보여" - 지난번에 라벨 재질에
        // transparent:true를 제대로 켰더니, 원래 코드에 있던 낮은
        // 배경 불투명도(0.72 / 0.28)가 이제야 의도대로 적용되면서
        // 오히려 뒤 배경이 너무 비쳐 보여 글씨가 묻혔어요. 불투명도를 올렸습니다.
        ctx.fillStyle = selected ? 'rgba(249, 115, 22, 0.55)' : 'rgba(15, 23, 42, 0.92)';
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

      // [FIX] "정점 텍스트 뒤로 그림자가 벗겨진다" - 이 재질에 transparent를
      // 안 켜뒀더니(불투명 취급) 라벨 텍스트의 투명한 배경 부분까지 포함해서
      // 사각형 전체가 깊이버퍼에 그대로 찍혔어요. 그래서 나중에 그려지는
      // 낮/밤 그림자가 그 사각형 영역에서는 깊이 테스트에 걸려 아예 안
      // 그려졌던 거예요(그림자가 "벗겨진" 것처럼 보임). transparent:true +
      // depthWrite:false로 고쳐서 실제로 보이는 부분만 영향을 주게 했습니다.
      const material = new THREE.SpriteMaterial({ map: rightVariant.texture, transparent: true, depthTest: true, depthWrite: false });
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
// [ADD] "초기 화면을 내 위치 기반으로" 요청 - 임의의 위경도가 카메라를
// 정면으로 바라보도록 하는 globeGroup 회전값(x, y / z는 항상 0)을 역산합니다.
// getCurrentCenterLatLng()의 반대 방향 계산이에요.
// [ADD] "화면 비율 바뀌면 중앙 다시 정렬, 줌은 유지" 요청 반영 - 세로/가로
// 전환처럼 화면 비율이 크게 바뀌면, 드래그로 쌓인 세로 기울기(rotation.x)
// 때문에 한쪽 반구가 화면 밖으로 밀려 답답해 보일 수 있어요. 좌우 방향
// (rotation.y, "어느 지역을 보고 있었는지")과 줌(cameraDistance)은 그대로
// 두고, 세로 기울기만 기본값으로 되돌립니다.
function recenterGlobeVertical() {
  if (!globeGroup) return;
  globeGroup.rotation.x = 0.35;
  if (typeof updateBeachSpriteScale === 'function') updateBeachSpriteScale();
}

function computeRotationForLatLon(lat, lon) {
  const L = latLonToSpherePos(lat, lon, 1);
  const candidates = [Math.atan2(L.x, -L.z), Math.atan2(-L.x, L.z)];
  const options = candidates.map(y => {
    const c2 = Math.cos(y), s2 = Math.sin(y);
    const A = L.z * c2 - L.x * s2;
    const x = Math.atan2(L.y, A);
    return { x, y };
  });
  // [FIX] "북극을 넘어서 이동, 북반구가 아래로 가버림" - 두 후보 다
  // 대상 지점을 정면으로 향하게 하는 수학적으로 유효한 해였는데(둘 다
  // 오차가 부동소수점 잡음 수준이라 오차 비교로는 구분이 안 됐어요),
  // 북극이 위/아래 어느 쪽을 향하는지는 서로 정반대였습니다. 북극(로컬
  // (0,1,0))이 이 회전 후 실제로 위쪽(+y)을 향하는 조건은 cos(x)>0과
  // 같아서, 그 조건을 만족하는 해를 명시적으로 고릅니다.
  const upright = options.find(o => Math.cos(o.x) > 0) || options[0];
  return { x: upright.x, y: upright.y };
}

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
      const material = new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false });
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
    // [ADD] "지구에 그림자 넣는 건 어때요?" 제안 반영 - 실제 태양 방향
    // 기준으로 낮/밤 경계(터미네이터)를 표현하는 반투명 오버레이 구체입니다.
    // globeGroup의 자식이라 지구/태양과 같은 로컬 좌표계를 쓰고, sunDir도
    // 그 좌표계 기준이라 지구를 돌려도 실제 태양이 비추는 쪽이 항상 맞습니다.
    // [ADD] "태양 빛을 더 받는 부분은 조금 더 밝고, 색온도 4000K 정도로"
    // 요청 반영 - 낮 그림자와 반대 방향으로, 태양을 정면으로 받을수록(적도
    // 근처 한낮) 살짝 밝고 따뜻한(약 4000K, 백열등에 가까운) 톤을 더합니다.
    // 어둡게 하는 건 일반 알파 블렌딩이 맞지만 밝게 하는 건 더하기(additive)
    // 블렌딩이 자연스러워서, 그림자와는 별도의 레이어로 분리했습니다.
    function buildDayWarmGlow(sunDirLocal) {
      const geometry = new THREE.SphereGeometry(GLOBE_RADIUS + 0.18, 64, 64);
      const material = new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: sunDirLocal.clone().normalize() } },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normal;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          uniform vec3 sunDir;
          void main() {
            float facing = clamp(dot(normalize(vNormal), normalize(sunDir)), 0.0, 1.0);
            float intensity = pow(facing, 1.4) * 0.22; // 태양을 정면으로 받을수록 강하게
            vec3 warmTint = vec3(1.0, 0.78, 0.55); // 약 4000K 색온도
            gl_FragColor = vec4(warmTint * intensity, intensity);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      return new THREE.Mesh(geometry, material);
    }

    function buildDayNightShadow(sunDirLocal) {
      const geometry = new THREE.SphereGeometry(GLOBE_RADIUS + 0.2, 64, 64);
      const material = new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: sunDirLocal.clone().normalize() } },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normal; // 로컬(오브젝트) 공간 그대로 - sunDir도 같은 좌표계
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          uniform vec3 sunDir;
          void main() {
            float facing = dot(normalize(vNormal), normalize(sunDir));
            float night = smoothstep(0.15, -0.2, facing); // 0=낮, 1=밤, 경계는 부드럽게
            gl_FragColor = vec4(0.0, 0.01, 0.05, night * 0.72);
          }
        `,
        transparent: true,
        depthWrite: false
      });
      return new THREE.Mesh(geometry, material);
    }

    // [CHANGE] "지구에서 빛이 옆으로 튀어나가게, 렘브란트 조명 같은 효과"
    // 요청 반영 - 기존의 단순한 프레넬 림라이트(시야각 기준, 태양과 무관하게
    // 항상 같은 색/밝기)에 실제 태양 방향을 더했습니다. 태양을 향한 쪽
    // 가장자리는 더 밝고 따뜻한 색으로, 반대쪽은 기존처럼 차분한 하늘색으로
    // 갈라져서, 지구를 태양 반대편(밤쪽)에서 바라볼 때 태양 쪽 가장자리가
    // 유독 환하게 "터져 나오는" 듯한 느낌을 줍니다. 화면에 항상 어느 정도
    // 있다가, 딱 그 각도로 볼 때 극적으로 강해지는 자연스러운 효과예요.
    function buildAtmosphereGlow(sunDirLocal) {
      const geometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.025, 64, 64); // [CHANGE] 두께 절반 (1.05 → 1.025)
      const material = new THREE.ShaderMaterial({
        uniforms: {
          glowColor: { value: new THREE.Color('#cfe8ff') },
          sunGlowColor: { value: new THREE.Color('#fff0c8') },
          sunDir: { value: (sunDirLocal || new THREE.Vector3(0, 0, 1)).clone().normalize() }
        },
        vertexShader: `
          varying vec3 vNormalView;
          varying vec3 vNormalLocal;
          varying vec3 vViewDir;
          void main() {
            vNormalView = normalize(normalMatrix * normal);
            vNormalLocal = normalize(normal); // 로컬 공간 - sunDir와 같은 좌표계
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vViewDir = normalize(-mvPosition.xyz);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vNormalView;
          varying vec3 vNormalLocal;
          varying vec3 vViewDir;
          uniform vec3 glowColor;
          uniform vec3 sunGlowColor;
          uniform vec3 sunDir;
          void main() {
            // [CHANGE] 지수를 3.0 → 5.0으로 올려서 얇고 또렷한 띠로, 최대 밝기는 95%로
            float rim = pow(0.75 - dot(vNormalView, vViewDir), 5.0) * 1.6;
            float facing = dot(vNormalLocal, sunDir); // -1(반대쪽)~1(태양쪽)
            float sunSide = smoothstep(-0.25, 0.55, facing);
            vec3 color = mix(glowColor, sunGlowColor, sunSide);
            float intensity = rim * mix(0.6, 1.9, sunSide);
            gl_FragColor = vec4(color, clamp(intensity, 0.0, 0.95));
          }
        `,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
      });
      return new THREE.Mesh(geometry, material);
    }

    // [CHANGE] "지구 표면 색상(매끈한 히트 오버레이) 빼고 구름 넣자" 요청
    // 반영 - 1700만 번 거리 계산을 하던 무거운 buildHeatOverlayTexture를
    // 완전히 없앴습니다. 대신 정점 데이터와 전혀 무관한(그래서 API 상태와
    // 상관없이 즉시 뜨는) 가벼운 절차적 구름 레이어를 추가했어요 - 실시간
    // 위성사진 느낌을 주면서도 데이터를 기다릴 필요가 없습니다.
    function buildCloudTexture() {
      const W = 512, H = 256;
      const cvs = document.createElement('canvas');
      cvs.width = W; cvs.height = H;
      const c = cvs.getContext('2d');
      c.clearRect(0, 0, W, H);
      for (let i = 0; i < 220; i++) {
        const x = Math.random() * W;
        const y = Math.random() * H;
        const r = 8 + Math.random() * 22;
        const alpha = 0.12 + Math.random() * 0.18;
        const grad = c.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = grad;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
      return new THREE.CanvasTexture(cvs);
    }

    function buildCloudLayer() {
      const geometry = new THREE.SphereGeometry(GLOBE_RADIUS * 1.012, 64, 64);
      const material = new THREE.MeshBasicMaterial({
        map: buildCloudTexture(), transparent: true, depthWrite: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1; // 낮/밤 그림자·라벨보다는 아래, 지구 표면보다는 위
      return mesh;
    }

    // [ADD] "바다에 실제 수온 색상 다시 넣자 (1번)" 요청 반영 - 예전 방식은
    // 브라우저에서 1700만 번 거리 계산(IDW)을 해서 로딩이 멈췄었는데, 이번엔
    // 계산이 전혀 없습니다. NOAA 위성 수온(OISST, 1° 격자)을 /api/sst에서
    // 받아서 360×180 캔버스에 정점 마커와 "똑같은 색상표(getTempColor)"로
    // 칠하기만 해요. 진짜 관측 데이터라 마커 색·범례와도 일치합니다.
    // /api/sst는 Vercel에서만 동작해서, 로컬 파일로 열면 조용히 건너뜁니다
    // (나머지 앱은 그대로 동작).
    const SST_LAYER_OPACITY = 0.55; // 위성사진 지형이 비쳐 보이도록 반투명
    async function loadSstLayer() {
      try {
        const res = await fetch('/api/sst');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const W = data.w, H = data.h;
        const cvs = document.createElement('canvas');
        cvs.width = W; cvs.height = H;
        const c = cvs.getContext('2d');
        const img = c.createImageData(W, H);
        for (let i = 0; i < W * H; i++) {
          const raw = data.v[i];
          if (raw == null) continue; // 육지/해빙 → 투명
          const rgb = String(getTempColor(raw * data.scale)).split(',').map(Number);
          img.data[i * 4] = rgb[0];
          img.data[i * 4 + 1] = rgb[1];
          img.data[i * 4 + 2] = rgb[2];
          img.data[i * 4 + 3] = 255;
        }
        c.putImageData(img, 0, 0);

        const texture = new THREE.CanvasTexture(cvs);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter; // 1° 격자를 부드럽게 보간
        const geometry = new THREE.SphereGeometry(GLOBE_RADIUS + 0.1, 96, 96);
        const material = new THREE.MeshBasicMaterial({
          map: texture, transparent: true, opacity: 0, depthWrite: false
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 0.5; // 지구 표면 위, 구름(1)·햇빛(2)·그림자(3) 아래
        globeGroup.add(mesh);
        sstMeshRef = mesh;
        sstDataDate = data.date;

        // 갑자기 "팍" 나타나지 않게 1.2초 동안 서서히 페이드인
        const t0 = performance.now();
        (function fade(now) {
          const k = Math.min(1, (now - t0) / 1200);
          material.opacity = SST_LAYER_OPACITY * k;
          if (k < 1) requestAnimationFrame(fade);
        })(t0);
      } catch (e) {
        console.info('[sst-layer] 위성 수온 레이어를 건너뜁니다 (로컬 실행이거나 NOAA 응답 없음):', e.message);
      }
    }

    // [ADD] "바다에 햇빛 반사(sun glint) 넣자 (2번)" 요청 반영 - 실제 태양
    // 방향(sunDir)과 카메라 방향의 중간 벡터로 반사광을 계산해서, 태양이
    // 바다에 비치는 딱 그 지점에만 반짝임이 생깁니다. 지구를 돌리면 반사
    // 지점도 실제 물리처럼 따라 움직여요. 육지에는 반사가 안 생기도록
    // 위성사진(blue marble)의 "짙은 파란색 = 바다" 여부로 가려냅니다.
    function buildSunGlint(sunDirLocal, earthTexture) {
      const geometry = new THREE.SphereGeometry(GLOBE_RADIUS + 0.15, 96, 96);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          sunDir: { value: sunDirLocal.clone().normalize() },
          earthMap: { value: earthTexture }
        },
        vertexShader: `
          uniform vec3 sunDir;       // globeGroup 로컬 좌표
          varying vec3 vNormalW;
          varying vec3 vViewDirW;
          varying vec3 vSunDirW;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vNormalW = normalize(mat3(modelMatrix) * normal);
            vSunDirW = normalize(mat3(modelMatrix) * sunDir); // modelMatrix는 버텍스 셰이더에서만 쓸 수 있어요
            vViewDirW = normalize(cameraPosition - worldPos.xyz);
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
        fragmentShader: `
          uniform sampler2D earthMap;
          varying vec3 vNormalW;
          varying vec3 vViewDirW;
          varying vec3 vSunDirW;
          varying vec2 vUv;
          void main() {
            vec3 base = texture2D(earthMap, vUv).rgb;
            // 바다 판별: 파랑이 빨강보다 확실히 강하고, 얼음/구름처럼 밝지 않은 곳
            float oceanMask = smoothstep(0.02, 0.10, base.b - base.r) * (1.0 - smoothstep(0.45, 0.65, dot(base, vec3(0.333))));
            vec3 n = normalize(vNormalW);
            vec3 l = normalize(vSunDirW);
            vec3 v = normalize(vViewDirW);
            float lit = step(0.0, dot(n, l)); // 밤쪽엔 반사 없음
            vec3 h = normalize(l + v);
            float nh = max(dot(n, h), 0.0);
            float core = pow(nh, 400.0) * 1.1;  // 작고 강한 반짝임
            float halo = pow(nh, 40.0) * 0.18;  // 넓게 퍼지는 은은한 반사
            float glint = (core + halo) * oceanMask * lit;
            gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * glint, glint);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 2.5; // 햇빛 온기(2) 위, 밤 그림자(3) 아래
      return mesh;
    }

    // [CHANGE] "로딩 화면 만들어서 작은 지구만 먼저 보여주자" 요청 반영 -
    // 기존 initThreeGlobe()를 둘로 쪼갰습니다.
    // 1) initEarlyScene(): 정점 데이터 없이도 바로 그릴 수 있는 것들
    //    (별/은하수/행성/실제 태양·달/지구본 본체/대기/낮밤그림자) - 페이지
    //    로딩 즉시 실행, 카메라는 멀리(BOOT_DIST)서 시작해서 작게 보입니다.
    // 2) addStationLayers(): 정점 데이터가 검증까지 끝난 뒤에만 그릴 수 있는 것
    //    (히트필드, NOAA 격자, 해변 마커, 선택 마커, 기본 정점 선택)
    function initEarlyScene() {
      const container = document.getElementById('globe-canvas-container');
      const width = container.clientWidth;
      const height = container.clientHeight;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 3200);
      cameraDistance = BOOT_DIST; // 로딩 중엔 멀리서 시작해 작은 지구로 보이게
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

      // [ADD] "태양은 실시간 실제 위치로, 달도 가능하면" - astronomy.js로
      // 계산한 실제 태양/달 직하점 기준으로 배치합니다.
      // [CHANGE] "태양/달을 실시간으로 움직이게" 요청 반영 - 위치/그림자
      // 참조를 전역에 저장해둬서, 나중에 주기적으로 다시 계산할 때
      // 장면을 새로 만들지 않고 이 객체들의 위치·유니폼만 갱신합니다.
      const celestial = buildRealSunAndMoon();
      globeGroup.add(celestial.group);
      sunSpriteRef = celestial.sunSprite;
      mercurySpriteRef = celestial.mercurySprite;
      venusSpriteRef = celestial.venusSprite;
      moonGroupRef = celestial.moonGroup;
      moonShadowMaterialRef = celestial.moonShadowMaterial;
      const sunDirLocal = celestial.sunDirLocal;

      // 위성 지구본 본체
      const globeGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
      const textureLoader = new THREE.TextureLoader();
      const earthTexture = textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
      const globeMaterial = new THREE.MeshBasicMaterial({ map: earthTexture });
      globeMesh = new THREE.Mesh(globeGeometry, globeMaterial);
      globeGroup.add(globeMesh);

      // [ADD] "지구에 그림자 넣는 건 어때요" - 실제 태양 방향 기준 낮/밤 그림자
      // [FIX] "바다에는 그림자가 안 보인다" - 실제 원인은 heatMesh(바다 색상)가
      // 정점 데이터 도착 후에야(addStationLayers에서) 나중에 추가되는데,
      // 반투명 구체들이 전부 지구 중심이 같아서 three.js가 거리로 그리는
      // 순서를 못 정하고 "추가된 순서"로 그렸던 거예요. 그래서 나중에
      // 추가된 heatMesh가 먼저 그려둔 그림자를 그대로 덮어써버렸습니다.
      // renderOrder를 명시해서 항상 "바다색 → 그림자 → 대기" 순서로
      // 그려지도록 고정했습니다.
      const warmGlowMesh = buildDayWarmGlow(sunDirLocal);
      warmGlowMesh.renderOrder = 2;
      globeGroup.add(warmGlowMesh);
      warmGlowMaterialRef = warmGlowMesh.material;
      const shadowMesh = buildDayNightShadow(sunDirLocal);
      shadowMesh.renderOrder = 3;
      globeGroup.add(shadowMesh);
      shadowMaterialRef = shadowMesh.material;
      const atmosphereMesh = buildAtmosphereGlow(sunDirLocal);
      atmosphereMesh.renderOrder = 4;
      globeGroup.add(atmosphereMesh);
      atmosphereMaterialRef = atmosphereMesh.material;

      // [ADD] "색상 빼고 구름 넣자" - 정점 데이터와 무관해서 API 상태와
      // 상관없이 바로 뜨는 구름 레이어. 지구 자체(사용자 드래그)와는
      // 별개로 아주 천천히 자체적으로도 흘러가게 해서 "살아있는 행성"
      // 느낌을 더합니다.
      cloudMesh = buildCloudLayer();
      globeGroup.add(cloudMesh);

      // [ADD] 바다 햇빛 반사 + 위성 실측 수온 레이어 (수온은 비동기로 도착하는 대로)
      const glintMesh = buildSunGlint(sunDirLocal, earthTexture);
      globeGroup.add(glintMesh);
      glintMaterialRef = glintMesh.material;
      loadSstLayer();

      // 태평양 방면 기본 회전
      globeGroup.rotation.set(0.35, -2.1, 0);

      // [ADD] "태양/달을 실시간으로 움직이게" 요청 반영 - 처음 만들 때
      // 딱 한 번만 계산해서 이후엔 화면을 몇 시간 켜둬도 그대로 멈춰
      //있었어요. 5분마다 실제 태양/달 직하점을 다시 계산해서, 이미
      // 만들어둔 객체들의 위치와 그림자 방향만 조용히 갱신합니다(장면을
      // 다시 만들지 않아서 가볍습니다). 5분 간격인 이유는 태양의 겉보기
      // 이동이 시간당 15도 정도라, 5분이면 약 1.25도라 눈에 띄는 끊김
      // 없이 충분히 부드러워요.
      updateCelestialPositions();
      setInterval(updateCelestialPositions, 5 * 60 * 1000);

      setupGlobeInteraction(container, width, height);

      function animate() {
        requestAnimationFrame(animate);
        if (cloudMesh) cloudMesh.rotation.y += 0.0003;
        renderer.render(scene, camera);
      }
      animate();

      updateZoomGauge();
    }

    // 정점 데이터가 준비된 뒤에만 그릴 수 있는 레이어들
    // [FIX] "로딩 97%에서 멈추고, 그 사이 대륙 버튼/검색창이 먹통이 됨" -
    // 진짜 원인을 찾았어요. addStationLayers()가 완전히 동기(블로킹) 함수라,
    // 히트필드 텍스처 계산 + 격자 정점 2500여 개 + 해변 스프라이트 340여 개
    // (캔버스 텍스처 2장씩)를 만드는 동안 자바스크립트 메인 스레드가 통째로
    // 막혀서, 그 몇 초 동안은 클릭이든 타이핑이든 브라우저가 아예 못
    // 받았던 거예요. 무거운 단계마다 브라우저에게 잠깐씩 제어권을
    // 넘겨주는(yield) 방식으로 바꿔서, 그 사이사이 입력을 처리할 틈을 줍니다.
    function yieldToMain() {
      return new Promise(resolve => setTimeout(resolve, 0));
    }

    // [CHANGE] "색상은 추정값으로 먼저 칠하고 실데이터는 클릭 시/백그라운드로"
    // 요청 반영 - 이제 네트워크 검증을 전혀 기다리지 않고, 정점 생성 시
    // 이미 계산돼 있던 추정 온도(curTemp)로 바로 그립니다. 실데이터는
    // 부팅이 끝난 뒤 백그라운드에서 validateStationsInBackground()가
    // 따라오면서 이 자리에 이미 그려진 색만 조용히 고쳐줍니다.
    async function addStationLayers(onProgress) {
      document.getElementById('point-counter').innerText = t.stationCount(stations.length);

      const gridStations = stations.filter(s => !s.isBeach);

      const dotGeometry = new THREE.SphereGeometry(0.55, 6, 6);
      const dotMaterial = new THREE.MeshBasicMaterial();
      const instancedDots = new THREE.InstancedMesh(dotGeometry, dotMaterial, gridStations.length);
      const dummy = new THREE.Object3D();
      const colorHelper = new THREE.Color();
      gridStations.forEach((st, i) => {
        st.__gridIndex = i; // [ADD] 백그라운드 검증에서 이 정점의 InstancedMesh
        // 자리를 O(1)로 바로 찾기 위해 저장해둡니다 (매번 배열을 뒤지지 않도록)
        const pos = latLonToSpherePos(st.coords[1], st.coords[0], GLOBE_RADIUS + 0.25);
        dummy.position.copy(pos);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        instancedDots.setMatrixAt(i, dummy.matrix);
        colorHelper.setStyle(`rgb(${getTempColor(st.curTemp)})`);
        instancedDots.setColorAt(i, colorHelper);
      });
      instancedDots.instanceMatrix.needsUpdate = true;
      instancedDots.instanceColor.needsUpdate = true;
      globeGroup.add(instancedDots);
      await yieldToMain();

      // [ADD] "NOAA 정점도 확대 전에 선택 가능하게" - InstancedMesh는 정점 하나하나가
      // 별도 오브젝트가 아니라서, 클릭 시 instanceId로 원래 정점을 찾을 수 있도록
      // 참조를 저장해둡니다.
      gridStationsRef = gridStations;
      instancedDotsRef = instancedDots;

      // 해변 정점 (사람이 알아보는 지명 - 스프라이트로 표시)
      // [FIX] "정점 텍스트가 바다색 아래로 들어감 / 저녁에 어두워짐" - 둘 다
      // 같은 원인이었어요. warmGlow(=2)/shadow(=3)/atmosphere(=4)는
      // renderOrder를 지정했는데 정작 라벨 스프라이트엔 안 줬어서 기본값 0으로
      // "가장 먼저" 그려졌고, 그 위에 그림자가 나중에 덧그려지면서
      // 라벨을 가려버렸던 거예요(밤에는 그림자가 진하니 더 두드러졌고요).
      // 라벨을 그 무엇보다도 나중에(맨 위에) 그리도록 renderOrder를 높게 줍니다.
      const beachStations = stations.filter(d => d.isBeach);
      for (let i = 0; i < beachStations.length; i++) {
        const st = beachStations[i];
        const sprite = createBeachSprite(st);
        sprite.renderOrder = 10;
        beachSprites.push(sprite);
        globeGroup.add(sprite);
        if (onProgress) onProgress(i + 1, beachStations.length);
        // [ADD] 40개마다 한 번씩 브라우저에게 제어권을 넘겨서 그 사이
        // 입력(클릭/타이핑)을 처리할 수 있게 합니다.
        if (i % 40 === 39) await yieldToMain();
      }

      // [ADD] 선택된 정점 표시용 링 (처음엔 숨김, selectStation 시 표시)
      selectionMarker = createSelectionMarker();
      selectionMarker.renderOrder = 11;
      globeGroup.add(selectionMarker);

      const defaultSpot = stations.find(s => s.name.includes("Ocean Beach")) || stations[0];
      selectStation(defaultSpot);
    }

    // [ADD] "추정값으로 먼저 칠하고 실데이터는 백그라운드로 천천히" 요청
    // 반영 - 부팅이 끝난 뒤(화면이 이미 다 보이는 상태에서) 호출됩니다.
    // 이미 그려진 격자 점 색깔을 실데이터가 도착하는 대로 그 자리에서
    // 고쳐주기만 해서, 사용자는 로딩을 기다리지 않아도 됩니다. 격자
    // 정점 중 실제로 데이터가 없는 곳(육지 근처 등)은 조용히 숨기고,
    // 해변 정점은 실제 지명이라 검증에 실패해도 계속 보여줍니다(그
    // 정점을 클릭하면 그때 다시 한번 개별적으로 시도해요).
    async function validateStationsInBackground() {
      const CHUNK = 90;
      const chunks = [];
      for (let i = 0; i < stations.length; i += CHUNK) chunks.push(stations.slice(i, i + CHUNK));

      const dummy = new THREE.Object3D();
      const colorHelper = new THREE.Color();
      let colorDirty = false, matrixDirty = false;

      function flush() {
        if (!instancedDotsRef) return;
        if (colorDirty) { instancedDotsRef.instanceColor.needsUpdate = true; colorDirty = false; }
        if (matrixDirty) { instancedDotsRef.instanceMatrix.needsUpdate = true; matrixDirty = false; }
      }

      const CONCURRENCY = 4;
      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const batch = chunks.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (chunk) => {
          let results;
          try {
            results = await batchCheckHasData(chunk);
          } catch (e) {
            return; // 이 묶음은 실패 - 남은 정점은 추정값 그대로 둠(다음 클릭 시 개별 재시도됨)
          }
          chunk.forEach((st, idx) => {
            const r = results[idx];
            if (r.ok && r.temp != null) {
              st.curTemp = +r.temp.toFixed(1);
              st._liveCurrentVerified = true;
              if (typeof st.__gridIndex === 'number' && instancedDotsRef) {
                colorHelper.setStyle(`rgb(${getTempColor(st.curTemp)})`);
                instancedDotsRef.setColorAt(st.__gridIndex, colorHelper);
                colorDirty = true;
              }
            } else if (!r.ok && typeof st.__gridIndex === 'number' && instancedDotsRef) {
              // 격자 정점인데 실제로 이 지점엔 데이터가 없음 - 크기를 0으로 줄여서 숨김
              dummy.position.set(0, 0, 0);
              dummy.scale.set(0, 0, 0);
              dummy.updateMatrix();
              instancedDotsRef.setMatrixAt(st.__gridIndex, dummy.matrix);
              matrixDirty = true;
            }
          });
        }));
        flush();
        await yieldToMain();
      }
      flush();
      refreshMaxTempStation();
    }

    // [ADD] "로딩 끝나면 화면 회전하면서 지구로 줌인" 요청 반영 - 멀리서
    // 시작한 카메라를 기본 거리까지 당기면서, 동시에 한 바퀴 더 돌아
    // 최종 방향(targetRotX, targetRotY)에 착지하는 연출입니다.
    // [ADD] "대륙 버튼 눌러도 반응이 없어" 요청 반영 - 부팅 위젯에서 뭔가
    // 고르면(대륙/내 위치/검색), 정점 로딩이 끝나길 기다리지 않고 지구를
    // 즉시 그 방향으로 예비 회전시켜서 "눌렸다"는 걸 바로 보여줍니다.
    // 나중에 로딩이 끝나 animateBootZoomIn이 실행될 때는 이미 그 방향을
    // 보고 있으니 줌(확대)만 자연스럽게 이어집니다.
    // [FIX] "대륙 버튼을 바꿔 눌러도 두번째부터는 적용이 안 돼" - 진짜
    // 원인을 찾았어요. 이 함수를 연달아 여러 번 호출하면(대륙 A 클릭 후
    // 애니메이션이 채 안 끝났는데 대륙 B를 또 클릭), 이전 호출의
    // requestAnimationFrame 루프가 안 멈추고 계속 돌면서 새 애니메이션과
    // 같은 rotation.x/y 값을 두고 매 프레임 서로 덮어쓰는 레이스
    // 컨디션이었어요. 호출마다 고유 세대(generation) ID를 매겨서, 더
    // 최신 호출이 생기면 이전 루프는 그 즉시 스스로 멈추도록 고쳤습니다.
    let __globeRotAnimGen = 0;
    // [ADD] "태양/달을 실시간으로 움직이게" 요청 반영 - 실제 태양/달
    // 직하점을 다시 계산해서, 이미 장면에 있는 객체들의 위치와 그림자
    // 방향(sunDir 유니폼)만 갱신합니다. 새로 만들지 않아서 가볍고, 화면
    // 깜빡임도 없습니다.
    function updateCelestialPositions() {
      const now = new Date();
      const sun = computeSubsolarPoint(now);
      const moon = computeSublunarPoint(now);
      const sunDirLocal = latLonToSpherePos(sun.lat, sun.lon, 1).normalize();

      if (sunSpriteRef) sunSpriteRef.position.copy(latLonToSpherePos(sun.lat, sun.lon, 900));
      if (mercurySpriteRef) mercurySpriteRef.position.copy(latLonToSpherePos(sun.lat + 9, sun.lon - 11, 560));
      if (venusSpriteRef) venusSpriteRef.position.copy(latLonToSpherePos(sun.lat - 6, sun.lon + 13, 600));
      if (moonGroupRef) moonGroupRef.position.copy(latLonToSpherePos(moon.lat, moon.lon, 400));
      if (moonShadowMaterialRef) moonShadowMaterialRef.uniforms.sunDir.value.copy(sunDirLocal);
      if (shadowMaterialRef) shadowMaterialRef.uniforms.sunDir.value.copy(sunDirLocal);
      if (warmGlowMaterialRef) warmGlowMaterialRef.uniforms.sunDir.value.copy(sunDirLocal);
      if (atmosphereMaterialRef) atmosphereMaterialRef.uniforms.sunDir.value.copy(sunDirLocal);
      if (glintMaterialRef) glintMaterialRef.uniforms.sunDir.value.copy(sunDirLocal);
    }

    function animateGlobeRotationTo(targetX, targetY, duration) {
      if (!globeGroup) return;
      const myGen = ++__globeRotAnimGen;
      const startX = globeGroup.rotation.x, startY = globeGroup.rotation.y;
      const t0 = performance.now();
      function step(now) {
        if (myGen !== __globeRotAnimGen) return; // 더 최신 호출이 있으면 이 루프는 중단
        const t = Math.min(1, (now - t0) / (duration || 700));
        const ease = 1 - Math.pow(1 - t, 3);
        globeGroup.rotation.x = startX + (targetX - startX) * ease;
        globeGroup.rotation.y = startY + (targetY - startY) * ease;
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    function animateBootZoomIn(targetRotX, targetRotY, onComplete) {
      const startDist = cameraDistance;
      const endDist = 270;
      const startRotY = globeGroup.rotation.y;
      const startRotX = globeGroup.rotation.x;
      const spinExtra = Math.PI * 2;
      const t0 = performance.now();
      const duration = 2200;
      function step(now) {
        const t = Math.min(1, (now - t0) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        cameraDistance = startDist + (endDist - startDist) * ease;
        camera.position.z = cameraDistance;
        globeGroup.rotation.y = startRotY + (targetRotY + spinExtra - startRotY) * ease;
        globeGroup.rotation.x = startRotX + (targetRotX - startRotX) * ease;
        updateBeachSpriteScale();
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          cameraDistance = endDist;
          camera.position.z = endDist;
          globeGroup.rotation.set(targetRotX, targetRotY, 0);
          updateZoomGauge();
          if (onComplete) onComplete();
        }
      }
      requestAnimationFrame(step);
    }

    // 드래그 회전 + 핀치줌 + 클릭선택 인터랙션 설정 (정점 데이터 없이도 등록 가능 -
    // 실제 클릭 판정은 나중에 호출될 때 그 시점의 stations를 참조합니다)
    function setupGlobeInteraction(container, width, height) {
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
            // [FIX] "축소하면 정확히 클릭해야만 선택됨" - 고정 각도(4도)
            // 반경이 문제였어요. 확대했을 때 화면 몇 픽셀은 아주 작은
            // 각도 차이지만, 축소했을 때 같은 픽셀 차이는 훨씬 큰 각도
            // 차이가 돼요. 그래서 고정 반경은 축소 시 너무 빡빡했습니다.
            // 줌 정도(cameraDistance)에 비례해서 판정 반경을 늘려줍니다.
            const zoomRatio = Math.max(0, Math.min(1, (cameraDistance - MIN_DIST) / (MAX_DIST - MIN_DIST)));
            const clickThreshold = 1.5 + zoomRatio * 6.5; // 확대 시 1.5도 ~ 축소 시 8도
            if (nearest && nearestDist < clickThreshold) selectStation(nearest);
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
    }

    // [ADD] 전체화면 버튼. 안드로이드 Chrome 등에서는 Fullscreen API로 주소창까지
    // 완전히 숨길 수 있습니다. iOS Safari는 이 API를 사실상 지원하지 않아서
    // (일부 최신 버전만 제한적으로 지원) 그 경우엔 "홈 화면에 추가" 방법을 안내합니다.
