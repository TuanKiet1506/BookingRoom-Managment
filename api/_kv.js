const { kv } = require("@vercel/kv");

const BOT_STATE_PREFIX = "meetinghub:botstate:";
// Stale flows auto-expire after 1 hour so PropertiesService never builds up.
const BOT_STATE_TTL_SECONDS = 3600;

async function getBotState(chatId) {
  return kv.get(`${BOT_STATE_PREFIX}${chatId}`);
}

async function setBotState(chatId, state) {
  await kv.set(`${BOT_STATE_PREFIX}${chatId}`, state, { ex: BOT_STATE_TTL_SECONDS });
}

async function clearBotState(chatId) {
  await kv.del(`${BOT_STATE_PREFIX}${chatId}`);
}

module.exports = { getBotState, setBotState, clearBotState };
