const { Redis } = require("@upstash/redis");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const BOT_STATE_PREFIX = "meetinghub:botstate:";
const BOT_STATE_TTL_SECONDS = 3600; // stale flows auto-expire after 1 hour

async function getBotState(chatId) {
  return redis.get(`${BOT_STATE_PREFIX}${chatId}`);
}

async function setBotState(chatId, state) {
  await redis.set(`${BOT_STATE_PREFIX}${chatId}`, state, { ex: BOT_STATE_TTL_SECONDS });
}

async function clearBotState(chatId) {
  await redis.del(`${BOT_STATE_PREFIX}${chatId}`);
}

module.exports = { getBotState, setBotState, clearBotState };
