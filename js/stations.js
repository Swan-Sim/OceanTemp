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
        { name: "Laguna Beach (California, USA)", shortName: "Laguna Beach", lat: 33.542, lon: -117.783, curTemp: 18.0, depth: true, net: "NOAA/SCCOOS" },
        { name: "Venice Beach (Los Angeles, USA)", shortName: "Venice Beach", lat: 33.985, lon: -118.469, curTemp: 18.5, depth: true, net: "NOAA/SCCOOS" },
        { name: "Santa Monica Beach (California, USA)", shortName: "Santa Monica", lat: 34.010, lon: -118.496, curTemp: 18.3, depth: true, net: "NOAA/SCCOOS" },
        { name: "Zuma Beach (Malibu, USA)", shortName: "Malibu", lat: 34.028, lon: -118.821, curTemp: 17.8, depth: true, net: "NOAA/SCCOOS" },
        { name: "Cocoa Beach (Florida, USA)", shortName: "Cocoa Beach", lat: 28.320, lon: -80.608, curTemp: 27.5, depth: true, net: "NOAA/NDBC" },
        { name: "Daytona Beach (Florida, USA)", shortName: "Daytona Beach", lat: 29.211, lon: -81.023, curTemp: 27.0, depth: true, net: "NOAA/NDBC" },
        { name: "Lanikai Beach (Oahu, Hawaii)", shortName: "Lanikai", lat: 21.393, lon: -157.715, curTemp: 26.3, depth: true, net: "NOAA/PacIOOS" },

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

        // badatime.com · 국립수산과학원(NIFS) e-연구바다 실시간 관측망 기준 주요 지점
        { name: "인천항 관측지점", shortName: "인천", lat: 37.456, lon: 126.617, curTemp: 20.5, depth: true, net: "Beach/NIFS·badatime" },
        { name: "평택항 관측지점", shortName: "평택", lat: 36.965, lon: 126.823, curTemp: 20.8, depth: true, net: "Beach/NIFS·badatime" },
        { name: "보령(대천) 관측지점", shortName: "보령", lat: 36.353, lon: 126.492, curTemp: 21.0, depth: true, net: "Beach/NIFS·badatime" },
        { name: "장항 관측지점", shortName: "장항", lat: 36.011, lon: 126.691, curTemp: 21.2, depth: true, net: "Beach/NIFS·badatime" },
        { name: "군산 관측지점", shortName: "군산", lat: 35.978, lon: 126.696, curTemp: 21.3, depth: true, net: "Beach/NIFS·badatime" },
        { name: "위도 관측지점", shortName: "위도", lat: 35.612, lon: 126.297, curTemp: 21.5, depth: true, net: "Beach/NIFS·badatime" },
        { name: "영광 관측지점", shortName: "영광", lat: 35.348, lon: 126.290, curTemp: 21.6, depth: true, net: "Beach/NIFS·badatime" },
        { name: "목포 관측지점", shortName: "목포", lat: 34.812, lon: 126.375, curTemp: 22.0, depth: true, net: "Beach/NIFS·badatime" },
        { name: "흑산도 관측지점", shortName: "흑산도", lat: 34.685, lon: 125.435, curTemp: 22.5, depth: true, net: "Beach/NIFS·badatime" },
        { name: "완도 관측지점", shortName: "완도", lat: 34.311, lon: 126.755, curTemp: 22.3, depth: true, net: "Beach/NIFS·badatime" },
        { name: "거문도 관측지점", shortName: "거문도", lat: 34.032, lon: 127.313, curTemp: 22.8, depth: true, net: "Beach/NIFS·badatime" },
        { name: "나로도 관측지점", shortName: "나로도", lat: 34.485, lon: 127.487, curTemp: 22.6, depth: true, net: "Beach/NIFS·badatime" },
        { name: "여수 관측지점", shortName: "여수", lat: 34.760, lon: 127.662, curTemp: 22.4, depth: true, net: "Beach/NIFS·badatime" },
        { name: "삼천포 관측지점", shortName: "삼천포", lat: 34.933, lon: 128.065, curTemp: 22.2, depth: true, net: "Beach/NIFS·badatime" },
        { name: "통영 관측지점", shortName: "통영", lat: 34.846, lon: 128.433, curTemp: 22.1, depth: true, net: "Beach/NIFS·badatime" },
        { name: "거제 관측지점", shortName: "거제", lat: 34.881, lon: 128.621, curTemp: 21.9, depth: true, net: "Beach/NIFS·badatime" },
        { name: "가덕도 관측지점", shortName: "가덕도", lat: 35.024, lon: 128.808, curTemp: 21.8, depth: true, net: "Beach/NIFS·badatime" },
        { name: "진해 관측지점", shortName: "진해", lat: 35.146, lon: 128.700, curTemp: 21.7, depth: true, net: "Beach/NIFS·badatime" },
        { name: "부산 해운대 관측지점", shortName: "해운대", lat: 35.150, lon: 129.220, curTemp: 21.6, depth: true, net: "Beach/NIFS·badatime" },
        { name: "부산항 관측지점", shortName: "부산", lat: 35.050, lon: 129.150, curTemp: 21.5, depth: true, net: "Beach/NIFS·badatime" },
        { name: "울산 관측지점", shortName: "울산", lat: 35.480, lon: 129.500, curTemp: 20.9, depth: true, net: "Beach/NIFS·badatime" },
        { name: "포항 관측지점", shortName: "포항", lat: 36.000, lon: 129.500, curTemp: 18.5, depth: true, net: "Beach/NIFS·badatime" },
        { name: "영덕 관측지점", shortName: "영덕", lat: 36.415, lon: 129.480, curTemp: 18.0, depth: true, net: "Beach/NIFS·badatime" },
        { name: "울진 관측지점", shortName: "울진", lat: 36.993, lon: 129.480, curTemp: 17.5, depth: true, net: "Beach/NIFS·badatime" },
        { name: "후포 관측지점", shortName: "후포", lat: 36.677, lon: 129.520, curTemp: 17.8, depth: true, net: "Beach/NIFS·badatime" },
        { name: "울릉도 저동 관측지점", shortName: "울릉도", lat: 37.484, lon: 130.905, curTemp: 17.2, depth: true, net: "Beach/NIFS·badatime" },
        { name: "독도 관측지점", shortName: "독도", lat: 37.242, lon: 131.868, curTemp: 16.9, depth: true, net: "Beach/NIFS·badatime" },
        { name: "주문진 관측지점", shortName: "주문진", lat: 37.897, lon: 128.828, curTemp: 15.6, depth: true, net: "Beach/NIFS·badatime" },
        { name: "동해항 관측지점", shortName: "동해항", lat: 37.507, lon: 129.135, curTemp: 16.2, depth: true, net: "Beach/NIFS·badatime" },
        { name: "묵호 관측지점", shortName: "묵호", lat: 37.550, lon: 129.115, curTemp: 16.3, depth: true, net: "Beach/NIFS·badatime" },
        { name: "백령도 관측지점", shortName: "백령도", lat: 37.967, lon: 124.630, curTemp: 19.5, depth: true, net: "Beach/NIFS·badatime" },
        { name: "대청도 관측지점", shortName: "대청도", lat: 37.826, lon: 124.706, curTemp: 19.7, depth: true, net: "Beach/NIFS·badatime" },
        { name: "태안 관측지점", shortName: "태안", lat: 36.746, lon: 126.298, curTemp: 20.3, depth: true, net: "Beach/NIFS·badatime" },
        { name: "제주항 관측지점", shortName: "제주항", lat: 33.529, lon: 126.532, curTemp: 21.4, depth: true, net: "Beach/NIFS·badatime" },
        { name: "성산포 관측지점", shortName: "성산포", lat: 33.474, lon: 126.927, curTemp: 21.6, depth: true, net: "Beach/NIFS·badatime" },
        { name: "모슬포 관측지점", shortName: "모슬포", lat: 33.213, lon: 126.251, curTemp: 21.5, depth: true, net: "Beach/NIFS·badatime" },
        { name: "추자도 관측지점", shortName: "추자도", lat: 33.964, lon: 126.301, curTemp: 21.0, depth: true, net: "Beach/NIFS·badatime" },
        { name: "이어도 관측지점", shortName: "이어도", lat: 32.123, lon: 125.182, curTemp: 22.3, depth: true, net: "Beach/NIFS·badatime" },

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
        { name: "Sochi Beach (Russia)", shortName: "소치", lat: 43.586, lon: 39.723, curTemp: 23.0, depth: true, net: "Beach/Roshydromet" },

        // 미국 추가
        { name: "Key West Beach (Florida, USA)", shortName: "키웨스트", lat: 24.556, lon: -81.780, curTemp: 28.5, depth: true, net: "NOAA/NDBC" },
        { name: "Virginia Beach (Virginia, USA)", shortName: "버지니아비치", lat: 36.845, lon: -75.978, curTemp: 24.0, depth: true, net: "NOAA/NDBC" },
        { name: "Cape Hatteras (Outer Banks, USA)", shortName: "케이프해터러스", lat: 35.250, lon: -75.530, curTemp: 25.0, depth: true, net: "NOAA/NDBC" },
        { name: "Newport Beach (California, USA)", shortName: "뉴포트비치", lat: 33.607, lon: -117.929, curTemp: 19.5, depth: true, net: "NOAA/SCCOOS" },

        // 멕시코 추가
        { name: "Puerto Vallarta Beach (Mexico)", shortName: "푸에르토바야르타", lat: 20.653, lon: -105.225, curTemp: 28.5, depth: true, net: "Beach/SMN" },
        { name: "Cabo San Lucas Beach (Mexico)", shortName: "카보산루카스", lat: 22.891, lon: -109.912, curTemp: 27.0, depth: true, net: "Beach/SMN" },
        { name: "Cozumel Beach (Mexico)", shortName: "코수멜", lat: 20.422, lon: -86.922, curTemp: 28.2, depth: true, net: "Beach/SMN" },

        // 베트남 추가
        { name: "Phu Quoc Beach (Vietnam)", shortName: "푸꾸옥", lat: 10.217, lon: 103.967, curTemp: 28.8, depth: true, net: "Beach/NCHMF" },
        { name: "Ha Long Bay (Vietnam)", shortName: "하롱베이", lat: 20.910, lon: 107.184, curTemp: 26.5, depth: true, net: "Beach/NCHMF" },

        // 필리핀 추가
        { name: "El Nido Beach (Palawan, Philippines)", shortName: "엘니도", lat: 11.185, lon: 119.392, curTemp: 28.5, depth: true, net: "Beach/PAGASA" },
        { name: "Mactan Island (Cebu, Philippines)", shortName: "막탄섬", lat: 10.309, lon: 123.987, curTemp: 28.7, depth: true, net: "Beach/PAGASA" },

        // 인도네시아 추가
        { name: "Gili Trawangan (Indonesia)", shortName: "길리트라왕안", lat: -8.349, lon: 116.042, curTemp: 28.3, depth: true, net: "Beach/BMKG" },
        { name: "Raja Ampat (Indonesia)", shortName: "라자암팟", lat: -0.234, lon: 130.523, curTemp: 29.0, depth: true, net: "Beach/BMKG" },

        // 말레이시아(쿠알라룸푸르 인근 해안) 추가
        { name: "Port Klang Beach (Malaysia)", shortName: "포트클랑", lat: 3.000, lon: 101.391, curTemp: 29.5, depth: true, net: "Beach/MetMalaysia" },
        { name: "Langkawi Beach (Malaysia)", shortName: "랑카위", lat: 6.350, lon: 99.800, curTemp: 29.8, depth: true, net: "Beach/MetMalaysia" },
        { name: "Malacca Beach (Malaysia)", shortName: "말라카", lat: 2.194, lon: 102.251, curTemp: 29.6, depth: true, net: "Beach/MetMalaysia" },

        // 지중해 연안 추가
        { name: "Barcelona Beach (Spain)", shortName: "바르셀로나", lat: 41.375, lon: 2.192, curTemp: 21.5, depth: true, net: "Beach/AEMET" },
        { name: "Dubrovnik Beach (Croatia)", shortName: "두브로브니크", lat: 42.640, lon: 18.107, curTemp: 22.0, depth: true, net: "Beach/local" },
        { name: "Mykonos Beach (Greece)", shortName: "미코노스", lat: 37.445, lon: 25.328, curTemp: 22.8, depth: true, net: "Beach/HNMS" },
        { name: "Taormina Beach (Sicily, Italy)", shortName: "타오르미나", lat: 37.852, lon: 15.289, curTemp: 22.3, depth: true, net: "Beach/local" },
        { name: "Antalya Beach (Turkey)", shortName: "안탈리아", lat: 36.885, lon: 30.700, curTemp: 23.5, depth: true, net: "Beach/MGM" },

        // 이집트 추가
        { name: "Alexandria Beach (Egypt)", shortName: "알렉산드리아", lat: 31.200, lon: 29.918, curTemp: 24.0, depth: true, net: "Beach/EMA" },
        { name: "Dahab Beach (Red Sea, Egypt)", shortName: "다합", lat: 28.510, lon: 34.514, curTemp: 25.8, depth: true, net: "Beach/EMA" },

        // 일본 추가
        { name: "Naha Beach (Okinawa, Japan)", shortName: "나하", lat: 26.212, lon: 127.679, curTemp: 24.8, depth: true, net: "Beach/JMA" },
        { name: "Shimoda Beach (Izu, Japan)", shortName: "시모다", lat: 34.673, lon: 138.945, curTemp: 20.5, depth: true, net: "Beach/JMA" },

        // 대만 추가
        { name: "Green Island (Taiwan)", shortName: "뤼다오", lat: 22.662, lon: 121.491, curTemp: 26.8, depth: true, net: "Beach/CWA" },
        { name: "Xiaoliuqiu (Taiwan)", shortName: "샤오류추", lat: 22.352, lon: 120.377, curTemp: 27.0, depth: true, net: "Beach/CWA" },

        // 그 밖의 유명하지만 빠져있던 정점
        { name: "Patong Beach (Phuket, Thailand)", shortName: "파통비치", lat: 7.896, lon: 98.296, curTemp: 29.0, depth: true, net: "Beach/TMD" },
        { name: "Railay Beach (Krabi, Thailand)", shortName: "라일레이", lat: 8.010, lon: 98.837, curTemp: 29.2, depth: true, net: "Beach/TMD" },
        { name: "Saint-Tropez Beach (France)", shortName: "생트로페", lat: 43.267, lon: 6.638, curTemp: 21.8, depth: true, net: "Beach/local" },
        { name: "Positano Beach (Amalfi, Italy)", shortName: "포지타노", lat: 40.628, lon: 14.485, curTemp: 22.2, depth: true, net: "Beach/local" },
        { name: "Lido di Venezia (Italy)", shortName: "리도디베네치아", lat: 45.410, lon: 12.370, curTemp: 20.5, depth: true, net: "Beach/local" },
        { name: "Surfers Paradise (Gold Coast, Australia)", shortName: "서퍼스파라다이스", lat: -28.003, lon: 153.430, curTemp: 21.5, depth: true, net: "Beach/BOM" },
        { name: "Anse Source d'Argent (Seychelles)", shortName: "앙스소스다르장", lat: -4.371, lon: 55.826, curTemp: 27.5, depth: true, net: "Beach/local" },
        { name: "Clifton Beach (Cape Town, South Africa)", shortName: "클리프턴비치", lat: -33.951, lon: 18.377, curTemp: 16.5, depth: true, net: "Beach/SAWS" },
        { name: "Seminyak Beach (Bali, Indonesia)", shortName: "스미냑", lat: -8.690, lon: 115.164, curTemp: 28.4, depth: true, net: "Beach/BMKG" },
        { name: "Playa del Carmen (Mexico)", shortName: "플라야델카르멘", lat: 20.629, lon: -87.073, curTemp: 28.0, depth: true, net: "Beach/SMN" },
        { name: "Pink Sands Beach (Harbour Island, Bahamas)", shortName: "핑크샌즈비치", lat: 25.508, lon: -76.635, curTemp: 27.8, depth: true, net: "Beach/local" },
        { name: "Socorro Island (Revillagigedo, Mexico)", shortName: "소코로", lat: 18.79, lon: -110.97, curTemp: 25.5, depth: true, net: "Beach/SMN" },

        // 해양(연구)기관 소재 정점 - 1차 배치 (193개국 전체는 규모상 여러 턴에 나눠 계속 추가할게요)
        { name: "National Oceanography Centre (Southampton, UK)", shortName: "사우샘프턴 NOC", lat: 50.891, lon: -1.400, curTemp: 16.5, depth: true, net: "Institute/NOC" },
        { name: "Plymouth Marine Laboratory (UK)", shortName: "플리머스", lat: 50.365, lon: -4.142, curTemp: 15.8, depth: true, net: "Institute/PML" },
        { name: "Institute of Marine Research (Bergen, Norway)", shortName: "베르겐 IMR", lat: 60.397, lon: 5.324, curTemp: 12.0, depth: true, net: "Institute/Havforskningsinstituttet" },
        { name: "Alfred Wegener Institute (Bremerhaven, Germany)", shortName: "브레머하펜 AWI", lat: 53.539, lon: 8.581, curTemp: 14.5, depth: true, net: "Institute/AWI" },
        { name: "IFREMER (Brest, France)", shortName: "브레스트 IFREMER", lat: 48.383, lon: -4.489, curTemp: 15.2, depth: true, net: "Institute/IFREMER" },
        { name: "NIOZ Royal Netherlands Institute for Sea Research (Texel)", shortName: "텍셀 NIOZ", lat: 53.002, lon: 4.789, curTemp: 15.0, depth: true, net: "Institute/NIOZ" },
        { name: "IEO Instituto Español de Oceanografía (Vigo, Spain)", shortName: "비고 IEO", lat: 42.238, lon: -8.723, curTemp: 17.0, depth: true, net: "Institute/IEO" },
        { name: "IPMA Instituto Português do Mar e da Atmosfera (Lisbon)", shortName: "리스본 IPMA", lat: 38.706, lon: -9.135, curTemp: 18.5, depth: true, net: "Institute/IPMA" },
        { name: "National Institute of Oceanography (Goa, India)", shortName: "고아 NIO", lat: 15.452, lon: 73.805, curTemp: 28.5, depth: true, net: "Institute/NIO" },
        { name: "Institute of Oceanology, CAS (Qingdao, China)", shortName: "칭다오 IOCAS", lat: 36.067, lon: 120.383, curTemp: 21.5, depth: true, net: "Institute/IOCAS" },
        { name: "Pacific Oceanological Institute (Vladivostok, Russia)", shortName: "블라디보스토크 POI", lat: 43.115, lon: 131.885, curTemp: 17.0, depth: true, net: "Institute/POI RAS" },
        { name: "Bedford Institute of Oceanography (Dartmouth, Canada)", shortName: "베드퍼드", lat: 44.674, lon: -63.640, curTemp: 14.0, depth: true, net: "Institute/BIO" },
        { name: "Instituto Oceanográfico (Santos, Brazil)", shortName: "산투스 해양연구소", lat: -23.960, lon: -46.333, curTemp: 23.5, depth: true, net: "Institute/IO-USP" },
        { name: "Oceanographic Research Institute (Durban, South Africa)", shortName: "더반 ORI", lat: -29.868, lon: 31.043, curTemp: 22.0, depth: true, net: "Institute/ORI" },
        { name: "NIWA (Wellington, New Zealand)", shortName: "웰링턴 NIWA", lat: -41.286, lon: 174.777, curTemp: 14.5, depth: true, net: "Institute/NIWA" },
        { name: "SHOA Servicio Hidrográfico y Oceanográfico (Valparaíso, Chile)", shortName: "발파라이소 SHOA", lat: -33.036, lon: -71.627, curTemp: 14.8, depth: true, net: "Institute/SHOA" },
        { name: "IMARPE Instituto del Mar del Perú (Callao)", shortName: "카야오 IMARPE", lat: -12.056, lon: -77.148, curTemp: 18.5, depth: true, net: "Institute/IMARPE" },
        { name: "Kenya Marine and Fisheries Research Institute (Mombasa)", shortName: "몸바사 KMFRI", lat: -4.043, lon: 39.658, curTemp: 27.0, depth: true, net: "Institute/KMFRI" },
        { name: "Nigerian Institute for Oceanography and Marine Research (Lagos)", shortName: "라고스 NIOMR", lat: 6.455, lon: 3.393, curTemp: 27.5, depth: true, net: "Institute/NIOMR" },
        { name: "Institute of Marine Sciences (Erdemli, Turkey)", shortName: "에르데믈리", lat: 36.562, lon: 34.254, curTemp: 23.0, depth: true, net: "Institute/IMS-METU" },

        // 호주 추가
        { name: "Great Barrier Reef (Cairns, Australia)", shortName: "그레이트배리어리프", lat: -16.925, lon: 145.771, curTemp: 27.0, depth: true, net: "Beach/BOM" },
        { name: "Ningaloo Reef (Exmouth, Australia)", shortName: "닝갈루리프", lat: -21.93, lon: 114.13, curTemp: 25.0, depth: true, net: "Beach/BOM" },
        { name: "Cottesloe Beach (Perth, Australia)", shortName: "코테슬로비치", lat: -31.996, lon: 115.755, curTemp: 20.5, depth: true, net: "Beach/BOM" },
        { name: "Manly Beach (Sydney, Australia)", shortName: "맨리비치", lat: -33.797, lon: 151.288, curTemp: 20.0, depth: true, net: "Beach/BOM" },
        { name: "AIMS Australian Institute of Marine Science (Townsville)", shortName: "타운즈빌 AIMS", lat: -19.318, lon: 146.817, curTemp: 26.5, depth: true, net: "Institute/AIMS" },
        { name: "CSIRO Marine (Hobart, Tasmania)", shortName: "호바트 CSIRO", lat: -42.883, lon: 147.328, curTemp: 14.0, depth: true, net: "Institute/CSIRO" },

        // 마이크로네시아·사이판 추가
        { name: "Chuuk Lagoon (Micronesia)", shortName: "추크석호", lat: 7.412, lon: 151.79, curTemp: 29.0, depth: true, net: "Beach/local" },
        { name: "Pohnpei (Micronesia)", shortName: "포나페", lat: 6.887, lon: 158.215, curTemp: 28.8, depth: true, net: "Beach/local" },
        { name: "Micro Beach (Saipan)", shortName: "사이판 미크로비치", lat: 15.213, lon: 145.741, curTemp: 28.5, depth: true, net: "Beach/local" },
        { name: "Banzai Cliff Diving Area (Saipan)", shortName: "반자이클리프", lat: 15.245, lon: 145.751, curTemp: 28.5, depth: true, net: "Beach/local" },

        // 인도네시아 추가
        { name: "Komodo National Park (Labuan Bajo, Indonesia)", shortName: "코모도", lat: -8.559, lon: 119.885, curTemp: 28.0, depth: true, net: "Beach/BMKG" },
        { name: "Wakatobi (Indonesia)", shortName: "와카토비", lat: -5.478, lon: 123.749, curTemp: 28.5, depth: true, net: "Beach/BMKG" },
        { name: "Bunaken (Manado, Indonesia)", shortName: "부나켄", lat: 1.622, lon: 124.759, curTemp: 28.7, depth: true, net: "Beach/BMKG" },

        // 이집트 추가
        { name: "Marsa Alam (Egypt)", shortName: "마르사알람", lat: 25.070, lon: 34.893, curTemp: 26.0, depth: true, net: "Beach/EMA" },
        { name: "Ras Mohammed National Park (Egypt)", shortName: "라스모하메드", lat: 27.73, lon: 34.25, curTemp: 25.5, depth: true, net: "Beach/EMA" },

        // 터키 추가
        { name: "Bodrum (Turkey)", shortName: "보드룸", lat: 37.034, lon: 27.430, curTemp: 23.5, depth: true, net: "Beach/MGM" },
        { name: "Ölüdeniz (Fethiye, Turkey)", shortName: "욀루데니즈", lat: 36.548, lon: 29.117, curTemp: 23.8, depth: true, net: "Beach/MGM" },

        // 마리아나제도·괌
        { name: "Tinian Island (Northern Mariana Islands)", shortName: "티니안섬", lat: 15.0, lon: 145.63, curTemp: 28.5, depth: true, net: "Beach/local" },
        { name: "Challenger Deep (Mariana Trench)", shortName: "챌린저해연", lat: 11.35, lon: 142.2, curTemp: 27.5, depth: true, net: "Beach/NOAA" },
        { name: "Tumon Bay (Guam)", shortName: "투몬베이", lat: 13.509, lon: 144.808, curTemp: 28.8, depth: true, net: "Beach/NOAA" },

        // 북극·남극 (각 1곳)
        { name: "Ny-Ålesund (Svalbard, Arctic)", shortName: "니올레순(북극)", lat: 78.923, lon: 11.923, curTemp: 2.0, depth: true, net: "Institute/Arctic" },
        { name: "McMurdo Station (Antarctica)", shortName: "맥머도(남극)", lat: -77.846, lon: 166.668, curTemp: 0.2, depth: true, net: "Institute/Antarctic" },

        // 필리핀 추가
        { name: "Panglao Island (Bohol, Philippines)", shortName: "보홀 팡라오", lat: 9.583, lon: 123.75, curTemp: 28.7, depth: true, net: "Beach/PAGASA" },
        { name: "Moalboal (Cebu, Philippines)", shortName: "모알보알", lat: 9.947, lon: 123.397, curTemp: 28.5, depth: true, net: "Beach/PAGASA" },
        { name: "Coron (Palawan, Philippines)", shortName: "코론", lat: 12.0, lon: 120.2, curTemp: 28.3, depth: true, net: "Beach/PAGASA" },
        { name: "Siargao Island (Philippines)", shortName: "시아르가오", lat: 9.858, lon: 126.05, curTemp: 28.6, depth: true, net: "Beach/PAGASA" },
        { name: "Anilao (Batangas, Philippines)", shortName: "아닐라오", lat: 13.75, lon: 120.9, curTemp: 28.0, depth: true, net: "Beach/PAGASA" }
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

