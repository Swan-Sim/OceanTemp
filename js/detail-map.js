    function showDetailMap(lat, lon, zoom = 6) {
      isDetailMode = true;
      document.getElementById('globe-canvas-container').style.opacity = '0';
      document.getElementById('globe-canvas-container').style.pointerEvents = 'none';

      const lfEl = document.getElementById('leafletMap');
      lfEl.classList.add('active');

      if (!leafletMap) {
        leafletMap = L.map('leafletMap', {
          zoomControl: false,
          attributionControl: false,
          minZoom: 4,
          maxZoom: 18
        }).setView([lat, lon], zoom);

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 18
        }).addTo(leafletMap);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
          maxZoom: 18,
          subdomains: 'abcd'
        }).addTo(leafletMap);

        leafletMap.on('zoom', () => {
          const z = leafletMap.getZoom();
          updateZoomGaugeByRatio((z - 4) / 14);
          if (z < 5) switchToGlobe();
        });

        // [ADD-지연로딩] 실제로 확대해서 상세지도로 들어온 이 시점에만 전세계
        // 해양 격자 정점을 생성합니다. 딱 한 번만 계산하고 이후엔 재사용해요.
        if (!fullGridLoaded) {
          const gridStations = generateOceanGridStations();
          stations = stations.concat(gridStations);
          fullGridLoaded = true;
          refreshMaxTempStation();
          document.getElementById('point-counter').innerText = t.stationCount(stations.length);
        }

        stations.forEach(st => {
          const colorRGB = getTempColor(st.curTemp);
          const labelHtml = st.isBeach && st.label ? `<span class="lf-label">${st.label}</span>` : '';
          const customIcon = L.divIcon({
            className: 'lf-marker-wrap',
            html: `<div class="lf-dot ${st.isBeach ? 'beach' : ''}" style="background-color: rgba(${colorRGB}, 0.78);"></div>${labelHtml}`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          });
          L.marker([st.coords[1], st.coords[0]], { icon: customIcon })
            .addTo(leafletMap)
            .on('click', () => selectStation(st));
        });
      } else {
        leafletMap.setView([lat, lon], zoom, { animate: true, duration: 0.4 });
      }
    }

    function switchToGlobe() {
      isDetailMode = false;
      document.getElementById('leafletMap').classList.remove('active');
      const g = document.getElementById('globe-canvas-container');
      g.style.opacity = '1';
      g.style.pointerEvents = 'auto';
      cameraDistance = 170;
      camera.position.z = cameraDistance;
      updateZoomGauge();
    }

    function locateUser() {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            showDetailMap(pos.coords.latitude, pos.coords.longitude, 11);
          },
          () => {
            showDetailMap(37.78, -122.45, 11);
          }
        );
      } else {
        showDetailMap(37.78, -122.45, 11);
      }
    }

