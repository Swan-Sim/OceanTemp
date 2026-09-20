    // [ADD] "로딩 화면 - BIOS 부팅처럼 텍스트가 올라가면서 진행상황을
    // 보여주자" 요청 반영. 실제 진행상황(정점 검증 %)과, 그 사이사이를
    // 채워주는 연출용 시스템 메시지를 섞어서 보여줍니다.
    const BOOT_MESSAGES = [
      'GLOBAL OCEAN SST MONITOR — BIOS v2.6.19',
      'MEMORY CHECK... 640K OK',
      'DETECTING SATELLITE UPLINK... OK',
      'LOADING NATURAL EARTH GEOMETRY... OK',
      'CALIBRATING SOLAR EPHEMERIS...',
      'COMPUTING SUBSOLAR POINT... OK',
      'COMPUTING SUBLUNAR POINT... OK',
      'MOUNTING OCEAN GRID... OK',
      'ESTABLISHING LINK TO OPEN-METEO GATEWAY...',
      'HANDSHAKE OK — MARINE API READY',
      'STREAMING STATION MANIFEST...'
    ];

    let bootLineTimer = null;
    let bootMsgIndex = 0;

    function bootAppendLine(text) {
      const term = document.getElementById('boot-terminal');
      if (!term) return;
      const line = document.createElement('div');
      line.className = 'boot-line';
      line.textContent = '> ' + text;
      term.appendChild(line);
      term.scrollTop = term.scrollHeight;
      while (term.children.length > 14) term.removeChild(term.firstChild);
    }

    function startBootTextSequence() {
      bootMsgIndex = 0;
      function tick() {
        if (bootMsgIndex < BOOT_MESSAGES.length) {
          bootAppendLine(BOOT_MESSAGES[bootMsgIndex]);
          bootMsgIndex++;
          bootLineTimer = setTimeout(tick, 220 + Math.random() * 260);
        }
      }
      tick();
    }

    // 실제 정점 검증 진행률(%)을 지구 위 로딩바 + 터미널에 반영
    function updateBootProgress(done, total) {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const fill = document.getElementById('boot-progress-fill');
      const label = document.getElementById('boot-progress-label');
      if (fill) fill.style.width = pct + '%';
      if (label) label.textContent = `VALIDATING STATIONS ${done}/${total} (${pct}%)`;
    }

    function finishBootTextSequence() {
      if (bootLineTimer) clearTimeout(bootLineTimer);
      bootAppendLine('ALL SYSTEMS NOMINAL');
      bootAppendLine('LAUNCHING GLOBE INTERFACE...');
      const fill = document.getElementById('boot-progress-fill');
      const label = document.getElementById('boot-progress-label');
      if (fill) fill.style.width = '100%';
      if (label) label.textContent = 'READY';
    }
