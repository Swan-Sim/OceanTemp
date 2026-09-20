    // [ADD] 줌아웃했을 때도 심심하지 않게 배경 별과 태양/달/행성을 장식용으로 띄웁니다.
    // 실제 천문학적 위치·크기 비율이 아니라 순전히 시각적 장식(이스터에그)입니다.
    function createGlowSprite(colorHex, sizePx, ringColorHex) {
      const cvs = document.createElement('canvas');
      cvs.width = 128; cvs.height = 128;
      const c = cvs.getContext('2d');
      const cx = 64, cy = 64;

      if (ringColorHex) {
        c.save();
        c.translate(cx, cy);
        c.rotate(-0.4);
        c.scale(1, 0.35);
        c.beginPath();
        c.arc(0, 0, 56, 0, Math.PI * 2);
        c.strokeStyle = ringColorHex;
        c.lineWidth = 8;
        c.globalAlpha = 0.7;
        c.stroke();
        c.restore();
      }

      const grad = c.createRadialGradient(cx, cy, 0, cx, cy, 40);
      grad.addColorStop(0, colorHex);
      grad.addColorStop(0.6, colorHex);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(cx, cy, 40, 0, Math.PI * 2);
      c.fill();

      const texture = new THREE.CanvasTexture(cvs);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(sizePx, sizePx, 1);
      return sprite;
    }

    // [ADD] 은하수(밀키웨이) 배경띠. 별과 마찬가지로 scene에 붙여서
    // 지구를 드래그해도 같이 돌지 않고 고정된 먼 배경으로 유지합니다.
    function buildMilkyWayGlowTexture() {
      const cvs = document.createElement('canvas');
      cvs.width = 64; cvs.height = 64;
      const c = cvs.getContext('2d');
      const grad = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,250,240,0.95)');
      grad.addColorStop(0.4, 'rgba(235,210,175,0.4)');
      grad.addColorStop(1, 'rgba(235,210,175,0)');
      c.fillStyle = grad;
      c.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cvs);
    }

    // [ADD] 은하수 띠 전체를 은은하게 덮는 큰 헤이즈(뿌연 발광) 패치 -
    // 참고 이미지처럼 하나의 몽글몽글한 띠 느낌을 살리기 위한 배경층입니다.
    function buildMilkyWayHaze(tiltX, tiltZ, cosX, sinX, cosZ, sinZ) {
      const group = new THREE.Group();
      const patchCount = 12;
      for (let i = 0; i < patchCount; i++) {
        // [CHANGE] "은하수가 안 보인다" - 배경(별)보다 훨씬 먼 거리(1500+)에
        // 두다 보니 화면에서 거의 안 잡혔어요. 훨씬 가깝게 당기고 패치도 키웠습니다.
        const r = 950 + Math.random() * 150;
        const along = (i / patchCount) * Math.PI * 2 + Math.random() * 0.3;
        const x0 = Math.cos(along) * r;
        const z0 = Math.sin(along) * r;
        const y0 = (Math.random() - 0.5) * 45;
        const y1 = y0 * cosX - z0 * sinX;
        const z1 = y0 * sinX + z0 * cosX;
        const x1 = x0 * cosZ - y1 * sinZ;
        const y2 = x0 * sinZ + y1 * cosZ;

        const sprite = createGlowSprite('rgba(255,235,205,0.6)', 480);
        sprite.material.blending = THREE.AdditiveBlending;
        sprite.material.opacity = 0.5;
        sprite.position.set(x1, y2, z1);
        group.add(sprite);
      }
      return group;
    }

    function buildMilkyWay() {
      const group = new THREE.Group();
      const count = 9000;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const tiltX = 0.75, tiltZ = 0.35; // 은하수 띠의 기울기(순전히 장식용 값)
      const cosX = Math.cos(tiltX), sinX = Math.sin(tiltX);
      const cosZ = Math.cos(tiltZ), sinZ = Math.sin(tiltZ);

      for (let i = 0; i < count; i++) {
        // [CHANGE] 별(1400~1800)보다 훨씬 안쪽(900~1200)으로 당겨서 실제로 잘 보이게
        const r = 900 + Math.random() * 300;
        const along = Math.random() * Math.PI * 2;
        // [CHANGE] 균일 분포 대신 가우시안에 가깝게(3개 랜덤값 평균) 흩어서
        // 띠 중심부가 더 밀도 있게 보이도록 했습니다 (참고 이미지의 몽글한 느낌).
        const g = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
        const spread = g * 0.22;
        const x0 = Math.cos(along) * r;
        const z0 = Math.sin(along) * r;
        const y0 = spread * r;

        const y1 = y0 * cosX - z0 * sinX;
        const z1 = y0 * sinX + z0 * cosX;
        const x1 = x0 * cosZ - y1 * sinZ;
        const y2 = x0 * sinZ + y1 * cosZ;

        positions[i * 3] = x1;
        positions[i * 3 + 1] = y2;
        positions[i * 3 + 2] = z1;

        // 중심부는 밝은 흰색, 가장자리로 갈수록 따뜻한 황갈색(성간먼지 느낌)
        const core = 1 - Math.min(1, Math.abs(spread) / 0.22);
        const warm = 0.55 + Math.random() * 0.2;
        colors[i * 3] = 0.9 + core * 0.1;
        colors[i * 3 + 1] = warm + core * (0.95 - warm);
        colors[i * 3 + 2] = (warm - 0.15) + core * (0.95 - (warm - 0.15));
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: 10, map: buildMilkyWayGlowTexture(), vertexColors: true,
        transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending,
        depthWrite: false, sizeAttenuation: true
      });
      group.add(new THREE.Points(geo, mat));
      group.add(buildMilkyWayHaze(tiltX, tiltZ, cosX, sinX, cosZ, sinZ));
      return group;
    }

    function buildStarfield() {
      const count = 3000;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const r = 1400 + Math.random() * 400;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: true, transparent: true, opacity: 0.85 });
      return new THREE.Points(geo, mat);
    }

    function buildSolarSystemDecor(invQuaternion) {
      const group = new THREE.Group();
      // [CHANGE] 태양/수성/금성은 이제 buildRealSunAndMoon()에서 실제 태양
      // 직하점 기준으로 배치합니다. 여기 남은 바깥 행성들은 실제 궤도
      // 계산까지는 하지 않는 순수 장식이라, 기존처럼 고정 화면 위치(초기
      // 회전의 역변환 보정)로 흩어서 배치합니다.
      const bodies = [
        { color: '#c1440e', size: 28, pos: [-440, 230, -650] },  // 화성 (왼쪽 위)
        { color: '#d8a774', size: 80, pos: [-220, -300, -880] }, // 목성 (왼쪽 아래, 더 멀리)
        { color: '#e3c78a', size: 68, pos: [270, -280, -920], ring: 'rgba(210,190,150,0.7)' }, // 토성 (오른쪽 아래)
        { color: '#a9d8e0', size: 40, pos: [-470, -60, -970] },  // 천왕성 (왼쪽 멀리)
        { color: '#5b7fe0', size: 40, pos: [110, 320, -1000] }   // 해왕성 (위쪽 멀리)
      ];
      bodies.forEach(b => {
        const sprite = createGlowSprite(b.color, b.size, b.ring);
        const pos = new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]);
        if (invQuaternion) pos.applyQuaternion(invQuaternion);
        sprite.position.copy(pos);
        group.add(sprite);
      });
      return group;
    }

    // [ADD] "태양 위치는 실시간 실제 위치로, 달도 실시간 위치로" 요청 반영.
    // astronomy.js의 태양/달 직하점 계산을 이용해서, latLonToSpherePos로
    // globeGroup 로컬 좌표계(지구 표면과 같은 기준)에 배치합니다. 이렇게
    // 하면 지구를 드래그로 돌려도 태양/달이 실제로 비추는 지점과 항상
    // 일치하게 따라다녀요. 수성·금성은 실제 궤도 계산까지는 안 하지만,
    // "태양 근처"라는 사실만큼은 실제 태양 방향 근처에 배치해서 지킵니다.
    function buildRealSunAndMoon() {
      const now = new Date();
      const sun = computeSubsolarPoint(now);
      const moon = computeSublunarPoint(now);

      const group = new THREE.Group();

      const sunSprite = createGlowSprite('#fff4d6', 180);
      sunSprite.position.copy(latLonToSpherePos(sun.lat, sun.lon, 750));
      group.add(sunSprite);

      const mercurySprite = createGlowSprite('#b5a897', 24);
      mercurySprite.position.copy(latLonToSpherePos(sun.lat + 9, sun.lon - 11, 560));
      group.add(mercurySprite);

      const venusSprite = createGlowSprite('#e8d9b5', 32);
      venusSprite.position.copy(latLonToSpherePos(sun.lat - 6, sun.lon + 13, 600));
      group.add(venusSprite);

      const moonSprite = createGlowSprite('#e0e0e0', 95);
      moonSprite.position.copy(latLonToSpherePos(moon.lat, moon.lon, 400));
      group.add(moonSprite);

      // 낮/밤 그림자 셰이더에 넘길 "태양 방향(로컬 단위벡터)"도 같이 반환
      const sunDirLocal = latLonToSpherePos(sun.lat, sun.lon, 1);
      return { group, sunDirLocal };
    }

