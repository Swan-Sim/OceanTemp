    // [ADD] "태양 위치는 실시간 실제 위치로, 달도 가능하면" 요청 반영.
    // 간이 천문 공식(저정밀 태양/달 궤도식)으로 "지금 이 순간 태양/달이
    // 머리 위(직하점)에 있는 위경도"를 계산합니다. 완전한 정밀 천체력은
    // 아니지만(태양은 약 0.01도, 달은 대략 0.3~1도 오차) 시각화 용도로는
    // 충분히 정확해요.

    function computeGMST(date) {
      // 그리니치 항성시 (도 단위) - 태양/달의 적경을 지구 표면 경도로
      // 변환할 때 기준이 됩니다.
      const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
      const d = (date.getTime() - J2000) / 86400000;
      let gmst = (280.46061837 + 360.98564736629 * d) % 360;
      if (gmst < 0) gmst += 360;
      return gmst;
    }

    // 태양이 머리 위에 있는 지점(태양 직하점)의 위경도
    function computeSubsolarPoint(date) {
      const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
      const n = (date.getTime() - J2000) / 86400000;
      const rad = Math.PI / 180;

      let L = (280.460 + 0.9856474 * n) % 360; if (L < 0) L += 360; // 태양 평균황경
      let g = (357.528 + 0.9856003 * n) % 360; if (g < 0) g += 360; // 태양 평균근점이각
      const gRad = g * rad;
      const lambda = L + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad); // 황경
      const lambdaRad = lambda * rad;
      const epsilon = 23.439 - 0.0000004 * n; // 황도경사각
      const epsilonRad = epsilon * rad;

      const raRad = Math.atan2(Math.cos(epsilonRad) * Math.sin(lambdaRad), Math.cos(lambdaRad));
      let ra = raRad / rad; if (ra < 0) ra += 360; // 적경
      const dec = Math.asin(Math.sin(epsilonRad) * Math.sin(lambdaRad)) / rad; // 적위

      let subLon = ra - computeGMST(date);
      subLon = ((subLon + 180) % 360 + 360) % 360 - 180;
      return { lat: dec, lon: subLon };
    }

    // 달이 머리 위에 있는 지점(달 직하점)의 위경도 - 간이 저정밀 공식
    function computeSublunarPoint(date) {
      const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
      const n = (date.getTime() - J2000) / 86400000;
      const rad = Math.PI / 180;

      let Lm = (218.316 + 13.176396 * n) % 360; if (Lm < 0) Lm += 360;
      let Mm = (134.963 + 13.064993 * n) % 360; if (Mm < 0) Mm += 360;
      let Fm = (93.272 + 13.229350 * n) % 360; if (Fm < 0) Fm += 360;

      const lambda = Lm + 6.289 * Math.sin(Mm * rad); // 황경(주요 섭동만 반영)
      const beta = 5.128 * Math.sin(Fm * rad); // 황위
      const lambdaRad = lambda * rad, betaRad = beta * rad;
      const epsilon = 23.439 * rad;

      const dec = Math.asin(Math.sin(betaRad) * Math.cos(epsilon) + Math.cos(betaRad) * Math.sin(epsilon) * Math.sin(lambdaRad)) / rad;
      const y = Math.sin(lambdaRad) * Math.cos(epsilon) - Math.tan(betaRad) * Math.sin(epsilon);
      const x = Math.cos(lambdaRad);
      let ra = Math.atan2(y, x) / rad; if (ra < 0) ra += 360;

      let subLon = ra - computeGMST(date);
      subLon = ((subLon + 180) % 360 + 360) % 360 - 180;
      return { lat: dec, lon: subLon };
    }
