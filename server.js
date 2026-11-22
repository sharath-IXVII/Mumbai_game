// Static file server + WebSocket co-op relay (up to 4 players per room).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(PUB, path.normalize(p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> [{ws,id,name}]
let nextId = 1;

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

wss.on('connection', (ws) => {
  let room = null, me = null;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join') {
      const code = String(m.room || 'TAJ').toUpperCase().slice(0, 12);
      const list = rooms.get(code) || [];
      if (list.length >= 4) return send(ws, { t: 'full' });
      me = { ws, id: nextId++, name: String(m.name || 'Commando').slice(0, 16) };
      list.push(me); rooms.set(code, list); room = code;
      send(ws, { t: 'welcome', id: me.id, host: list[0] === me, slot: list.length - 1,
        peers: list.filter(p => p !== me).map(p => ({ id: p.id, name: p.name })) });
      list.forEach(p => p !== me && send(p.ws, { t: 'peerJoin', id: me.id, name: me.name }));
      return;
    }
    if (!room) return;
    m.from = me.id;
    const list = rooms.get(room) || [];
    const out = JSON.stringify(m);
    for (const p of list) {
      if (p === me) continue;
      if (m.to && m.to !== p.id) continue;
      if (p.ws.readyState === 1) p.ws.send(out);
    }
  });
  ws.on('close', () => {
    if (!room) return;
    const list = (rooms.get(room) || []).filter(p => p !== me);
    if (!list.length) return rooms.delete(room);
    rooms.set(room, list);
    list.forEach(p => send(p.ws, { t: 'peerLeave', id: me.id }));
    send(list[0].ws, { t: 'host' }); // promote oldest player to host
  });
});

server.listen(PORT, () => console.log(`Operation Black Tornado running: http://localhost:${PORT}`));
