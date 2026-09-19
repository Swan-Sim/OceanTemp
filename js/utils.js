    function cToF(c) { return Number((c * 9/5 + 32).toFixed(1)); }
    function formatTemp(c) { return `${c.toFixed(1)}°C (${cToF(c)}°F)`; }

    // [CHANGE] 무지개(rainbow/jet류) 색상은 색상환을 여러 번 지나가서
    // 온도 차이를 직관적으로 읽기 어렵다는 지적이 많은 스케일이에요.
    // 차갑다↔따뜻하다가 한눈에 들어오는 파랑→흰색→빨강 발산형(diverging) 스케일로 바꿨습니다.
    function getTempColor(temp) {
      const clamped = Math.max(0, Math.min(38, temp));
      const t = clamped / 38;
      const cold = [33, 102, 172];   // 차가움
      const mid  = [247, 247, 247];  // 중간
      const warm = [178, 24, 43];    // 뜨거움
      let c1, c2, lt;
      if (t < 0.5) { c1 = cold; c2 = mid; lt = t / 0.5; }
      else { c1 = mid; c2 = warm; lt = (t - 0.5) / 0.5; }
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * lt);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * lt);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * lt);
      return `${r},${g},${b}`; // "r,g,b" 형태로 반환 (rgba 조립에 바로 쓰기 위함)
    }

