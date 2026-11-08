// Stick Empire oda sunucusu.  Kurulum: npm install  ->  node server.js
const { WebSocketServer } = require('ws');
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 8080;
// Aynı sunucu hem oyunu (index.html) hem WebSocket'i (/ws) sunar. Render'da tek servis yeter.
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.end('ok'); return; }
  fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
    if (e) { res.writeHead(404); res.end('index.html bulunamadi'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(d);
  });
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const rooms = new Map();   // kod -> { a: host, b: guest }
const names = new Map();   // küçük harf ad -> ws
const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => A[Math.random() * A.length | 0]).join(''); } while (rooms.has(c)); return c; };
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const clean = s => String(s || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 14);
const peerOf = ws => { const r = rooms.get(ws.room); return r ? (r.a === ws ? r.b : r.a) : null; };
const RELAY = new Set(['act', 'snap', 'end', 'deny']);

function leaveRoom(ws) {
  const r = rooms.get(ws.room); if (!r) return;
  const o = r.a === ws ? r.b : r.a;
  rooms.delete(ws.room); ws.room = null;
  if (o) { o.room = null; send(o, { t: 'left' }); }
}

wss.on('connection', ws => {
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'hello') {
      const n = clean(m.name); if (!n) return;
      if (ws.name) names.delete(ws.name.toLowerCase());
      ws.name = n; names.set(n.toLowerCase(), ws);
    } else if (m.t === 'who') {
      const list = (Array.isArray(m.names) ? m.names : []).slice(0, 50).map(clean).filter(n => names.has(n.toLowerCase()));
      send(ws, { t: 'online', names: list });
    } else if (m.t === 'invite') {
      const to = names.get(clean(m.to).toLowerCase());
      if (to && ws.name && rooms.has(String(m.code))) send(to, { t: 'invite', from: ws.name, code: String(m.code) });
    } else if (m.t === 'create') {
      leaveRoom(ws);
      const c = newCode(); rooms.set(c, { a: ws, b: null }); ws.room = c;
      send(ws, { t: 'created', code: c });
    } else if (m.t === 'join') {
      const c = String(m.code || '').toUpperCase(), r = rooms.get(c);
      if (!r) return send(ws, { t: 'error', msg: 'Oda bulunamadı.' });
      if (r.b || r.a === ws) return send(ws, { t: 'error', msg: 'Oda dolu.' });
      r.b = ws; ws.room = c;
      send(r.a, { t: 'start', role: 'host' }); send(r.b, { t: 'start', role: 'guest' });
    } else if (m.t === 'leave') {
      leaveRoom(ws);
    } else if (m.t === 'chat') {
      const o = peerOf(ws); const text = String(m.text || '').slice(0, 60);
      if (o && text) send(o, { t: 'chat', name: ws.name || '?', text });
    } else if (RELAY.has(m.t)) {
      const o = peerOf(ws); if (o) send(o, m);
    }
  });
  ws.on('close', () => {
    if (ws.name && names.get(ws.name.toLowerCase()) === ws) names.delete(ws.name.toLowerCase());
    leaveRoom(ws);
  });
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);
server.listen(PORT, () => console.log('Sunucu çalışıyor: http://localhost:' + PORT));