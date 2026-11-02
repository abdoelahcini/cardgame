// Room storage. Uses Upstash Redis (REST) when configured, otherwise an
// in-memory map so the game runs locally with no setup.
const TTL = 60 * 60 * 24; // rooms expire a day after their last change
const ONLINE_MS = 8000;   // a player who hasn't polled for this long is offline

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const keys = code => [`spark:${code}`, `spark:${code}:v`, `spark:${code}:seen`];

// Writes only if nobody else saved since we read version ARGV[1].
const CAS = `
if (redis.call('GET', KEYS[2]) or '0') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])
return 1`;

// Marks the caller as seen and returns {version, state-if-changed, seen hash}.
const POLL = `
local v = redis.call('GET', KEYS[2])
if not v then return {'0', '', {}} end
redis.call('HSET', KEYS[3], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[3], ARGV[4])
local data = ''
if v ~= ARGV[3] then data = redis.call('GET', KEYS[1]) end
return {v, data, redis.call('HGETALL', KEYS[3])}`;

async function redis(...args) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Redis: ${json.error}`);
  return json.result;
}

const upstash = {
  async load(code) {
    const [k, vk] = keys(code);
    const [data, v] = await redis('MGET', k, vk);
    return data ? { data: JSON.parse(data), v: Number(v) } : null;
  },
  async save(code, prevV, data) {
    const k = keys(code);
    const ok = await redis('EVAL', CAS, 3, ...k, String(prevV), JSON.stringify(data), String(prevV + 1), String(TTL));
    return ok === 1;
  },
  async poll(code, pid, sinceV) {
    const [v, data, seenFlat] = await redis('EVAL', POLL, 3, ...keys(code), pid, String(Date.now()), String(sinceV), String(TTL));
    if (v === '0') return null;
    const seen = {};
    for (let i = 0; i < seenFlat.length; i += 2) seen[seenFlat[i]] = Number(seenFlat[i + 1]);
    return { v: Number(v), data: data ? JSON.parse(data) : null, seen };
  },
  async seen(code) {
    const flat = await redis('HGETALL', keys(code)[2]);
    const seen = {};
    for (let i = 0; i < flat.length; i += 2) seen[flat[i]] = Number(flat[i + 1]);
    return seen;
  },
};

const rooms = new Map(); // code -> { json, v, seen }
const memory = {
  async load(code) {
    const r = rooms.get(code);
    return r ? { data: JSON.parse(r.json), v: r.v } : null;
  },
  async save(code, prevV, data) {
    const r = rooms.get(code);
    if ((r ? r.v : 0) !== prevV) return false;
    rooms.set(code, { json: JSON.stringify(data), v: prevV + 1, seen: r ? r.seen : {} });
    return true;
  },
  async poll(code, pid, sinceV) {
    const r = rooms.get(code);
    if (!r) return null;
    r.seen[pid] = Date.now();
    return { v: r.v, data: r.v !== sinceV ? JSON.parse(r.json) : null, seen: { ...r.seen } };
  },
  async seen(code) {
    const r = rooms.get(code);
    return r ? { ...r.seen } : {};
  },
};

const store = URL && TOKEN ? upstash : memory;
store.kind = URL && TOKEN ? 'upstash' : 'memory';
store.ONLINE_MS = ONLINE_MS;
module.exports = store;
