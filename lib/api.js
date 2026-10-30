// Request handlers shared by the Vercel functions (api/) and the local server.
const { Room, GameError } = require('../game');
const store = require('./store');

const hydrate = data => Object.assign(Object.create(Room.prototype), data);

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
}

// Load, change and save a room, retrying if another player saved first.
async function update(code, change) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const found = await store.load(code);
    if (!found) throw new GameError('Room not found');
    const room = hydrate(found.data);
    change(room);
    if (await store.save(code, found.v, room)) return { room, v: found.v + 1 };
  }
  throw new GameError('Busy — try again');
}

async function action(body) {
  const pid = String(body.pid || '').slice(0, 64);
  if (!pid) throw new GameError('Missing player id');
  const name = String(body.name || '').trim().slice(0, 16) || 'Player';

  if (body.type === 'create') {
    for (let attempt = 0; attempt < 10; attempt++) {
      const room = new Room(newCode());
      room.addPlayer(pid, name);
      if (await store.save(room.code, 0, room)) return { state: room.viewFor(pid), v: 1 };
    }
    throw new GameError('Could not create a room — try again');
  }

  const code = String(body.code || '').toUpperCase().trim();
  const { room, v } = await update(code, room => {
    switch (body.type) {
      case 'join': room.addPlayer(pid, name); break;
      case 'start': room.start(pid); break;
      case 'play': room.play(pid, Number(body.cardId), body.color); break;
      case 'gift': room.gift(pid, Number(body.cardId)); break;
      case 'draw': room.draw(pid); break;
      case 'pass': room.pass(pid); break;
      case 'last': room.sayLast(pid); break;
      case 'catch': room.catchPlayer(pid, String(body.target)); break;
      case 'leave': room.disconnect(pid); break;
      default: throw new GameError('Unknown action');
    }
  });
  return body.type === 'leave' ? { left: true } : { state: room.viewFor(pid), v };
}

async function poll(query) {
  const code = String(query.code || '').toUpperCase().trim();
  const pid = String(query.pid || '').slice(0, 64);
  const r = await store.poll(code, pid, Number(query.v) || 0);
  if (!r) throw new GameError('Room not found');
  const now = Date.now();
  const online = Object.keys(r.seen).filter(id => now - r.seen[id] < store.ONLINE_MS);
  return { v: r.v, online, state: r.data ? hydrate(r.data).viewFor(pid) : undefined };
}

// Wraps a handler into a { status, body } result with friendly errors.
async function run(fn, input) {
  try {
    return { status: 200, body: await fn(input) };
  } catch (e) {
    if (e instanceof GameError) return { status: e.message === 'Room not found' ? 404 : 400, body: { error: e.message } };
    console.error(e);
    return { status: 500, body: { error: 'Something went wrong' } };
  }
}

module.exports = { action, poll, run };
