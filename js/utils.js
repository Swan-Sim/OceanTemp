function cToF(c) { return Number((c * 9/5 + 32).toFixed(1)); }
    function formatTemp(c) { return `${c.toFixed(1)}°C (${cToF(c)}°F)`; }

    // 다단계 발산형 스케일 (Windy / Nullschool 스타일)
    function getTempColor(temp) {
      // 해양 표층 수온 분포에 맞춰 최대 기준을 38에서 34로 낮춤
      const t = Math.max(-2, Math.min(34, temp));
      
      // 온도별 기준 색상 (보라/파랑 -> 청록 -> 연두/노랑 -> 주황 -> 짙은 빨강)
      const stops = [
        { v: -2, c: [49, 54, 149] },   // 짙은 파랑/보라 (얼음/냉수)
        { v: 4,  c: [69, 117, 180] },  // 파랑
        { v: 10, c: [116, 173, 209] }, // 청록
        { v: 16, c: [171, 217, 233] }, // 밝은 하늘
        { v: 22, c: [254, 224, 144] }, // 노랑 (온화함)
        { v: 28, c: [244, 109, 67] },  // 주황/빨강 (따뜻함)
        { v: 34, c: [165, 0, 38] }     // 짙은 빨강 (적도 고수온)
      ];

      // 현재 온도(t)가 속한 두 색상 구간 찾기
      let c1 = stops[0], c2 = stops[stops.length - 1];
      for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i].v && t <= stops[i+1].v) {
          c1 = stops[i];
          c2 = stops[i+1];
          break;
        }
      }

      // 두 구간 사이의 비율(0~1) 계산 후 RGB 선형 보간
      const range = c2.v - c1.v;
      const lt = range === 0 ? 0 : (t - c1.v) / range;

      const r = Math.round(c1.c[0] + (c2.c[0] - c1.c[0]) * lt);
      const g = Math.round(c1.c[1] + (c2.c[1] - c1.c[1]) * lt);
      const b = Math.round(c1.c[2] + (c2.c[2] - c1.c[2]) * lt);

      return `${r},${g},${b}`;
    }