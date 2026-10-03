// [ADD] 검색봇·기타 봇 구분 (접속 통계를 사람/봇으로 나눠 세려고).
//  botInfo(userAgent) → null(사람) 또는 { name: '구글', cat: 's'(검색봇) | 'o'(기타 봇: 미리보기·AI·SEO·스크립트) }
//  searchEngine(referer) → 'google' | 'naver' | ... | '' (검색 결과를 눌러 들어온 사람)
const LIST = [
  // 검색엔진 (cat s)
  ['구글', 's', /googlebot|google-inspectiontool|googleother|storebot-google|adsbot-google|mediapartners-google|apis-google|google-site-verification|google-extended/i],
  ['빙', 's', /bingbot|bingpreview|msnbot|adidxbot/i],
  ['네이버', 's', /yeti\/|naverbot|naver\.me\/spd/i],
  ['다음', 's', /daumoa|daum\//i],
  ['애플', 's', /applebot/i],
  ['야후', 's', /slurp/i],
  ['덕덕고', 's', /duckduckbot|duckassistbot/i],
  ['얀덱스', 's', /yandex/i],
  ['바이두', 's', /baiduspider/i],
  ['Seznam', 's', /seznambot/i],
  ['Qwant', 's', /qwant/i],
  ['Ecosia', 's', /ecosia/i],
  ['Petal(화웨이)', 's', /petalbot/i],
  ['Sogou', 's', /sogou/i],
  // 링크 미리보기
  ['카카오 미리보기', 'o', /kakaotalk-scrap|kakaostory-og-reader/i],
  ['페이스북 미리보기', 'o', /facebookexternalhit|facebookcatalog|meta-externalagent|meta-externalfetcher/i],
  ['X 미리보기', 'o', /twitterbot/i],
  ['슬랙 미리보기', 'o', /slackbot|slack-imgproxy/i],
  ['디스코드 미리보기', 'o', /discordbot/i],
  ['텔레그램 미리보기', 'o', /telegrambot/i],
  ['왓츠앱 미리보기', 'o', /^whatsapp\//i],
  ['라인 미리보기', 'o', /linespider/i],
  ['링크드인 미리보기', 'o', /linkedinbot/i],
  ['핀터레스트', 'o', /pinterestbot/i],
  // AI
  ['OpenAI', 'o', /gptbot|chatgpt-user|oai-searchbot/i],
  ['Claude', 'o', /claudebot|claude-user|claude-searchbot|anthropic-ai/i],
  ['Perplexity', 'o', /perplexity/i],
  ['Bytespider', 'o', /bytespider|tiktokspider/i],
  ['Amazon', 'o', /amazonbot/i],
  ['CommonCrawl', 'o', /ccbot/i],
  // SEO·점검 도구
  ['Ahrefs', 'o', /ahrefs/i],
  ['Semrush', 'o', /semrush/i],
  ['Majestic', 'o', /mj12bot/i],
  ['Moz', 'o', /dotbot|rogerbot/i],
  ['Lighthouse', 'o', /chrome-lighthouse|lighthouse|pagespeed|gtmetrix/i],
  ['Vercel', 'o', /vercel/i],
  ['헤드리스 브라우저', 'o', /headlesschrome|phantomjs|puppeteer|playwright|selenium/i],
  ['스크립트', 'o', /curl\/|wget|python-|python\/|node-fetch|undici|axios|go-http-client|okhttp|java\/|libwww|httpclient|scrapy|ruby/i],
  ['기타 봇', 'o', /bot\b|bot\/|crawl|spider|scrap|preview|fetcher|monitor|uptime|checker|validator/i]
];

function botInfo(ua) {
  ua = String(ua || '');
  if (!ua.trim()) return { name: 'UA 없음', cat: 'o' };
  for (const [name, cat, re] of LIST) if (re.test(ua)) return { name, cat };
  return null;
}

function searchEngine(ref) {
  ref = String(ref || '').toLowerCase();
  if (!ref) return '';
  const m = ref.match(/^https?:\/\/([^/]+)/); if (!m) return '';
  const h = m[1];
  if (/(^|\.)google\./.test(h)) return 'google';
  if (/(^|\.)naver\.com$/.test(h)) return 'naver';
  if (/(^|\.)daum\.net$/.test(h)) return 'daum';
  if (/(^|\.)bing\.com$/.test(h)) return 'bing';
  if (/(^|\.)yahoo\./.test(h)) return 'yahoo';
  if (/duckduckgo\.com$/.test(h)) return 'duckduckgo';
  if (/(^|\.)yandex\./.test(h)) return 'yandex';
  if (/(^|\.)baidu\.com$/.test(h)) return 'baidu';
  if (/(^|\.)ecosia\.org$/.test(h)) return 'ecosia';
  if (/chatgpt\.com$|openai\.com$/.test(h)) return 'chatgpt';
  if (/perplexity\.ai$/.test(h)) return 'perplexity';
  return '';
}

module.exports = { botInfo, searchEngine };
