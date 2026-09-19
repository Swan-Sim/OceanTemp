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
      const patchCount = 10;
      for (let i = 0; i < patchCount; i++) {
        const r = 1550 + Math.random() * 150;
        const along = (i / patchCount) * Math.PI * 2 + Math.random() * 0.3;
        const x0 = Math.cos(along) * r;
        const z0 = Math.sin(along) * r;
        const y0 = (Math.random() - 0.5) * 60;
        const y1 = y0 * cosX - z0 * sinX;
        const z1 = y0 * sinX + z0 * cosX;
        const x1 = x0 * cosZ - y1 * sinZ;
        const y2 = x0 * sinZ + y1 * cosZ;

        const sprite = createGlowSprite('rgba(255,235,205,0.5)', 380);
        sprite.material.blending = THREE.AdditiveBlending;
        sprite.material.opacity = 0.35;
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
        const r = 1500 + Math.random() * 300;
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
        size: 6, map: buildMilkyWayGlowTexture(), vertexColors: true,
        transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
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

    function buildSolarSystemDecor() {
      const group = new THREE.Group();
      // [FIX] 수성·금성(지구보다 안쪽 궤도)은 실제로 지구에서 볼 때 태양과
      // 항상 가까운 각도 안에서만 보여요(최대이각 - 수성 약 28°, 금성 약 47°).
      // 그래서 태양 쪽에 모아뒀고, 화성·목성·토성·천왕성·해왕성(바깥 궤도 행성)은
      // 하늘 어디에도 나타날 수 있어서 태양 반대편 쪽에 흩어지게 배치했어요.
      const bodies = [
        // 태양 + 안쪽 궤도(수성·금성) - 태양과 같은 방향(+x)에 모음
        { color: '#fff4d6', size: 180, pos: [300, 150, -700] },  // 태양
        { color: '#b5a897', size: 24, pos: [250, 90, -480] },    // 수성 (태양 근처)
        { color: '#e8d9b5', size: 32, pos: [340, -40, -560] },   // 금성 (태양 근처)

        // 달은 지구 궤도상 물체라 태양 방향과 무관
        { color: '#c9c9c9', size: 52, pos: [-190, -95, -430] },  // 달

        // 바깥 궤도 행성 - 태양 반대편(-x) 쪽에 흩어서 배치
        { color: '#c1440e', size: 28, pos: [-270, 150, -610] },  // 화성
        { color: '#d8a774', size: 80, pos: [-190, -190, -880] }, // 목성
        { color: '#e3c78a', size: 68, pos: [-330, 85, -930], ring: 'rgba(210,190,150,0.7)' }, // 토성
        { color: '#a9d8e0', size: 40, pos: [-60, 230, -970] },   // 천왕성
        { color: '#5b7fe0', size: 40, pos: [-100, -230, -1000] } // 해왕성
      ];
      bodies.forEach(b => {
        const sprite = createGlowSprite(b.color, b.size, b.ring);
        sprite.position.set(b.pos[0], b.pos[1], b.pos[2]);
        group.add(sprite);
      });
      return group;
    }

