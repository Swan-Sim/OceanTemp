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

    // [CHANGE] 파랑 밴드가 핑크와 만나는 지점이 옅은 하늘색(#60a5fa)이었는데,
    // 옅은 핑크(#f9a8d4)와 만나면서 둘 다 밝은 색이라 그 사이가 하얗게 뜨는
    // 문제가 있었어요. "옅은 파랑이 아니라 지구 사진 속 그 선명한 파랑으로
    // 바로 이어지게" 요청 반영 - 파랑/핑크 둘 다 접점에서 선명한(채도 높은)
    // 색을 쓰도록 바꿔서 중간에 보라/마젠타로 자연스럽게 섞이게 했습니다.
    // 차가운 쪽(검정)으로 갈수록 파랑이 점점 짙어지고, 뜨거운 쪽(핫핑크)으로
    // 갈수록 마젠타가 점점 짙어지는 방향은 그대로 유지했어요.
    const TEMP_BANDS = [
      '#000000', '#050b1a', '#0a1730', '#122a52', '#1a2f6e', // 0~13.3°C 검정 → 짙은 남색
      '#1e3a8a', '#1e40af', '#1d4ed8', '#2563eb', '#3b82f6', // 13.3~26.7°C 선명한 파랑(블루 플래닛 블루)
      '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843'  // 26.7~40°C 선명한 핫핑크 → 짙은 마젠타
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

