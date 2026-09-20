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

      // 부팅 위젯 검색 - 결과를 고르면 그 위치를 "수동 선택"으로 확정하고,
      // 검색창은 "명령이 실행됐다"는 걸 보여주기 위해 숨깁니다.
      wireSearchInput(document.getElementById('boot-search-input'), document.getElementById('boot-search-results'), (st) => {
        chooseBootLocationManually(computeRotationForLatLon(st.coords[1], st.coords[0]), st);
        const wrap = document.querySelector('.boot-search-wrap');
        if (wrap) wrap.classList.add('applied');
      });
    });

    // [CHANGE] "아시아를 눌렀는데 로딩 끝나고 내 위치로 이동했어" 버그 수정 -
    // 원인은 "먼저 응답하는 쪽이 이기는" 경쟁 방식이었어요. 자동 위치 감지가
    // 대륙 버튼 클릭보다 먼저 도착하면 그 자리에서 확정돼버려서, 나중에
    // 사용자가 뭘 고르든(버튼은 눌린 것처럼 보여도) 이미 끝난 상태라
    // 무시됐던 거예요. 이제 "확정"이 아니라 "상태 기록"만 하고, 실제
    // 값은 로딩이 다 끝나는 진짜 그 순간에 읽습니다 - 그리고 사용자가
    // 명시적으로 고른 값(대륙/검색/내 위치 버튼)은 자동 감지보다 항상 우선.
    let __bootManualChoice = null; // 사용자가 명시적으로 고른 값 - 있으면 항상 최우선
    let __bootAutoChoice = null;   // 자동 위치 감지 결과 - 사용자가 아무 것도 안 고르면 씀
    let __bootSearchSelectedStation = null; // [ADD] 검색으로 고른 거면 그 정점 자체도 기억 (HUD와 동일하게 상세지도로 전환하기 위해)

    function chooseBootLocationManually(target, station) {
      __bootManualChoice = target;
      __bootSearchSelectedStation = station || null; // 검색이 아닌 다른 방법(대륙/내위치)이면 초기화
      animateGlobeRotationTo(target.x, target.y, 900);
    }

    function getBootSearchSelectedStation() {
      return __bootSearchSelectedStation;
    }

    // 부팅 로딩 내내(정점 검증이 끝날 때까지) 자동 감지/버튼/검색을 계속
    // 받아들일 수 있도록 준비만 해두는 함수. main.js의 bootApp()에서
    // 로딩 시작과 동시에 한 번 호출합니다.
    function setupBootLocationWidget() {
      __bootManualChoice = null;
      __bootAutoChoice = null;
      __bootSearchSelectedStation = null;
      const wrap = document.querySelector('.boot-search-wrap');
      if (wrap) wrap.classList.remove('applied');

      // 1) 자동 위치 감지 - 성공해도 "후보"로만 기록, 확정은 안 함
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            __bootAutoChoice = computeRotationForLatLon(pos.coords.latitude, pos.coords.longitude);
            // 사용자가 아직 아무 것도 안 골랐으면 예비 회전 정도는 보여줍니다
            if (!__bootManualChoice) animateGlobeRotationTo(__bootAutoChoice.x, __bootAutoChoice.y, 900);
          },
          () => {},
          { timeout: 3000, maximumAge: 600000 }
        );
      }

      // 2) "내 위치로 보기" 버튼 - 명시적 요청이라 타임아웃을 더 넉넉하게, 수동 선택으로 확정
      const locateBtn = document.getElementById('boot-locate-btn');
      if (locateBtn) {
        locateBtn.addEventListener('click', () => {
          if (!navigator.geolocation) return;
          locateBtn.innerText = '위치 확인 중...';
          navigator.geolocation.getCurrentPosition(
            (pos) => chooseBootLocationManually(computeRotationForLatLon(pos.coords.latitude, pos.coords.longitude)),
            () => { locateBtn.innerText = '위치를 가져올 수 없어요'; },
            { timeout: 8000, maximumAge: 600000 }
          );
        });
      }

      // 3) 대륙 칩 - 수동 선택으로 확정
      document.querySelectorAll('#boot-continent-chips .chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const c = CONTINENT_CENTERS[btn.dataset.continent];
          if (!c) return;
          document.querySelectorAll('#boot-continent-chips .chip-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          chooseBootLocationManually(computeRotationForLatLon(c.lat, c.lon));
        });
      });
    }

    // [CHANGE] "검색하다가 로딩 끝나면 입력창이 사라져버려" 버그 수정 -
    // 위젯을 숨기는 시점을 여기(로딩 중간)가 아니라 main.js에서 실제로
    // 줌인 전환이 시작될 때로 옮겼습니다. 그러니 로딩이 아무리 오래
    // 걸려도 검색창은 그 내내 그대로 남아있어요.
    // [FIX] "검색창에 입력하던 게 로딩 끝나면 사라져버려" - 로딩이 끝나는
    // 시점에 하필 검색창에 뭔가 입력 중(아직 선택은 안 함)이었다면, 바로
    // 위젯을 없애버리지 않고 잠깐 더 기다려줍니다. 사용자가 결과를 고르거나
    // (그러면 바로 진행) 입력을 지우면(포기한 것으로 보고 진행) 끝나고,
    // 그래도 아무 반응이 없으면 최대 대기시간 뒤엔 그냥 진행합니다
    // (무한정 로딩이 안 끝나 보이는 걸 막기 위한 안전장치).
    function waitForBootSearchIdle(maxWaitMs) {
      const input = document.getElementById('boot-search-input');
      return new Promise((resolve) => {
        const deadline = Date.now() + (maxWaitMs || 6000);
        function check() {
          const hasText = input && input.value.trim().length > 0;
          const chosen = !!__bootManualChoice;
          if (!hasText || chosen || Date.now() > deadline) {
            resolve();
          } else {
            setTimeout(check, 400);
          }
        }
        check();
      });
    }

    function getFinalBootLocation() {
      return __bootManualChoice || __bootAutoChoice || computeRotationForLatLon(35, -175);
    }
