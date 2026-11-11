// Two-player co-op relay. A host opens a room and gets a 4-letter code; a guest joins with it.
// The server only passes messages between the two: the host's game decides everything.
import { WebSocketServer } from 'ws';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: easy to read aloud and type
const MAX_MSG = 64 * 1024;
const MAX_ROOMS = 200;
const ROOM_IDLE_MS = 30 * 60000;
const MSGS_PER_SEC = 60;

/** @type {Map<string, {host?: import('ws').WebSocket, guest?: import('ws').WebSocket, at: number}>} */
const rooms = new Map();

export function newCode(taken = rooms) {
  for (let i = 0; i < 100; i++) {
    let c = '';
    for (let j = 0; j < 4; j++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!taken.has(c)) return c;
  }
  return null;
}

function json(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

export function attachRelay(server, allowedOrigin) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/relay' || !allowedOrigin(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => join(ws, url.searchParams));
  });

  // Drop dead connections and long-idle rooms.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.alive === false) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
    const now = Date.now();
    for (const [code, room] of rooms) if (now - room.at > ROOM_IDLE_MS || (!room.host && !room.guest)) rooms.delete(code);
  }, 20000).unref();
}

function join(ws, params) {
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  const role = params.get('role');
  let code;
  let room;
  if (role === 'host') {
    if (rooms.size >= MAX_ROOMS) {
      json(ws, { t: 'error', reason: 'busy' });
      return ws.close();
    }
    code = newCode();
    if (!code) return ws.close();
    room = { host: ws, at: Date.now() };
    rooms.set(code, room);
    json(ws, { t: 'room', code });
  } else if (role === 'guest') {
    code = String(params.get('code') ?? '').toUpperCase().slice(0, 4);
    room = rooms.get(code);
    if (!room?.host || room.guest) {
      json(ws, { t: 'error', reason: room?.guest ? 'full' : 'no-room' });
      return ws.close();
    }
    room.guest = ws;
    room.at = Date.now();
    json(ws, { t: 'joined', code });
    json(room.host, { t: 'peer', joined: true });
  } else return ws.close();

  const me = role;
  let budget = MSGS_PER_SEC;
  const refill = setInterval(() => (budget = MSGS_PER_SEC), 1000);
  ws.on('message', (data, isBinary) => {
    if (isBinary || --budget < 0) return; // text only, and no floods
    room.at = Date.now();
    const other = me === 'host' ? room.guest : room.host;
    if (other && other.readyState === 1) other.send(data.toString());
  });
  ws.on('close', () => {
    clearInterval(refill);
    if (me === 'host') {
      json(room.guest, { t: 'peer', joined: false, host: true });
      room.guest?.close();
      rooms.delete(code);
    } else {
      room.guest = undefined;
      json(room.host, { t: 'peer', joined: false });
    }
  });
}
