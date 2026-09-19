    function cToF(c) { return Number((c * 9/5 + 32).toFixed(1)); }
    // [CHANGE] 항상 섭씨/화씨를 병행 표기하던 것을 - 섭씨를 기본값으로 하고
    // 현재 선택된 단위(tempUnit) 하나만 보여주도록 바꿨습니다.
    // 버튼(°C/°F)으로 전환할 수 있어요.
    function formatTemp(c) {
      if (tempUnit === 'F') return `${cToF(c).toFixed(1)}°F`;
      return `${c.toFixed(1)}°C`;
    }
    function formatAxisTemp(v) {
      if (tempUnit === 'F') return `${Math.round(cToF(v))}°`;
      return `${v}°`;
    }

    // [CHANGE] 3단계(파랑-흰색-빨강) 부드러운 그라데이션은 중간 온도대가
    // 전부 옅은 파스텔/핑크색으로 뭉개져서 바다 전체가 핑크빛으로 보이고
    // windy.com/earth.nullschool 같은 선명한 역동감이 없다는 지적을 반영했습니다.
    // 0~40°C를 15단계로 쪼개서 파랑 5단계 → 청록 5단계 → 빨강 5단계로 또렷하게
    // 구간을 나눈 밴드형(step) 팔레트로 바꿨습니다.
    const TEMP_BANDS = [
      '#000000', '#18181b', '#27272a', '#3f3f46', '#52525b', // 0~13.3°C 검정 5단계
      '#1e1b4b', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', // 13.3~26.7°C 파랑 5단계
      '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d'  // 26.7~40°C 핫핑크 5단계
    ];
    function hexToRgbArr(hex) {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const TEMP_BANDS_RGB = TEMP_BANDS.map(hexToRgbArr);
    // [CHANGE] 딱딱 끊기는 15단계 밴딩 대신, 같은 색상 여정(검정→파랑→핫핑크)을
    // 유지하면서 인접 구간끼리 부드럽게 보간해서 참고 이미지처럼 매끄러운
    // 그라데이션으로 바꿨습니다.
    function getTempColor(temp) {
      const clamped = Math.max(0, Math.min(40, temp));
      const pos = (clamped / 40) * (TEMP_BANDS_RGB.length - 1);
      const i0 = Math.floor(pos);
      const i1 = Math.min(TEMP_BANDS_RGB.length - 1, i0 + 1);
      const frac = pos - i0;
      const c0 = TEMP_BANDS_RGB[i0], c1 = TEMP_BANDS_RGB[i1];
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * frac);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * frac);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * frac);
      return `${r},${g},${b}`;
    }

