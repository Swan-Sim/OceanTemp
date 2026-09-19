    function generateBeachStations() {
      const list = [];

      const beachSpots = [
        { name: "Ocean Beach (San Francisco)", shortName: "Ocean Beach", lat: 37.759, lon: -122.511, curTemp: 13.1, depth: true, net: "NOAA/CeNCOOS" },
        { name: "Baker Beach (Golden Gate View)", shortName: "Baker Beach", lat: 37.793, lon: -122.483, curTemp: 13.4, depth: true, net: "NOAA/CeNCOOS" },
        { name: "China Beach (San Francisco)", shortName: "China Beach", lat: 37.788, lon: -122.491, curTemp: 13.3, depth: true, net: "NOAA/CeNCOOS" },
        { name: "Aquatic Park Cove (SF Bay)", shortName: "Aquatic Park", lat: 37.807, lon: -122.423, curTemp: 14.2, depth: true, net: "NOAA/CeNCOOS" },
        { name: "Crissy Field East Beach (SF)", shortName: "Crissy Field", lat: 37.805, lon: -122.450, curTemp: 13.8, depth: true, net: "NOAA/CeNCOOS" },
        { name: "Rodeo Beach (Marin Headlands)", shortName: "Rodeo Beach", lat: 37.832, lon: -122.538, curTemp: 12.9, depth: true, net: "NOAA/CeNCOOS" },
        { name: "Pacifica State Beach (Linda Mar)", shortName: "Linda Mar", lat: 37.598, lon: -122.502, curTemp: 13.0, depth: true, net: "NOAA/CeNCOOS" },
        { name: "Half Moon Bay (Mavericks)", shortName: "Half Moon Bay", lat: 37.498, lon: -122.498, curTemp: 12.7, depth: true, net: "NOAA/CeNCOOS" },

        { name: "Monterey Breakwater (San Carlos)", shortName: "San Carlos Beach", lat: 36.613, lon: -121.893, curTemp: 12.8, depth: true, net: "NOAA/CeNCOOS" },
        { name: "Lovers Point Beach (Pacific Grove)", shortName: "Lovers Point", lat: 36.626, lon: -121.916, curTemp: 12.9, depth: true, net: "NOAA/CeNCOOS" },
        { name: "Monastery Beach (Carmel)", shortName: "Monastery Beach", lat: 36.523, lon: -121.928, curTemp: 12.5, depth: true, net: "NOAA/CeNCOOS" },
        { name: "Catalina Island (Casino Point)", shortName: "Casino Point", lat: 33.348, lon: -118.326, curTemp: 18.2, depth: true, net: "NOAA/SCCOOS" },
        { name: "La Jolla Shores Beach (San Diego)", shortName: "La Jolla Shores", lat: 32.858, lon: -117.256, curTemp: 17.5, depth: true, net: "NOAA/SCCOOS" },

        { name: "고성 아야진 해변 (Ayajin Beach)", shortName: "아야진 해변", lat: 38.272, lon: 128.555, curTemp: 15.2, depth: true, net: "Beach/NIFS" },
        { name: "속초 등대해변 (Sokcho Light Beach)", shortName: "속초등대", lat: 38.214, lon: 128.601, curTemp: 15.5, depth: true, net: "Beach/NIFS" },
        { name: "양양 남애3리 해변 (Namae Beach)", shortName: "남애 해변", lat: 37.947, lon: 128.788, curTemp: 15.8, depth: true, net: "Beach/NIFS" },
        { name: "강릉 사천진 해변 (Sacheonjin Beach)", shortName: "사천진 해변", lat: 37.834, lon: 128.874, curTemp: 16.0, depth: true, net: "Beach/NIFS" },
        { name: "삼척 장호항/갈남항 해변", shortName: "장호/갈남항", lat: 37.283, lon: 129.321, curTemp: 16.7, depth: true, net: "Beach/NIFS" },
        { name: "포항 이가리 닻 해변", shortName: "이가리 해변", lat: 36.195, lon: 129.387, curTemp: 17.4, depth: true, net: "Beach/NIFS" },
        { name: "제주 서귀포 보목포구/문섬", shortName: "보목포구", lat: 33.238, lon: 126.598, curTemp: 21.2, depth: true, net: "Beach/KHOA" },
        { name: "제주 한림 협재 해변", shortName: "협재 해변", lat: 33.394, lon: 126.239, curTemp: 20.8, depth: true, net: "Beach/KHOA" },
        { name: "제주 함덕해수욕장", shortName: "함덕", lat: 33.543, lon: 126.670, curTemp: 21.0, depth: true, net: "Beach/KHOA" },
        { name: "제주 김녕해수욕장", shortName: "김녕", lat: 33.556, lon: 126.759, curTemp: 20.9, depth: true, net: "Beach/KHOA" },
        { name: "제주 이호테우해변", shortName: "이호테우", lat: 33.499, lon: 126.449, curTemp: 20.7, depth: true, net: "Beach/KHOA" },
        { name: "제주 곽지해수욕장", shortName: "곽지", lat: 33.450, lon: 126.310, curTemp: 20.7, depth: true, net: "Beach/KHOA" },
        { name: "제주 중문색달해수욕장", shortName: "중문색달", lat: 33.239, lon: 126.412, curTemp: 21.5, depth: true, net: "Beach/KHOA" },
        { name: "제주 화순금모래해변", shortName: "화순", lat: 33.235, lon: 126.358, curTemp: 21.3, depth: true, net: "Beach/KHOA" },
        { name: "제주 표선해수욕장", shortName: "표선", lat: 33.325, lon: 126.836, curTemp: 21.1, depth: true, net: "Beach/KHOA" },
        { name: "제주 삼양검은모래해변", shortName: "삼양", lat: 33.515, lon: 126.583, curTemp: 20.9, depth: true, net: "Beach/KHOA" },
        { name: "제주 신양섭지코지해변", shortName: "섭지코지", lat: 33.424, lon: 126.927, curTemp: 21.2, depth: true, net: "Beach/KHOA" },
        { name: "제주 금능해수욕장", shortName: "금능", lat: 33.393, lon: 126.227, curTemp: 20.8, depth: true, net: "Beach/KHOA" },
        { name: "제주 우도 하고수동해변 (다이빙)", shortName: "우도", lat: 33.508, lon: 126.958, curTemp: 21.3, depth: true, net: "Beach/KHOA" },
        { name: "제주 범섬 다이빙포인트", shortName: "범섬", lat: 33.211, lon: 126.545, curTemp: 21.4, depth: true, net: "Beach/KHOA" },
        { name: "제주 사계리 용머리해안", shortName: "사계리", lat: 33.226, lon: 126.310, curTemp: 21.2, depth: true, net: "Beach/KHOA" },

        { name: "Half Moon Bay Beach (Persian Gulf)", shortName: "Half Moon Bay (PG)", lat: 26.162, lon: 50.041, curTemp: 37.8, depth: true, net: "ROPME" },
        { name: "Hanauma Bay Beach (Hawaii)", shortName: "Hanauma Bay", lat: 21.269, lon: -157.694, curTemp: 26.5, depth: true, net: "NOAA/PacIOOS" },

        // 남미
        { name: "Copacabana Beach (Rio de Janeiro)", shortName: "코파카바나", lat: -22.971, lon: -43.182, curTemp: 23.2, depth: true, net: "Beach/INMET" },
        { name: "Ipanema Beach (Rio de Janeiro)", shortName: "이파네마", lat: -22.984, lon: -43.203, curTemp: 23.0, depth: true, net: "Beach/INMET" },
        { name: "Praia da Pipa (Brazil)", shortName: "피파 비치", lat: -6.229, lon: -35.037, curTemp: 27.2, depth: true, net: "Beach/INMET" },

        // 유럽
        { name: "Promenade des Anglais (Nice, France)", shortName: "니스 해변", lat: 43.695, lon: 7.265, curTemp: 22.4, depth: true, net: "Beach/Météo-France" },
        { name: "Zlatni Rat (Bol, Croatia)", shortName: "즐라트니 라트", lat: 43.255, lon: 16.635, curTemp: 24.1, depth: true, net: "Beach/DHMZ" },
        { name: "Navagio Beach (Zakynthos, Greece)", shortName: "나바지오", lat: 37.859, lon: 20.624, curTemp: 25.0, depth: true, net: "Beach/HNMS" },
        { name: "Praia da Marinha (Algarve, Portugal)", shortName: "마리냐 해변", lat: 37.090, lon: -8.412, curTemp: 19.3, depth: true, net: "Beach/IPMA" },
        { name: "Playa de las Catedrales (Spain)", shortName: "카테드랄 해변", lat: 43.552, lon: -7.190, curTemp: 17.6, depth: true, net: "Beach/AEMET" },

        // 아프리카
        { name: "Camps Bay Beach (Cape Town)", shortName: "캠스베이", lat: -33.955, lon: 18.378, curTemp: 16.8, depth: true, net: "Beach/SAWS" },
        { name: "Anse Source d'Argent (Seychelles)", shortName: "앙스 소스다르장", lat: -4.371, lon: 55.826, curTemp: 27.9, depth: true, net: "Beach/SMA" },
        { name: "Nungwi Beach (Zanzibar, Tanzania)", shortName: "능위 해변", lat: -5.727, lon: 39.298, curTemp: 28.3, depth: true, net: "Beach/TMA" },
        { name: "Ras Mohammed / Sharm El Sheikh (Red Sea)", shortName: "샤름 엘 셰이크", lat: 27.735, lon: 34.265, curTemp: 25.1, depth: true, net: "Beach/EMA" },

        // 오세아니아
        { name: "Bondi Beach (Sydney, Australia)", shortName: "본다이 비치", lat: -33.891, lon: 151.277, curTemp: 20.5, depth: true, net: "Beach/BOM" },
        { name: "Whitehaven Beach (Whitsundays, Australia)", shortName: "화이트헤이븐", lat: -20.283, lon: 149.036, curTemp: 25.2, depth: true, net: "Beach/BOM" },
        { name: "Waikiki Beach (Oahu, Hawaii)", shortName: "와이키키", lat: 21.276, lon: -157.827, curTemp: 26.4, depth: true, net: "NOAA/PacIOOS" },
        { name: "Matira Beach (Bora Bora)", shortName: "마티라 비치", lat: -16.539, lon: -151.751, curTemp: 28.1, depth: true, net: "Beach/Météo-France PF" },
        { name: "Natadola Beach (Fiji)", shortName: "나타돌라", lat: -18.198, lon: 177.377, curTemp: 26.8, depth: true, net: "Beach/FMS" },

        // 아시아
        { name: "Maya Bay (Ko Phi Phi, Thailand)", shortName: "마야 베이", lat: 7.680, lon: 98.769, curTemp: 29.3, depth: true, net: "Beach/TMD" },
        { name: "White Beach (Boracay, Philippines)", shortName: "보라카이", lat: 11.967, lon: 121.923, curTemp: 28.6, depth: true, net: "Beach/PAGASA" },
        { name: "Kuta Beach (Bali, Indonesia)", shortName: "쿠타 비치", lat: -8.717, lon: 115.169, curTemp: 28.2, depth: true, net: "Beach/BMKG" },
        { name: "Siloso Beach (Sentosa, Singapore)", shortName: "실로소 비치", lat: 1.249, lon: 103.810, curTemp: 29.4, depth: true, net: "Beach/MSS" },
        { name: "Manza Beach (Okinawa, Japan)", shortName: "만자 비치", lat: 26.500, lon: 127.900, curTemp: 24.6, depth: true, net: "Beach/JMA" },
        { name: "Emerald Beach (Motobu, Okinawa, Japan)", shortName: "에메랄드비치", lat: 26.694, lon: 127.877, curTemp: 24.5, depth: true, net: "Beach/JMA" },
        { name: "Kabira Bay (Ishigaki, Japan)", shortName: "카비라만", lat: 24.457, lon: 124.173, curTemp: 27.0, depth: true, net: "Beach/JMA" },
        { name: "Yonaha Maehama Beach (Miyako, Japan)", shortName: "요나하마에하마", lat: 24.737, lon: 125.267, curTemp: 27.5, depth: true, net: "Beach/JMA" },
        { name: "Shirahama Beach (Wakayama, Japan)", shortName: "시라하마", lat: 33.677, lon: 135.336, curTemp: 21.0, depth: true, net: "Beach/JMA" },
        { name: "Shonan / Enoshima Beach (Kanagawa, Japan)", shortName: "쇼난/에노시마", lat: 35.300, lon: 139.480, curTemp: 19.0, depth: true, net: "Beach/JMA" },
        { name: "Kawana (Izu Peninsula, Japan)", shortName: "이즈반도", lat: 34.897, lon: 139.113, curTemp: 20.0, depth: true, net: "Beach/JMA" },
        { name: "Chirihama Beach (Ishikawa, Japan)", shortName: "치리하마", lat: 36.850, lon: 136.783, curTemp: 18.0, depth: true, net: "Beach/JMA" },
        { name: "Amakusa (Kumamoto, Japan)", shortName: "아마쿠사", lat: 32.400, lon: 130.100, curTemp: 22.0, depth: true, net: "Beach/JMA" },

        // 카리브해 & 대서양 섬
        { name: "Grace Bay (Turks & Caicos)", shortName: "그레이스 베이", lat: 21.797, lon: -72.174, curTemp: 27.6, depth: true, net: "Beach/local" },
        { name: "Seven Mile Beach (Grand Cayman)", shortName: "세븐마일 비치", lat: 19.345, lon: -81.383, curTemp: 28.0, depth: true, net: "Beach/CIMWS" },
        { name: "Varadero Beach (Cuba)", shortName: "바라데로", lat: 23.157, lon: -81.245, curTemp: 27.4, depth: true, net: "Beach/INSMET" },

        // 세계적인 다이빙 명소
        { name: "Rock Islands (Palau)", shortName: "팔라우", lat: 7.283, lon: 134.478, curTemp: 28.5, depth: true, net: "Beach/local" },
        { name: "Male Atoll (Maldives)", shortName: "몰디브", lat: 4.175, lon: 73.509, curTemp: 28.4, depth: true, net: "Beach/Met Maldives" },

        // 북미 대서양/걸프/서부 추가
        { name: "South Beach (Miami, USA)", shortName: "마이애미 사우스비치", lat: 25.782, lon: -80.130, curTemp: 27.5, depth: true, net: "NOAA/local" },
        { name: "Myrtle Beach (South Carolina, USA)", shortName: "머틀비치", lat: 33.696, lon: -78.886, curTemp: 24.0, depth: true, net: "NOAA/local" },
        { name: "Cape Cod National Seashore (USA)", shortName: "케이프 코드", lat: 41.891, lon: -69.965, curTemp: 17.0, depth: true, net: "NOAA/local" },
        { name: "Tulum Beach (Mexico)", shortName: "툴룸", lat: 20.211, lon: -87.429, curTemp: 27.8, depth: true, net: "Beach/SMN" },
        { name: "Cancún Beach (Mexico)", shortName: "칸쿤", lat: 21.161, lon: -86.851, curTemp: 28.0, depth: true, net: "Beach/SMN" },
        { name: "Tofino (Vancouver Island, Canada)", shortName: "토피노", lat: 49.153, lon: -125.906, curTemp: 12.5, depth: true, net: "Beach/ECCC" },

        // 남미 추가
        { name: "Punta del Este (Uruguay)", shortName: "푼타델에스테", lat: -34.960, lon: -54.951, curTemp: 20.5, depth: true, net: "Beach/INUMET" },
        { name: "Mar del Plata (Argentina)", shortName: "마르델플라타", lat: -38.014, lon: -57.545, curTemp: 17.0, depth: true, net: "Beach/SMN-AR" },
        { name: "Viña del Mar (Chile)", shortName: "비냐델마르", lat: -33.024, lon: -71.551, curTemp: 14.5, depth: true, net: "Beach/DMC" },
        { name: "Cartagena Beach (Colombia)", shortName: "카르타헤나", lat: 10.423, lon: -75.548, curTemp: 29.0, depth: true, net: "Beach/IDEAM" },
        { name: "Montañita (Ecuador)", shortName: "몬타니타", lat: -1.836, lon: -80.740, curTemp: 25.0, depth: true, net: "Beach/INAMHI" },
        { name: "Tortuga Bay (Galápagos, Ecuador)", shortName: "갈라파고스", lat: -0.756, lon: -90.317, curTemp: 24.0, depth: true, net: "Beach/INAMHI" },

        // 유럽 추가
        { name: "Amalfi Coast Beach (Italy)", shortName: "아말피", lat: 40.634, lon: 14.603, curTemp: 22.0, depth: true, net: "Beach/local" },
        { name: "Costa del Sol / Marbella (Spain)", shortName: "마르베야", lat: 36.510, lon: -4.886, curTemp: 20.5, depth: true, net: "Beach/AEMET" },
        { name: "Ses Salines Beach (Ibiza, Spain)", shortName: "이비자", lat: 38.870, lon: 1.386, curTemp: 23.0, depth: true, net: "Beach/AEMET" },
        { name: "Kamari Beach (Santorini, Greece)", shortName: "산토리니", lat: 36.371, lon: 25.478, curTemp: 23.5, depth: true, net: "Beach/HNMS" },
        { name: "Mellieħa Bay (Malta)", shortName: "몰타", lat: 35.958, lon: 14.362, curTemp: 22.5, depth: true, net: "Beach/local" },
        { name: "Nissi Beach (Cyprus)", shortName: "키프로스", lat: 34.988, lon: 33.972, curTemp: 22.0, depth: true, net: "Beach/DOM-CY" },
        { name: "Kaş Beach (Turkey)", shortName: "카쉬", lat: 36.202, lon: 29.641, curTemp: 22.0, depth: true, net: "Beach/MGM" },
        { name: "Sveti Stefan Beach (Montenegro)", shortName: "몬테네그로", lat: 42.255, lon: 18.892, curTemp: 21.0, depth: true, net: "Beach/local" },
        { name: "Tel Aviv Beach (Israel)", shortName: "텔아비브", lat: 32.083, lon: 34.766, curTemp: 24.0, depth: true, net: "Beach/IMS" },

        // 아프리카 추가
        { name: "Agadir Beach (Morocco)", shortName: "아가디르", lat: 30.421, lon: -9.598, curTemp: 19.5, depth: true, net: "Beach/DMN" },
        { name: "Labadi Beach (Accra, Ghana)", shortName: "라바디", lat: 5.556, lon: -0.153, curTemp: 27.5, depth: true, net: "Beach/GMet" },
        { name: "Diani Beach (Mombasa, Kenya)", shortName: "디아니", lat: -4.278, lon: 39.591, curTemp: 27.0, depth: true, net: "Beach/KMD" },
        { name: "Umhlanga Rocks (Durban, South Africa)", shortName: "움흘랑가", lat: -29.727, lon: 31.087, curTemp: 21.5, depth: true, net: "Beach/SAWS" },
        { name: "Belle Mare Beach (Mauritius)", shortName: "모리셔스", lat: -20.192, lon: 57.766, curTemp: 26.5, depth: true, net: "Beach/MMS" },
        { name: "Hurghada Beach (Red Sea, Egypt)", shortName: "후르가다", lat: 27.257, lon: 33.813, curTemp: 25.5, depth: true, net: "Beach/EMA" },

        // 아시아 추가
        { name: "Nha Trang Beach (Vietnam)", shortName: "냐짱", lat: 12.238, lon: 109.196, curTemp: 27.5, depth: true, net: "Beach/NCHMF" },
        { name: "My Khe Beach (Da Nang, Vietnam)", shortName: "다낭", lat: 16.054, lon: 108.247, curTemp: 27.0, depth: true, net: "Beach/NCHMF" },
        { name: "Baga Beach (Goa, India)", shortName: "고아", lat: 15.556, lon: 73.751, curTemp: 28.5, depth: true, net: "Beach/IMD" },
        { name: "Unawatuna Beach (Sri Lanka)", shortName: "우나와투나", lat: 6.010, lon: 80.249, curTemp: 28.0, depth: true, net: "Beach/DoM" },
        { name: "Radhanagar Beach (Andaman, India)", shortName: "안다만", lat: 11.598, lon: 92.947, curTemp: 28.0, depth: true, net: "Beach/IMD" },
        { name: "Yalong Bay (Sanya, China)", shortName: "싼야", lat: 18.222, lon: 109.567, curTemp: 27.0, depth: true, net: "Beach/CMA" },
        { name: "Kenting Beach (Taiwan)", shortName: "컨딩", lat: 21.945, lon: 120.796, curTemp: 26.5, depth: true, net: "Beach/CWA" },

        // 오세아니아 추가
        { name: "Bay of Islands (New Zealand)", shortName: "베이오브아일랜즈", lat: -35.263, lon: 174.106, curTemp: 19.0, depth: true, net: "Beach/MetService" },
        { name: "Champagne Beach (Vanuatu)", shortName: "바누아투", lat: -15.238, lon: 167.161, curTemp: 27.0, depth: true, net: "Beach/VMGD" },
        { name: "Anse Vata (Nouméa, New Caledonia)", shortName: "누메아", lat: -22.286, lon: 166.449, curTemp: 25.0, depth: true, net: "Beach/Météo-France NC" },

        // 카리브해 추가
        { name: "Eagle Beach (Aruba)", shortName: "아루바", lat: 12.559, lon: -70.048, curTemp: 28.0, depth: true, net: "Beach/local" },
        { name: "Cable Beach (Nassau, Bahamas)", shortName: "바하마", lat: 25.073, lon: -77.404, curTemp: 27.5, depth: true, net: "Beach/local" },
        { name: "Negril Beach (Jamaica)", shortName: "네그릴", lat: 18.263, lon: -78.348, curTemp: 28.0, depth: true, net: "Beach/local" },
        { name: "Flamenco Beach (Culebra, Puerto Rico)", shortName: "쿨레브라", lat: 18.328, lon: -65.309, curTemp: 28.0, depth: true, net: "NOAA/local" },
        { name: "Accra Beach (Barbados)", shortName: "바베이도스", lat: 13.075, lon: -59.616, curTemp: 27.5, depth: true, net: "Beach/local" },

        // 흑해
        { name: "Sochi Beach (Russia)", shortName: "소치", lat: 43.586, lon: 39.723, curTemp: 23.0, depth: true, net: "Beach/Roshydromet" }
      ];

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
          name: `🤿 ${s.name}`,
          label: s.shortName,
          isBeach: true,
          coords: [s.lon, s.lat],
          curTemp: s.curTemp,
          hasDepth: s.depth,
          network: s.net
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
      const latStep = 4.5;
      const baseLonStep = 5.5;
      for (let lat = -70; lat <= 70; lat += latStep) {
        const lonStep = Math.min(30, baseLonStep / Math.max(0.28, Math.cos(lat * Math.PI / 180)));
        for (let lon = -180; lon <= 180; lon += lonStep) {
          // 지터(무작위 흔들림)를 먼저 적용한 좌표로 육지 판정을 합니다.
          const jLat = lat + (Math.random() * 0.5);
          const jLon = lon + (Math.random() * lonStep * 0.1);
          if (isOnLand(jLon, jLat)) continue;

          let base = 31.0 - Math.abs(jLat) * 0.45 + (Math.random() * 2 - 1);
          if (jLat >= 22 && jLat <= 28 && jLon >= 48 && jLon <= 56) base += 6.5 + Math.random() * 1.5;
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

