// サーバー起動：HTTP（ビルド済みクライアントの配信）＋ WebSocket（/ws）。
//   npm run server        … ポート 8787（PORT で変更）
//   LAG_MS=200 npm run server … 往復200msの遅延を注入（ラグ補償の確認用）
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { NET, type ClientMsg, type ServerMsg } from '../shared/net/protocol';
import { Matchmaker } from './matchmaking/Matchmaker';
import { MmrStore } from './matchmaking/mmr';
import type { Conn } from './rooms/GameRoom';

const PORT = Number(process.env.PORT ?? 8787);
const LAG_MS = Number(process.env.LAG_MS ?? 0); // 往復の注入遅延
const DIST = resolve(process.env.DIST ?? 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const http = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: mm.rooms.size, queue: mm.queue.length }));
    return;
  }
  let file = normalize(join(DIST, url === '/' ? 'index.html' : url));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('client not built (run `npm run build`)');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const mm = new Matchmaker(new MmrStore(process.env.MMR_FILE ?? 'server/data/mmr.json'));
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });
let connSeq = 1;

wss.on('connection', (ws: WebSocket) => {
  const id = `c${connSeq++}`;
  let token = '';
  let lastPingAt = 0;
  const conn: Conn = {
    id,
    send(msg: ServerMsg) {
      const data = JSON.stringify(msg);
      const out = () => ws.readyState === ws.OPEN && ws.send(data);
      if (LAG_MS) setTimeout(out, LAG_MS / 2);
      else out();
    },
    close() {
      ws.close();
    },
  };
  // RTT はサーバー側で WebSocket の ping/pong から測る（クライアントの自己申告は使わない）
  const pinger = setInterval(() => {
    lastPingAt = Date.now();
    ws.ping();
  }, 1000);
  ws.on('pong', () => {
    if (token) mm.roomOf(token)?.onPing(token, Date.now() - lastPingAt + LAG_MS);
  });

  const handle = (raw: string) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    switch (msg.k) {
      case 'hello':
        token = String(msg.token || id).slice(0, 64);
        mm.hello(conn, { ...msg, token });
        break;
      case 'input':
        if (token) mm.roomOf(token)?.onInput(token, msg.cmd);
        break;
      case 'ping':
        conn.send({ k: 'pong', t: msg.t, st: Date.now() });
        break;
      case 'start':
        if (token) mm.startPrivateBy(token);
        break;
      case 'leave':
        if (token) mm.leave(token, conn);
        break;
    }
  };
  ws.on('message', (data) => {
    const raw = data.toString();
    if (LAG_MS) setTimeout(() => handle(raw), LAG_MS / 2);
    else handle(raw);
  });
  ws.on('close', () => {
    clearInterval(pinger);
    if (token) mm.leave(token, conn);
  });
});

// 30Hz 固定 tick（ずれを溜めない）
const TICK_MS = 1000 / NET.tickHz;
let next = performance.now();
function loop() {
  const now = performance.now();
  let n = 0;
  while (now >= next && n < 5) {
    mm.tickRooms();
    next += TICK_MS;
    n++;
  }
  if (n >= 5) next = now + TICK_MS;
  setTimeout(loop, Math.max(0, next - performance.now()));
}
loop();
setInterval(() => mm.update(), 1000);

http.listen(PORT, () => {
  console.log(`[otogi-arena] server on :${PORT}  (ws path /ws, tick ${NET.tickHz}Hz${LAG_MS ? `, injected lag ${LAG_MS}ms` : ''})`);
});
