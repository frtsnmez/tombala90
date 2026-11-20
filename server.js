const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'kasimtombala' }));

const rooms = new Map();
const MAX_PLAYERS = 100;
const AUTO_INTERVAL_MS = 5000;
const sessionToken = () => crypto.randomBytes(32).toString('hex');

function roomCode() {
  let code;
  do { code = String(100000 + Math.floor(Math.random() * 900000)); } while (rooms.has(code));
  return code;
}
function shuffled(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}
function makeCard() {
  // Standard 3x9 ticket: 5 numbers per row, 15 total, each column populated.
  let positions;
  for (let tries = 0; tries < 5000; tries++) {
    const rows = [[], [], []];
    const counts = Array(9).fill(0);
    for (let r = 0; r < 3; r++) {
      const cols = shuffled([...Array(9).keys()]).slice(0, 5);
      rows[r] = cols;
      cols.forEach(c => counts[c]++);
    }
    if (counts.every(c => c >= 1 && c <= 3)) { positions = rows; break; }
  }
  if (!positions) throw new Error('Card generation failed');
  const card = Array.from({ length: 3 }, () => Array(9).fill(null));
  for (let c = 0; c < 9; c++) {
    const rowIndexes = [0, 1, 2].filter(r => positions[r].includes(c));
    const min = c === 0 ? 1 : c * 10;
    const max = c === 8 ? 90 : c * 10 + 9;
    const nums = shuffled(Array.from({ length: max - min + 1 }, (_, i) => min + i)).slice(0, rowIndexes.length).sort((a,b)=>a-b);
    rowIndexes.forEach((r, i) => { card[r][c] = nums[i]; });
  }
  return card;
}
function publicRoom(room) {
  return {
    code: room.code, status: room.status, mode: room.mode,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, isHost: p.id === room.hostId })),
    pending: [...room.pending.values()].map(p => ({ id: p.id, name: p.name })),
    drawn: room.drawn, last: room.drawn.at(-1) ?? null, winners: room.winners
  };
}
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function stopAuto(room) { if (room.timer) clearInterval(room.timer); room.timer = null; }
function drawNumber(room) {
  if (room.status !== 'playing' || room.drawn.length >= 90) return null;
  const remaining = Array.from({ length: 90 }, (_, i) => i + 1).filter(n => !room.drawn.includes(n));
  const n = remaining[crypto.randomInt(remaining.length)];
  room.drawn.push(n);
  io.to(room.code).emit('game:number', { number: n, count: room.drawn.length, drawn: room.drawn });
  if (room.drawn.length === 90) { room.status = 'finished'; stopAuto(room); io.to(room.code).emit('game:finished'); }
  emitRoom(room);
  return n;
}
function winnerRows(card, drawn) {
  const set = new Set(drawn);
  return card.map(row => row.filter(Boolean).every(n => set.has(n)));
}

io.on('connection', socket => {
  console.log('[socket] connected', socket.id);
  socket.on('room:resume', ({ code, token } = {}, cb = () => {}) => {
    const room = rooms.get(String(code || '').trim());
    if (!room || typeof token !== 'string') return cb({ ok: false, error: 'Oturum bulunamadı. Sunucu yeniden başlamış olabilir.' });
    const entry = [...room.players.entries()].find(([, p]) => p.token === token) ||
                  [...room.pending.entries()].find(([, p]) => p.token === token);
    if (!entry) return cb({ ok: false, error: 'Oturum bulunamadı.' });
    const [oldId, player] = entry;
    const approved = room.players.has(oldId);
    if (oldId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldId);
      if (oldSocket) { oldSocket.leave(room.code); oldSocket.disconnect(true); }
      (approved ? room.players : room.pending).delete(oldId);
      player.id = socket.id;
      (approved ? room.players : room.pending).set(socket.id, player);
      if (room.hostId === oldId) room.hostId = socket.id;
      for (const kind of ['first', 'second', 'tombala']) {
        if (room.claims.delete(`${oldId}:${kind}`)) room.claims.add(`${socket.id}:${kind}`);
      }
      for (const w of room.winners) if (w.playerId === oldId) w.playerId = socket.id;
    }
    socket.join(room.code);
    console.log('[socket] resumed', room.code, socket.id, approved ? 'approved' : 'pending');
    cb({ ok: true, code: room.code, token, pending: !approved, card: player.card,
         isHost: room.hostId === socket.id, room: publicRoom(room) });
    emitRoom(room);
  });
  socket.on('room:create', ({ name }, cb = () => {}) => {
    const code = roomCode();
    const room = { code, hostId: socket.id, players: new Map(), pending: new Map(), drawn: [], status: 'lobby', mode: 'manual', timer: null, claims: new Set(), winners: [] };
    const player = { id: socket.id, name: String(name || 'Yönetici').slice(0, 24), card: makeCard(), token: sessionToken() };
    room.players.set(socket.id, player); rooms.set(code, room); socket.join(code);
    cb({ ok: true, code, card: player.card, token: player.token, isHost: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on('room:join', ({ code, name }, cb = () => {}) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) return cb({ ok: false, error: 'Oda bulunamadı.' });
    if (room.status !== 'lobby') return cb({ ok: false, error: 'Oyun başlamış; yeni oyuncu alınmıyor.' });
    if (room.players.size + room.pending.size >= MAX_PLAYERS) return cb({ ok: false, error: 'Oda 100 oyuncu kapasitesine ulaştı.' });
    const player = { id: socket.id, name: String(name || 'Oyuncu').slice(0, 24), card: null, token: sessionToken() };
    room.pending.set(socket.id, player); socket.join(room.code);
    cb({ ok: true, pending: true, code: room.code, token: player.token, message: 'Yönetici onayı bekleniyor.' });
    io.to(room.hostId).emit('room:request', { id: socket.id, name: player.name });
    emitRoom(room);
  });

  socket.on('room:approve', ({ playerId, approve }, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.hostId === socket.id);
    if (!room) return cb({ ok: false, error: 'Yalnızca yönetici onay verebilir.' });
    const p = room.pending.get(playerId);
    if (!p) return cb({ ok: false, error: 'Katılım isteği bulunamadı.' });
    room.pending.delete(playerId);
    if (approve) {
      p.card = makeCard(); room.players.set(playerId, p);
      io.to(playerId).emit('room:approved', { code: room.code, card: p.card, room: publicRoom(room) });
    } else {
      io.to(playerId).emit('room:rejected');
      io.sockets.sockets.get(playerId)?.leave(room.code);
    }
    cb({ ok: true }); emitRoom(room);
  });

  socket.on('game:start', ({ mode }, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.hostId === socket.id);
    if (!room) return cb({ ok: false, error: 'Yalnızca yönetici başlatabilir.' });
    if (room.players.size < 1) return cb({ ok: false, error: 'Oyuncu bulunamadı.' });
    room.status = 'playing'; room.mode = mode === 'auto' ? 'auto' : 'manual';
    io.to(room.code).emit('game:started', { mode: room.mode });
    if (room.mode === 'auto') room.timer = setInterval(() => drawNumber(room), AUTO_INTERVAL_MS);
    emitRoom(room); cb({ ok: true });
  });

  socket.on('game:draw', cb => {
    const room = [...rooms.values()].find(r => r.hostId === socket.id);
    if (!room) return cb?.({ ok: false, error: 'Numarayı yalnızca yönetici çekebilir.' });
    const number = drawNumber(room); cb?.({ ok: !!number, number });
  });

  socket.on('game:claim', ({ kind }, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.players.has(socket.id));
    if (!room || room.status !== 'playing') return cb({ ok: false, error: 'Aktif oyun bulunamadı.' });
    const p = room.players.get(socket.id);
    const rows = winnerRows(p.card, room.drawn);
    const completed = rows.filter(Boolean).length;
    const valid = kind === 'tombala' ? completed === 3 : kind === 'second' ? completed >= 2 : completed >= 1;
    if (!valid) return cb({ ok: false, error: 'Henüz kazanma koşulu tamamlanmadı.' });
    const key = `${socket.id}:${kind}`;
    if (room.claims.has(key)) return cb({ ok: true, duplicate: true });
    room.claims.add(key);
    const label = kind === 'tombala' ? 'TOMBALA' : kind === 'second' ? 'İKİNCİ ÇİNKO' : 'BİRİNCİ ÇİNKO';
    const winner = { playerId: socket.id, player: p.name, kind, label, numberCount: room.drawn.length, at: new Date().toISOString() };
    room.winners.push(winner);
    io.to(room.code).emit('game:winner', { winner, winners: room.winners });
    emitRoom(room);
    cb({ ok: true, label });
  });

  socket.on('game:reset', cb => {
    const room = [...rooms.values()].find(r => r.hostId === socket.id);
    if (!room) return cb?.({ ok: false, error: 'Yalnızca yönetici sıfırlayabilir.' });
    stopAuto(room); room.drawn = []; room.claims.clear(); room.winners = []; room.status = 'lobby'; room.mode = 'manual';
    for (const p of room.players.values()) {
      p.card = makeCard();
      io.to(p.id).emit('game:card', { card: p.card });
    }
    io.to(room.code).emit('game:reset'); emitRoom(room); cb?.({ ok: true });
  });

  socket.on('disconnect', reason => {
    console.log('[socket] disconnected', socket.id, reason);
    // Keep approved players, pending requests, and the host's room in memory.
    // The client can reconnect with its secret session token.
    for (const room of rooms.values()) {
      if (room.players.has(socket.id) || room.pending.has(socket.id)) {
        console.log('[room] offline', room.code, socket.id);
      }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`KasımTombala running on ${port}`));
