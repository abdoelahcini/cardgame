const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room, GameError } = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const rooms = new Map();
const sockets = new Map(); // ws -> { pid, code }

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  while (rooms.has(code));
  return code;
}

function broadcast(room) {
  for (const [ws, s] of sockets) {
    if (s.code === room.code && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'state', state: room.viewFor(s.pid) }));
    }
  }
}

function handle(ws, msg) {
  const s = sockets.get(ws);
  const name = String(msg.name || '').trim().slice(0, 16) || 'Player';

  if (msg.type === 'create' || msg.type === 'join') {
    const pid = String(msg.pid || '').slice(0, 64);
    if (!pid) throw new GameError('Missing player id');
    let room;
    if (msg.type === 'create') {
      room = new Room(newCode());
      rooms.set(room.code, room);
    } else {
      room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) throw new GameError('Room not found');
    }
    room.addPlayer(pid, name);
    s.pid = pid;
    s.code = room.code;
    room.lastActive = Date.now();
    broadcast(room);
    return;
  }

  const room = rooms.get(s.code);
  if (!room) throw new GameError('Join a room first');
  room.lastActive = Date.now();
  switch (msg.type) {
    case 'start': room.start(s.pid); break;
    case 'play': room.play(s.pid, Number(msg.cardId), msg.color); break;
    case 'gift': room.gift(s.pid, Number(msg.cardId)); break;
    case 'draw': room.draw(s.pid); break;
    case 'pass': room.pass(s.pid); break;
    case 'last': room.sayLast(s.pid); break;
    case 'catch': room.catchPlayer(s.pid, String(msg.target)); break;
    case 'leave':
      room.disconnect(s.pid);
      s.code = null;
      ws.send(JSON.stringify({ type: 'left' }));
      break;
    default: throw new GameError('Unknown action');
  }
  broadcast(room);
}

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  sockets.set(ws, { pid: null, code: null });
  ws.on('message', raw => {
    try {
      handle(ws, JSON.parse(raw));
    } catch (e) {
      const message = e instanceof GameError ? e.message : 'Something went wrong';
      if (!(e instanceof GameError)) console.error(e);
      ws.send(JSON.stringify({ type: 'error', message }));
    }
  });
  ws.on('close', () => {
    const s = sockets.get(ws);
    sockets.delete(ws);
    const room = s && rooms.get(s.code);
    if (!room) return;
    // Only mark gone if this player has no other open socket.
    const stillHere = [...sockets.values()].some(o => o.pid === s.pid && o.code === s.code);
    if (!stillHere) { room.disconnect(s.pid); broadcast(room); }
  });
});

// Drop rooms idle for over an hour.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    const inUse = [...sockets.values()].some(s => s.code === code);
    if (!inUse && room.lastActive < cutoff) rooms.delete(code);
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => console.log(`Spark running at http://localhost:${PORT}`));
