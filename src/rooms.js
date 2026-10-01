'use strict';
/*
 * Room manager. Owns every live match, drives bot turns, and is the only
 * thing that decides what each socket is allowed to see.
 */

const E = require('./engine');
const Bot = require('./bot');

const CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679'; // no O/0, I/1, S/5, B/8
const REJOIN_GRACE_MS = 120000;
const ROOM_IDLE_MS = 1000 * 60 * 90;

class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.createdAt = Date.now();
    this.touched = Date.now();
    this.difficulty = opts.difficulty || 'normal';
    this.seats = [null, null];       // { playerId, name, isBot, connected, sockets:Set }
    this.spectators = new Map();     // socketId -> { playerId, name }
    this.match = null;
    this.chat = [];
    this.botTimer = null;
    this.graceTimer = null;
    this.pendingEvents = [[], []];
    this.started = false;
  }

  seatOf(playerId) {
    return this.seats.findIndex((s) => s && s.playerId === playerId);
  }
  freeSeat() {
    return this.seats.findIndex((s) => s === null);
  }
  humanCount() {
    return this.seats.filter((s) => s && !s.isBot).length;
  }
  isFull() {
    return this.seats.every((s) => s !== null);
  }

  sit(seat, player) {
    this.seats[seat] = { sockets: new Set(), connected: true, isBot: false, ...player };
    this.touched = Date.now();
    return this.seats[seat];
  }

  addBot(seat, difficulty) {
    this.difficulty = difficulty || this.difficulty;
    this.seats[seat] = {
      playerId: `bot:${this.code}:${seat}`,
      name: botName(this.difficulty),
      isBot: true,
      connected: true,
      sockets: new Set(),
    };
  }

  lobbyView() {
    return {
      code: this.code,
      started: this.started,
      difficulty: this.difficulty,
      seats: this.seats.map((s) => s && ({
        name: s.name, isBot: s.isBot, connected: s.connected,
      })),
      spectators: [...this.spectators.values()].map((s) => s.name),
      chat: this.chat.slice(-40),
    };
  }
}

function botName(difficulty) {
  const pools = {
    easy: ['Bikaner Novice', 'Apprentice Anaya', 'Young Rafi'],
    normal: ['Merchant Devraj', 'Trader Meera', 'Zahir of Amber'],
    hard: ['Maharaja Vikram', 'Grand Vizier Noor', 'Seth Kapoor'],
  };
  const pool = pools[difficulty] || pools.normal;
  return pool[Math.floor(Math.random() * pool.length)];
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    const sweeper = setInterval(() => this.sweep(), 60000);
    if (typeof sweeper.unref === 'function') sweeper.unref();   // no-op in a browser
  }

  newCode() {
    for (let attempt = 0; attempt < 200; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return 'R' + Date.now().toString(36).toUpperCase().slice(-3);
  }

  create(opts) {
    const room = new Room(this.newCode(), opts);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase().trim());
  }

  sweep() {
    for (const [code, room] of this.rooms) {
      const idle = Date.now() - room.touched;
      const anyone = room.seats.some((s) => s && !s.isBot && s.connected) || room.spectators.size > 0;
      if (!anyone && idle > REJOIN_GRACE_MS * 2) { this.destroy(code); continue; }
      if (idle > ROOM_IDLE_MS) this.destroy(code);
    }
  }

  destroy(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    clearTimeout(room.botTimer);
    clearTimeout(room.graceTimer);
    this.io.to(code).emit('room:closed', { code });
    this.rooms.delete(code);
  }

  /* ------------------------------------------------------------ broadcast */
  emitLobby(room) {
    this.io.to(room.code).emit('room:lobby', room.lobbyView());
  }

  // Hand each recipient their own view plus their own redacted event stream.
  emitUpdate(room, events = [], meta = {}) {
    if (!room.match) return;
    const state = room.match.state;
    for (let seat = 0; seat < 2; seat++) {
      const s = room.seats[seat];
      if (!s || s.isBot) continue;
      const payload = {
        view: E.serializeFor(state, seat),
        events: E.redactEvents(events, seat),
        meta,
      };
      for (const sid of s.sockets) this.io.to(sid).emit('game:update', payload);
    }
    // Spectators get their own serialization: no hands, and no bonus token
    // values for either player.
    if (room.spectators.size) {
      const spec = {
        view: E.serializeFor(state, -1),
        events: E.redactEvents(events, -1),
        meta,
      };
      for (const sid of room.spectators.keys()) this.io.to(sid).emit('game:update', spec);
    }
  }

  /* ---------------------------------------------------------------- start */
  start(room) {
    if (room.isFull() === false) return { ok: false, error: 'Both seats must be filled.' };
    const names = room.seats.map((s) => s.name);
    const bots = room.seats.map((s) => s.isBot);
    room.match = E.createMatch({ id: room.code, names, bots });
    room.started = true;
    room.touched = Date.now();
    this.emitLobby(room);
    this.emitUpdate(room, room.match.events, { kind: 'round_start' });
    this.maybeBot(room);
    return { ok: true };
  }

  nextRound(room) {
    if (!room.match) return;
    const r = E.startNextRound(room.match.state);
    if (!r.ok) return;
    this.emitUpdate(room, r.events, { kind: 'round_start' });
    this.maybeBot(room);
  }

  rematch(room) {
    if (!room.match) return;
    const names = room.seats.map((s) => s.name);
    const bots = room.seats.map((s) => s.isBot);
    room.match = E.createMatch({ id: room.code, names, bots });
    this.emitUpdate(room, room.match.events, { kind: 'round_start', rematch: true });
    this.maybeBot(room);
  }

  /* --------------------------------------------------------------- action */
  act(room, playerId, action) {
    if (!room.match) return { ok: false, error: 'The game has not started.' };
    const seat = room.seatOf(playerId);
    if (seat < 0) return { ok: false, error: 'You are not seated in this room.' };
    const res = E.applyAction(room.match.state, seat, action);
    if (!res.ok) return res;
    room.touched = Date.now();
    this.emitUpdate(room, res.events, { kind: 'action', by: seat, action });
    this.maybeBot(room);
    return { ok: true };
  }

  // Give the bot a visible think time so its move reads as a decision.
  maybeBot(room) {
    clearTimeout(room.botTimer);
    const st = room.match && room.match.state;
    if (!st || st.matchOver) return;
    if (st.roundOver) {
      // Bot rooms roll straight into the next round after the scoreboard lands.
      if (room.seats.some((s) => s && s.isBot)) {
        room.botTimer = setTimeout(() => this.nextRound(room), 6500);
      }
      return;
    }
    const seat = st.turn;
    const s = room.seats[seat];
    if (!s || !s.isBot) return;

    const think = 700 + Math.floor(Math.random() * 900);
    room.botTimer = setTimeout(() => {
      if (!room.match || room.match.state !== st || st.roundOver || st.matchOver) return;
      const action = Bot.chooseAction(st, seat, room.difficulty);
      if (!action) return;
      const res = E.applyAction(st, seat, action);
      if (!res.ok) return;
      room.touched = Date.now();
      this.emitUpdate(room, res.events, {
        kind: 'action', by: seat, action, bot: true, say: Bot.chatter(action, st, seat),
      });
      this.maybeBot(room);
    }, think);
  }

  /* ---------------------------------------------------------- disconnects */
  markDisconnect(room, seat) {
    const s = room.seats[seat];
    if (!s || s.isBot) return;
    s.connected = false;
    clearTimeout(room.botTimer);
    this.io.to(room.code).emit('room:opponent', {
      seat, name: s.name, connected: false, graceMs: REJOIN_GRACE_MS,
    });
    this.emitLobby(room);
    clearTimeout(room.graceTimer);
    room.graceTimer = setTimeout(() => {
      const still = room.seats[seat];
      if (still && !still.connected && !still.isBot) {
        this.io.to(room.code).emit('room:stalled', { seat, name: still.name });
      }
    }, REJOIN_GRACE_MS);
  }

  markReconnect(room, seat) {
    const s = room.seats[seat];
    if (!s) return;
    s.connected = true;
    clearTimeout(room.graceTimer);
    this.io.to(room.code).emit('room:opponent', { seat, name: s.name, connected: true });
    this.emitLobby(room);
    this.maybeBot(room);
  }

  // Offered when an opponent has walked away: swap them for a bot and play on.
  substituteBot(room, seat, difficulty) {
    const old = room.seats[seat];
    if (!old || old.isBot) return { ok: false, error: 'That seat is already a bot.' };
    room.addBot(seat, difficulty || room.difficulty);
    if (room.match) room.match.state.players[seat].name = room.seats[seat].name;
    if (room.match) room.match.state.players[seat].isBot = true;
    this.io.to(room.code).emit('room:substituted', { seat, name: room.seats[seat].name });
    this.emitLobby(room);
    if (room.match) this.emitUpdate(room, [], { kind: 'substitute' });
    this.maybeBot(room);
    return { ok: true };
  }
}

module.exports = { RoomManager, Room, REJOIN_GRACE_MS };
