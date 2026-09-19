    const LAND_FEATURE = topojson.feature(WORLD_TOPO, WORLD_TOPO.objects.land);

    // [FIX-성능] d3.geoContains(LAND_FEATURE, ...)를 매 지점마다 그대로 호출하면
    // 세계 육지 전체(다각형 약 150개, 정점 수만 개)를 한 점씩 다 훑기 때문에
    // 격자 정점 2천여 개를 검사하는 데만 수천만 번의 연산이 필요해서 "너무 무거움"의
    // 주된 원인이었습니다. 다각형별로 bbox(경계 사각형)를 미리 구해두고, 점이 그
    // bbox 안에 들 때만 실제 포함 판정을 하도록 바꿔서 대부분의 다각형은
    // 비교 4번만으로 바로 건너뛰게 했습니다 (같은 정확도, 훨씬 빠름).
    const LAND_POLYS = (() => {
      // [FIX] topojson.feature()는 대상이 GeometryCollection이면 FeatureCollection을
      // 반환합니다 (land 안에 MultiPolygon 지오메트리가 1개 들어있는 구조라서 그렇습니다).
      // .geometry로 바로 접근하면 undefined가 되어 여기서 조용히 죽어있었을 가능성이 큽니다.
      const geom = LAND_FEATURE.type === 'FeatureCollection'
        ? LAND_FEATURE.features[0].geometry
        : LAND_FEATURE.geometry;
      const polygons = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
      return polygons.map(rings => {
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        rings[0].forEach(([lon, lat]) => {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        });
        return { minLon, maxLon, minLat, maxLat, geometry: { type: 'Polygon', coordinates: rings } };
      });
    })();

    function isOnLand(lon, lat) {
      for (let i = 0; i < LAND_POLYS.length; i++) {
        const p = LAND_POLYS[i];
        if (lon < p.minLon || lon > p.maxLon || lat < p.minLat || lat > p.maxLat) continue;
        if (d3.geoContains(p.geometry, [lon, lat])) return true;
      }
      return false;
    }

