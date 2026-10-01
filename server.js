'use strict';
/*
 * Camel & Coin — HTTP + realtime server.
 *
 *   npm install && npm start      ->  http://localhost:3000
 *
 * The server is authoritative: clients send actions, never state. Every
 * outbound payload goes through engine.serializeFor / engine.redactEvents so
 * hidden information (the opponent's hand, the deck order, undrawn bonus
 * token values) never leaves this process.
 */

const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { RoomManager } = require('./src/rooms');
const { createSession } = require('./src/session');
const R = require('./src/rules');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = new RoomManager(io);

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use(express.json());

// The page may be served from somewhere else entirely (a static host) while the
// rooms live here, so the small JSON endpoints have to be readable cross-origin.
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

app.get('/api/net', (_req, res) => {
  const lan = lanAddress();
  res.json({
    lanUrl: lan ? `http://${lan}:${PORT}` : null,
    localUrl: `http://localhost:${PORT}`,
    note: lan
      ? 'Anyone on this Wi-Fi can use the LAN link. For players on another network, expose this port with a tunnel (see README).'
      : 'No LAN address found — only this machine can reach the server.',
  });
});

app.get('/api/room/:code', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ ok: false, error: 'No such room.' });
  res.json({ ok: true, ...room.lobbyView(), open: !room.isFull() });
});

app.get('/api/rules', (_req, res) => {
  res.json({
    goods: R.GOODS,
    deck: R.DECK_COUNTS,
    goodsTokens: R.GOODS_TOKENS,
    bonusTokens: R.BONUS_TOKENS,
    minSell: R.MIN_SELL,
    handLimit: R.HAND_LIMIT,
    marketSize: R.MARKET_SIZE,
    camelToken: R.CAMEL_TOKEN_VALUE,
    sealsToWin: R.SEALS_TO_WIN,
  });
});

/* --------------------------------------------------------------- realtime */
// The protocol itself lives in src/session.js so the browser can run the exact
// same handlers against a local transport when you play a bot offline.
io.on('connection', (socket) => {
  socket.data = socket.data || {};
  const handlers = createSession(rooms, io, socket);
  for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn);
});

server.listen(PORT, HOST, () => {
  const lan = lanAddress();
  console.log('\n  ╔══════════════════════════════════════════════╗');
  console.log('  ║   CAMEL & COIN  ·  two-player trading game    ║');
  console.log('  ╚══════════════════════════════════════════════╝\n');
  console.log(`   this machine :  http://localhost:${PORT}`);
  if (lan) console.log(`   same Wi-Fi   :  http://${lan}:${PORT}   <- share this to invite`);
  else console.log('   same Wi-Fi   :  (no LAN address detected)');
  console.log('   elsewhere    :  needs a tunnel, e.g.  npx cloudflared tunnel --url http://localhost:' + PORT);
  console.log('');
});
