    // [ADD] "정점이 많아졌으니 검색으로 바로 찾기" + "로딩 중 위치 공유 안 한
    // 사용자에게 내 위치/검색/대륙 선택 제공" 요청 반영. stations 배열의
    // name(영문)/shortName(한글)을 대상으로 검색하고, 두 곳(HUD 돋보기 패널,
    // 부팅 위젯)에서 같은 검색 로직을 재사용합니다.

    function searchStations(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return stations.filter(st =>
        (st.name && st.name.toLowerCase().includes(q)) ||
        (st.shortName && st.shortName.toLowerCase().includes(q)) ||
        (st.label && st.label.toLowerCase().includes(q))
      ).slice(0, 8);
    }

    function renderSearchResults(list, containerEl, onSelect) {
      containerEl.innerHTML = '';
      if (!list.length) {
        containerEl.style.display = 'none';
        return;
      }
      list.forEach(st => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        const label = st.shortName || st.name;
        item.innerHTML = `<span class="sr-name">${label}</span><span class="sr-sub">${st.name}</span>`;
        item.addEventListener('click', () => onSelect(st));
        containerEl.appendChild(item);
      });
      containerEl.style.display = 'block';
    }

    // HUD 검색 패널 토글
    function toggleSearchPanel() {
      const panel = document.getElementById('search-panel');
      const isOpen = panel.classList.toggle('open');
      if (isOpen) {
        document.getElementById('search-input').focus();
      } else {
        document.getElementById('search-input').value = '';
        document.getElementById('search-results').style.display = 'none';
      }
    }

    function wireSearchInput(inputEl, resultsEl, onSelect) {
      inputEl.addEventListener('input', () => {
        renderSearchResults(searchStations(inputEl.value), resultsEl, onSelect);
      });
    }

    // 대륙 대략 중심 좌표 (부팅 위젯의 "대충 이쪽 보고 싶다" 수요용)
    const CONTINENT_CENTERS = {
      asia: { lat: 30, lon: 100 },
      europe: { lat: 50, lon: 15 },
      africa: { lat: 5, lon: 20 },
      namerica: { lat: 40, lon: -100 },
      samerica: { lat: -15, lon: -60 },
      oceania: { lat: -25, lon: 140 }
    };

    document.addEventListener('DOMContentLoaded', () => {
      // HUD 검색 - 결과 선택 시 그 정점을 선택하고 바로 상세지도(평면도)로 전환
      wireSearchInput(document.getElementById('search-input'), document.getElementById('search-results'), (st) => {
        selectStation(st);
        showDetailMap(st.coords[1], st.coords[0], 8);
        toggleSearchPanel();
      });

      // 부팅 위젯 검색 - 결과를 고르면 그 위치를 초기 방향으로 확정
      wireSearchInput(document.getElementById('boot-search-input'), document.getElementById('boot-search-results'), (st) => {
        if (window.__resolveBootLocationChoice) {
          window.__resolveBootLocationChoice(computeRotationForLatLon(st.coords[1], st.coords[0]));
        }
      });
    });

    // [ADD] 부팅 중 초기 방향을 정하는 "경쟁(race)" - 자동 위치 감지, 위젯의
    // 내 위치 버튼, 대륙 칩, 검색 선택 중 무엇이든 먼저 응답하는 쪽이 이깁니다.
    // main.js의 bootApp()에서 await로 호출합니다.
    function createLocationChoicePromise() {
      const widget = document.getElementById('boot-location-widget');
      return new Promise((resolve) => {
        let resolved = false;
        const settle = (target) => {
          if (resolved) return;
          resolved = true;
          if (widget) widget.classList.add('choice-made');
          resolve(target);
        };
        window.__resolveBootLocationChoice = settle;

        // 1) 자동 위치 감지 (조용히, 3초 제한 - 실패해도 위젯에서 계속 고를 수 있음)
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => settle(computeRotationForLatLon(pos.coords.latitude, pos.coords.longitude)),
            () => {},
            { timeout: 3000, maximumAge: 600000 }
          );
        }

        // 2) "내 위치로 보기" 버튼 - 명시적 요청이라 타임아웃을 더 넉넉하게
        const locateBtn = document.getElementById('boot-locate-btn');
        if (locateBtn) {
          locateBtn.addEventListener('click', () => {
            if (!navigator.geolocation) return;
            locateBtn.innerText = '위치 확인 중...';
            navigator.geolocation.getCurrentPosition(
              (pos) => settle(computeRotationForLatLon(pos.coords.latitude, pos.coords.longitude)),
              () => { locateBtn.innerText = '위치를 가져올 수 없어요'; },
              { timeout: 8000, maximumAge: 600000 }
            );
          });
        }

        // 3) 대륙 칩
        document.querySelectorAll('#boot-continent-chips .chip-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const c = CONTINENT_CENTERS[btn.dataset.continent];
            if (c) settle(computeRotationForLatLon(c.lat, c.lon));
          });
        });

        // 4) 안전망 - 아무 것도 안 골랐으면 기본값(한국+캘리포니아가 보이는 북태평양)으로
        setTimeout(() => settle(computeRotationForLatLon(35, -175)), 6000);
      });
    }
