    function cToF(c) { return Number((c * 9/5 + 32).toFixed(1)); }
    function formatTemp(c) { return `${c.toFixed(1)}°C (${cToF(c)}°F)`; }

    // [CHANGE] 3단계(파랑-흰색-빨강) 부드러운 그라데이션은 중간 온도대가
    // 전부 옅은 파스텔/핑크색으로 뭉개져서 바다 전체가 핑크빛으로 보이고
    // windy.com/earth.nullschool 같은 선명한 역동감이 없다는 지적을 반영했습니다.
    // 0~40°C를 15단계로 쪼개서 파랑 5단계 → 청록 5단계 → 빨강 5단계로 또렷하게
    // 구간을 나눈 밴드형(step) 팔레트로 바꿨습니다.
    const TEMP_BANDS = [
      '#1e1b4b', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', // 0~13.3°C 파랑 5단계
      '#134e4a', '#0f766e', '#0d9488', '#14b8a6', '#5eead4', // 13.3~26.7°C 청록 5단계
      '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#991b1b'  // 26.7~40°C 빨강 5단계
    ];
    function hexToRgbStr(hex) {
      const n = parseInt(hex.slice(1), 16);
      return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    }
    function getTempColor(temp) {
      const clamped = Math.max(0, Math.min(40, temp));
      let idx = Math.floor((clamped / 40) * 15);
      if (idx > 14) idx = 14;
      if (idx < 0) idx = 0;
      return hexToRgbStr(TEMP_BANDS[idx]);
    }

