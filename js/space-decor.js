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

    // [ADD] "달이 발광하고 있어서 태양이랑 헷갈려" - 다른 행성들과 같은
    // 발광 글로우 텍스처 대신, 달만 매트한 회색 표면 + 크레이터 느낌의
    // 얼룩을 넣어서 "빛나는 것"이 아니라 "빛을 반사하는 돌덩이"처럼 보이게 합니다.
    // [ADD] 은하수(밀키웨이) 배경띠. 별과 마찬가지로 scene에 붙여서
    // 지구를 드래그해도 같이 돌지 않고 고정된 먼 배경으로 유지합니다.
    // [CHANGE] "은하수가 여러 개의 렌즈 플레어처럼 보인다" 요청 반영 -
    // 원인은 개별 발광 스프라이트를 여러 개(포인트 9000개 + 헤이즈 패치
    // 12개) 흩뿌리는 방식이라, 하나하나가 따로 도드라져 보였던 거예요.
    // 첨부하신 사진을 실제 텍스처로 그대로 쓸 수는 없지만(외부에 호스팅된
    // 파일이 아니라 이 대화에만 업로드된 이미지라 배포된 웹페이지에서
    // 불러올 수 없어요), 그 사진의 "부드럽게 이어진 하나의 띠 + 어두운
    // 먼지대" 느낌을 캔버스에 직접 그려서 하나의 이음매 없는 그림으로
    // 만들고, 그 그림을 구체 안쪽 면(스카이박스, side: BackSide)에
    // 통째로 입혔습니다. "오목렌즈로 가운데를 민" 것과 비슷하게, 구체
    // 표면에 입혀지면서 자연스럽게 안쪽으로 휘어 보이는 배경이 됩니다.
    function buildMilkyWaySkyboxTexture() {
      const W = 2048, H = 1024;
      const cvs = document.createElement('canvas');
      cvs.width = W; cvs.height = H;
      const c = cvs.getContext('2d');
      c.clearRect(0, 0, W, H);

      // 카메라가 기본적으로 바라보는 방향(위경도 0, 90 지점)에 띠 중심을 맞춰서
      // 지구를 돌리지 않아도 기본 화면에서 바로 보이게 합니다.
      const centerX = W * 0.75;
      const centerY = H * 0.5;
      const bandAngle = -0.3;

      // 1) 부드러운 타원형 헤이즈 - 겹겹이 쌓아서 하나의 이어진 안개 띠로
      c.save();
      c.translate(centerX, centerY);
      c.rotate(bandAngle);
      c.scale(3.4, 1);

      let grad = c.createRadialGradient(0, 0, 0, 0, 0, 260);
      grad.addColorStop(0, 'rgba(255,222,175,0.55)');
      grad.addColorStop(0.45, 'rgba(255,185,120,0.3)');
      grad.addColorStop(1, 'rgba(255,185,120,0)');
      c.fillStyle = grad;
      c.beginPath(); c.arc(0, 0, 260, 0, Math.PI * 2); c.fill();

      grad = c.createRadialGradient(0, 0, 0, 0, 0, 130);
      grad.addColorStop(0, 'rgba(255,250,235,0.75)');
      grad.addColorStop(0.5, 'rgba(255,215,165,0.45)');
      grad.addColorStop(1, 'rgba(255,200,140,0)');
      c.fillStyle = grad;
      c.beginPath(); c.arc(0, 0, 130, 0, Math.PI * 2); c.fill();
      c.restore();

      // 2) 성간먼지대 - 띠를 가로지르는 어두운 틈을 "지워서" 표현
      c.save();
      c.translate(centerX, centerY);
      c.rotate(bandAngle);
      c.scale(3.4, 1);
      c.globalCompositeOperation = 'destination-out';
      const laneGrad = c.createLinearGradient(0, -35, 0, 15);
      laneGrad.addColorStop(0, 'rgba(0,0,0,0)');
      laneGrad.addColorStop(0.5, 'rgba(0,0,0,0.55)');
      laneGrad.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = laneGrad;
      c.fillRect(-260, -45, 520, 55);
      c.restore();
      c.globalCompositeOperation = 'source-over';

      // 3) 띠 주변에 밀도 있게 흩뿌린 별 - 가우시안식으로 중심에 몰리게
      for (let i = 0; i < 3000; i++) {
        const g = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
        const along = (Math.random() - 0.5) * 950;
        const across = g * 75;
        const cosA = Math.cos(bandAngle), sinA = Math.sin(bandAngle);
        const x = centerX + along * cosA - across * sinA;
        const y = centerY + along * sinA + across * cosA;
        if (x < 0 || x > W || y < 0 || y > H) continue;
        const r = 0.5 + Math.random() * 1.3;
        const bright = 0.45 + Math.random() * 0.5;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fillStyle = `rgba(255,250,240,${bright})`;
        c.fill();
      }

      return new THREE.CanvasTexture(cvs);
    }

    function buildMilkyWay() {
      const geometry = new THREE.SphereGeometry(1300, 48, 48);
      const material = new THREE.MeshBasicMaterial({
        map: buildMilkyWaySkyboxTexture(),
        side: THREE.BackSide, transparent: true, depthWrite: false
      });
      return new THREE.Mesh(geometry, material);
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
    // [ADD] "달 표면이 너무 인위적이야 - 실제 보름달 이미지를 입혀" 요청
    // 반영. 손으로 그린 캔버스 대신 실제 달 사진 텍스처를 입힌 3D 구체로
    // 바꿨습니다. 지구 그림자와 똑같은 태양 방향(sunDirLocal)을 재사용해서
    // 위상(빛 받는 면/그림자 진 면)도 표현했어요 - 태양이 지구·달보다
    // 훨씬 멀리 있어서 "지구에서 본 태양 방향"과 "달에서 본 태양 방향"은
    // 거의 같다고 봐도 되기 때문에, 별도 계산 없이 같은 방향을 그대로
    // 씁니다. 구체 하나 + 셰이더 오버레이 하나 정도라 성능 부담은 거의 없어요.
    function buildRealMoon(moonLat, moonLon, sunDirLocal) {
      const group = new THREE.Group();
      const radius = 33;

      const geometry = new THREE.SphereGeometry(radius, 32, 32);
      const textureLoader = new THREE.TextureLoader();
      const moonTexture = textureLoader.load('https://threejs.org/examples/textures/planets/moon_1024.jpg');
      const material = new THREE.MeshBasicMaterial({ map: moonTexture });
      const moonMesh = new THREE.Mesh(geometry, material);
      group.add(moonMesh);

      // 달의 위상(그림자 진 면) - 지구 낮/밤 그림자와 같은 기법, 같은 태양 방향
      const shadowGeometry = new THREE.SphereGeometry(radius * 1.02, 32, 32);
      const shadowMaterial = new THREE.ShaderMaterial({
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
            float facing = dot(normalize(vNormal), normalize(sunDir));
            float night = smoothstep(0.12, -0.12, facing);
            gl_FragColor = vec4(0.0, 0.0, 0.01, night * 0.88);
          }
        `,
        transparent: true,
        depthWrite: false
      });
      const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
      group.add(shadowMesh);

      group.position.copy(latLonToSpherePos(moonLat, moonLon, 400));
      return group;
    }

    // [FIX] "태양이 여전히 안 보여" - 스크린샷을 보니 달(캔버스 텍스처)은
    // 크레이터까지 선명하게 잘 보이는데 태양만 안 보였어요. 둘의 차이는
    // 딱 하나, 태양만 외부 이미지 URL(solarsystemscope.com)을 썼다는
    // 거예요. 그 사이트의 CORS 설정을 확실히 보장할 수 없어서, 로딩이
    // 조용히 실패했을 가능성이 커요. 달과 똑같이 캔버스로 직접 그리는
    // 절차적 텍스처로 바꿔서 외부 네트워크 의존을 아예 없앴습니다.
    function buildSunTexture() {
      const cvs = document.createElement('canvas');
      cvs.width = 256; cvs.height = 256;
      const c = cvs.getContext('2d');
      const grad = c.createRadialGradient(128, 128, 0, 128, 128, 182);
      grad.addColorStop(0, '#fff4c9');
      grad.addColorStop(0.45, '#ffc65c');
      grad.addColorStop(0.8, '#ff9d2e');
      grad.addColorStop(1, '#e8701a');
      c.fillStyle = grad;
      c.fillRect(0, 0, 256, 256);

      // 쌀알무늬(태양 표면 그래뉼레이션) 느낌의 얼룩
      for (let i = 0; i < 500; i++) {
        const x = Math.random() * 256, y = Math.random() * 256;
        const r = 2 + Math.random() * 5;
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fillStyle = Math.random() > 0.5 ? 'rgba(255,225,160,0.28)' : 'rgba(200,90,20,0.22)';
        c.fill();
      }
      return new THREE.CanvasTexture(cvs);
    }

    // [ADD] "태양에 약간 주황 + 특수촬영한 태양표면 오버레이" 요청 반영.
    // 달과 같은 방식으로 실제 태양 표면 사진 텍스처를 입힌 구체를 만들고,
    // MeshBasicMaterial의 color로 살짝 주황 틴트를 곱해줍니다. 다만 태양은
    // 달과 달리 "빛나는 느낌"도 있어야 해서, 기존 발광 글로우 스프라이트를
    // 후광으로 뒤에 같이 둡니다.
    function buildRealSun(sunLat, sunLon) {
      const group = new THREE.Group();
      // [CHANGE] "태양 지름 10배" - 그냥 반지름만 10배로 하면 태양이 카메라
      // 최대 줌아웃 거리(380)보다도 커져서 화면이 "태양 안쪽"처럼 깨져 보일
      // 수 있어요. 그래서 거리도 함께 늘려서(750→2000) 카메라가 어떤
      // 각도로 봐도 절대 태양 구체 안으로 들어가지 않게 하면서, 반지름은
      // 정확히 요청하신 10배(95→950)로 키웠습니다 - 결과적으로 화면에
      // 보이는 크기는 이전보다 약 3.75배 커집니다.
      // [CHANGE] "태양이 너무 커졌어, 달 크기 기억하지?" - 10배로 키운 걸
      // 실제로 화면에서 보니 배경 전체를 뒤덮을 정도로 과했어요. 달(반지름
      // 33, 거리 400 → 겉보기 비율 0.0825)보다 살짝 더 크게만(겉보기 비율
      // 약 0.156, 달의 약 1.9배) 보이도록 다시 줄였습니다.
      const pos = latLonToSpherePos(sunLat, sunLon, 900);

      // [FIX] "태양이 달보다 훨씬 작아 보여" - 반지름은 같아도(33) 태양이
      // 달보다 훨씬 멀리(750 vs 400) 있어서, 실제 화면에 보이는 각크기는
      // 거리에 반비례해 작아 보였어요. 거리 비율만큼 반지름을 키워서
      // (33 × 750/400 ≈ 62) 겉보기 크기가 달과 비슷해지도록 맞췄습니다.
      const halo = createGlowSprite('#ffb35c', 220);
      halo.position.copy(pos);
      group.add(halo);

      const geometry = new THREE.SphereGeometry(140, 32, 32);
      const sunTexture = buildSunTexture();
      const material = new THREE.MeshBasicMaterial({ map: sunTexture, color: '#ffb066' });
      const sunMesh = new THREE.Mesh(geometry, material);
      sunMesh.position.copy(pos);
      group.add(sunMesh);

      return group;
    }

    function buildRealSunAndMoon() {
      const now = new Date();
      const sun = computeSubsolarPoint(now);
      const moon = computeSublunarPoint(now);

      const group = new THREE.Group();

      group.add(buildRealSun(sun.lat, sun.lon));

      const mercurySprite = createGlowSprite('#b5a897', 24);
      mercurySprite.position.copy(latLonToSpherePos(sun.lat + 9, sun.lon - 11, 560));
      group.add(mercurySprite);

      const venusSprite = createGlowSprite('#e8d9b5', 32);
      venusSprite.position.copy(latLonToSpherePos(sun.lat - 6, sun.lon + 13, 600));
      group.add(venusSprite);

      // 낮/밤 그림자 셰이더에 넘길 "태양 방향(로컬 단위벡터)" - 달 위상에도 재사용
      const sunDirLocal = latLonToSpherePos(sun.lat, sun.lon, 1);

      group.add(buildRealMoon(moon.lat, moon.lon, sunDirLocal));

      return { group, sunDirLocal };
    }

