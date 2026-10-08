    // =====================================================================
    // [CHANGE] "정점 목록을 파일에서 바로바로 추가·수정하고 싶어" 요청 반영.
    // 해변·연구기관 정점은 이제 코드가 아니라 표(CSV)에서 읽어옵니다.
    //   1순위: 구글 시트 (아래 STATION_SHEET_CSV_URL에 "웹에 게시 → CSV" 주소)
    //          → 시트만 고치면 푸시 없이 새로고침으로 반영(구글 캐시로 몇 분 걸릴 수 있음)
    //   2순위: 저장소의 data/stations.csv (시트가 비었거나 못 읽을 때 자동 대체)
    // 열: country, name, label, lat, lon, network, depth(Y/N), show(Y/N)
    //   - 열 순서는 상관없고, 첫 줄(제목 줄)의 이름으로 찾아요.
    //   - show가 N이면 지우지 않고 숨깁니다. 좌표가 잘못된 줄은 건너뛰고 콘솔에 알려줘요.
    // =====================================================================
    const STATION_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSN3HofGgc9HEUOIag-2EQpPnpJ9gZi2DTXLvu1t9LP3WAeAe-IYIFmJ6H_buloREnhfLsbWWRN9S9j/pub?output=csv';
    const STATION_LOCAL_CSV_URL = 'data/stations.csv';

    // 따옴표로 감싼 값(쉼표·줄바꿈 포함)까지 처리하는 간단한 CSV 파서
    function parseCsv(text) {
      const rows = [];
      let row = [], field = '', q = false;
      text = text.replace(/^﻿/, ''); // 엑셀이 붙이는 BOM 제거
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
          if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
          else if (ch === '"') q = false;
          else field += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(field); field = '';
          if (row.some(v => v.trim() !== '')) rows.push(row);
          row = [];
        } else field += ch;
      }
      row.push(field);
      if (row.some(v => v.trim() !== '')) rows.push(row);
      return rows;
    }

    function csvToSpots(text, sourceLabel) {
      const rows = parseCsv(text);
      if (rows.length < 2) return [];
      const head = rows[0].map(h => h.trim().toLowerCase());
      const col = (n) => head.indexOf(n);
      const iName = col('name'), iLat = col('lat'), iLon = col('lon');
      if (iName < 0 || iLat < 0 || iLon < 0) {
        console.warn(`[stations] ${sourceLabel}: name/lat/lon 열을 찾을 수 없어요`);
        return [];
      }
      const get = (r, n) => { const i = col(n); return i >= 0 && r[i] != null ? String(r[i]).trim() : ''; };
      const spots = [];
      rows.slice(1).forEach((r, idx) => {
        const name = cleanSpotName(get(r, 'name'));
        const lat = parseFloat(get(r, 'lat')), lon = parseFloat(get(r, 'lon'));
        if (!name) return;
        if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) {
          console.warn(`[stations] ${sourceLabel} ${idx + 2}번째 줄 좌표 오류로 건너뜀:`, name, get(r, 'lat'), get(r, 'lon'));
          return;
        }
        if (/^n/i.test(get(r, 'show'))) return; // show = N → 숨김
        spots.push({
          country: get(r, 'country'),
          name,
          shortName: get(r, 'label') || name,
          lat, lon,
          depth: !/^n/i.test(get(r, 'depth')),
          net: get(r, 'network') || 'Beach/local',
          no: parseInt(get(r, 'no'), 10) || null // [ADD] 정점 번호 - 다이빙샵 시트의 spots 칸과 연결
        });
      });
      return spots;
    }

    async function fetchTextWithTimeout(url, ms) {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), ms);
      try {
        const res = await fetch(url, { signal: c.signal, cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.text();
      } finally { clearTimeout(timer); }
    }

    // [ADD] "다이빙 포인트는 🤿 아이콘이 있으니 '다이빙포인트'라는 말은 사족" - 이름 끝·괄호의 군더더기를 빼요
    //   "제주 문섬 다이빙포인트" → "제주 문섬", "하고수동해변 (다이빙)" → "하고수동해변", "Banzai Cliff Diving Area (Saipan)" → "Banzai Cliff (Saipan)"
    function cleanSpotName(n) {
      const out = String(n || '')
        .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '') // 시트에 이모지가 들어 있어도 뺌
        .replace(/\s*\((다이빙|다이빙\s*포인트|diving|dive)\)/gi, '')
        .replace(/\s*(다이빙\s*포인트|다이빙\s*스팟|diving\s*(area|site|spot|point)|dive\s*(site|spot|point))(?=\s*(\(|$))/gi, '')
        .replace(/\s{2,}/g, ' ').trim();
      return out || String(n || '').trim();
    }

    // [ADD] /spot/ 에서 등록 요청 → /admin 에서 승인된 포인트(번호가 시트와 겹치지 않음)
    async function addUserSpots(spots) {
      if (!/^https?:$/.test(location.protocol)) return;
      try {
        const j = JSON.parse(await fetchTextWithTimeout('/api/shops?svc=spots', 4000));
        const have = new Set(spots.map(s => s.no).filter(Boolean));
        (j.spots || []).forEach(s => {
          if (have.has(s.no) || !Number.isFinite(+s.lat) || !Number.isFinite(+s.lon)) return;
          spots.push({ country: s.country || '', name: cleanSpotName(s.name), shortName: cleanSpotName(s.label || s.name), lat: +s.lat, lon: +s.lon, depth: true, net: 'Beach/user', no: s.no });
        });
      } catch (e) { console.warn('[stations] 사용자 등록 포인트 읽기 실패:', e.message); }
    }

    async function loadBeachSpots() {
      // [CHANGE] 1순위: 관리 페이지에서 관리하는 전체 포인트(/api/shops?svc=spots). 실패하면 저장소 data/stations.csv
      if (/^https?:$/.test(location.protocol)) {
        try {
          const j = JSON.parse(await fetchTextWithTimeout('/api/shops?svc=spots', 8000));
          const spots = (j.spots || []).filter(s => s.name && Number.isFinite(+s.lat) && Number.isFinite(+s.lon)).map(s => ({
            country: s.country || '', name: cleanSpotName(s.name), shortName: cleanSpotName(s.label || s.name), lat: +s.lat, lon: +s.lon,
            depth: s.depth !== false, net: s.network || 'Beach/local', no: +s.no || null,
            face: Number.isFinite(s.face) ? s.face : null, // [ADD] 바다 쪽 방향
            prof: s.pMax > 0 ? { top: s.pTop ?? 2, max: s.pMax, run: s.pRun ?? 10, r: s.pR ?? 250 } : null // [ADD] 현지 지형(수심 지도 보완)
          }));
          if (spots.length >= 10) { console.info(`[stations] 관리 목록에서 정점 ${spots.length}곳을 읽었어요`); return spots; }
        } catch (e) { console.warn('[stations] 관리 목록 읽기 실패 - stations.csv로:', e.message); }
      }
      const sources = [['stations.csv', STATION_LOCAL_CSV_URL]];
      for (const [label, url] of sources) {
        try {
          const spots = csvToSpots(await fetchTextWithTimeout(url, 6000), label);
          if (spots.length) await addUserSpots(spots); // [ADD] 관리자가 승인한 사용자 등록 포인트도 더함
          if (spots.length) {
            console.info(`[stations] ${label}에서 정점 ${spots.length}곳을 읽었어요`);
            return spots;
          }
          console.warn(`[stations] ${label}에 읽을 수 있는 정점이 없어요 - 다음 소스로`);
        } catch (e) {
          console.warn(`[stations] ${label} 읽기 실패 - 다음 소스로:`, e.message);
        }
      }
      return [];
    }

    async function generateBeachStations() {
      const list = [];
      const beachSpots = await loadBeachSpots();

      beachSpots.forEach(s => {
        // [QA] 저해상도(1:110m) 육지 데이터 특성상 해안선 바로 근처 좌표는
        // 간혹 육지로 오판정될 수 있어, 실제 이런 경우가 있는지 콘솔에 남겨서
        // 신뢰도를 눈으로 확인할 수 있게 합니다. (그 자체로 좌표를 바꾸진 않음 - 실제
        // 해변인지 사람이 고른 명단이라 자동 제외 대상은 아닙니다.)
        if (isOnLand(s.lon, s.lat)) {
          console.warn('[QA] 해안선 저해상도 오차로 육지 판정된 해변 좌표 - 실제 해변 위치는 맞습니다:', s.name);
        }
        list.push({
          id: stationIdCounter++,
          name: s.name, // [CHANGE] "이모티콘도 다 빼" - 이름 앞 🤿 제거
          label: s.shortName,
          country: s.country,
          isBeach: true,
          coords: [s.lon, s.lat],
          // 첫 표시용 대략값(위도 기반) - 곧 위성 수온 격자 값으로 바뀝니다
          curTemp: +Math.max(0.1, 31 - Math.abs(s.lat) * 0.45).toFixed(1),
          hasDepth: s.depth,
          network: s.net,
          no: s.no,
          face: s.face ?? null, prof: s.prof || null
        });
      });

      return list;
    }

    // [ADD-지연로딩] 이 함수는 처음부터 부르지 않습니다. 전세계 격자 정점(약 2천여 개)은
    // 실측 데이터가 아니라 예시로 생성하는 값이라, 3D 지구본을 그냥 구경할 때는
    // 계산할 필요가 없어요. 사용자가 실제로 확대해서 상세 위성지도로 들어가는
    // 시점(showDetailMap 최초 호출)에 딱 한 번만 만들어서 그 뒤로는 재사용합니다 -
    // 초기 로딩 시간과 불필요한 연산을 줄이기 위한 지연 로딩입니다.
    function generateOceanGridStations() {
      const list = [];
      // [FIX] "일부 정점들이 유독 붙어있다" - 위도/경도를 똑같은 각도 간격으로
      // 찍으면, 위도선은 극에 가까워질수록 실제 거리가 좁아지기 때문에
      // (경도 1도가 적도에서는 약 111km지만 위도 70도에서는 약 38km) 고위도
      // 지역 정점들이 실제로는 훨씬 촘촘하게 뭉쳐 보였어요. 위도가 높아질수록
      // 경도 간격을 1/cos(위도)만큼 넓혀서 실제 거리 기준으로 고르게 폅니다.
      // [CHANGE] "Open-Meteo에 있는 모든 정점 추가해줘" 요청에 대한 조치 -
      // Open-Meteo Marine API는 고정된 "정점 목록"이 있는 서비스가 아니라
      // 전 세계를 격자(모델)로 덮는 방식이라, 이론상 무한히 촘촘하게 조회할
      // 수 있어요(진짜 "전부"는 브라우저에서 렌더링/검증하기엔 너무 많고요).
      // 그래서 실용적인 선에서 격자를 약 2배 더 촘촘하게 늘렸습니다.
      // [CHANGE] "추정값은 추정값이라 표시하기로 했으니, 정점 숫자를 늘리는
      // 것 자체는 신뢰도에 큰 의미가 없다"는 요청 반영 - 예전에 "약 2배
      // 촘촘하게" 늘렸던 격자 밀도를 다시 원래 수준(절반)으로 되돌렸습니다.
      const latStep = 4.2;
      const baseLonStep = 5.4;
      for (let lat = -70; lat <= 70; lat += latStep) {
        const rawLonStep = Math.min(30, baseLonStep / Math.max(0.28, Math.cos(lat * Math.PI / 180)));
        // [FIX] "뉴질랜드 옆에서만 정점 간격이 너무 좁다" - 360을 lonStep으로
        // 나누면 딱 안 떨어지는 경우가 대부분이라, 날짜변경선(180도)에서
        // 마지막 정점과 첫 정점 사이의 "이어붙는 틈"만 다른 간격보다 훨씬
        // 좁아졌어요. 360을 정수로 나누어떨어지는 스텝 수를 먼저 정해서
        // 이음매 없이 고르게 한 바퀴 돌도록 고쳤습니다.
        const numLonSteps = Math.max(4, Math.round(360 / rawLonStep));
        const lonStep = 360 / numLonSteps;
        for (let i = 0; i < numLonSteps; i++) {
          const lon = -180 + i * lonStep;
          // 지터(무작위 흔들림)를 먼저 적용한 좌표로 육지 판정을 합니다.
          const jLat = lat + (Math.random() * 0.5);
          const jLon = lon + (Math.random() * lonStep * 0.1);
          if (isOnLand(jLon, jLat)) continue;

          let base = 31.0 - Math.abs(jLat) * 0.45 + (Math.random() * 2 - 1);
          if (jLat >= 22 && jLat <= 28 && jLon >= 48 && jLon <= 56) base += 6.5 + Math.random() * 1.5;
          // [ADD] 니뇨 3.4 구역(적도 태평양 중동부, 5°S~5°N·170°W~120°W)에
          // "올해 슈퍼 엘니뇨" 맥락을 반영한 예시 온난 편차를 더합니다.
          // 실측 위성 데이터가 아니라 일러스트레이션용 보정치입니다.
          if (Math.abs(jLat) <= 5 && jLon >= -170 && jLon <= -120) base += 1.8 + Math.random() * 0.8;
          const surfaceTemp = Math.max(0.1, +base.toFixed(1));

          list.push({
            id: stationIdCounter++,
            name: `Station #${stationIdCounter} (${jLat.toFixed(1)}°, ${jLon.toFixed(1)}°)`,
            label: null,
            isBeach: false,
            coords: [jLon, jLat],
            curTemp: surfaceTemp,
            hasDepth: Math.random() > 0.3,
            network: jLat > 50 || jLat < -50 ? "Argo Polar" : "NOAA/Argo"
          });
        }
      }
      return list;
    }

