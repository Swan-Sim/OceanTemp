// [ADD] 접속 통계용 Upstash Redis 연결 도우미 (REST API, 추가 패키지 불필요).
// Vercel → Storage에서 Upstash Redis를 연결하면 환경변수가 자동으로 들어옵니다.
// (연결 방식에 따라 이름이 KV_REST_API_* 또는 UPSTASH_REDIS_REST_* 라서 둘 다 지원)
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redisPipeline(commands) {
  if (!URL_ || !TOKEN) throw new Error('Redis 환경변수가 없어요 (Vercel Storage에서 Upstash Redis 연결 필요)');
  const r = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error('Redis HTTP ' + r.status);
  return r.json(); // [{ result }, ...]
}

module.exports = { redisPipeline };
