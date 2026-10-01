'use strict';
/*
 * The wire protocol, in one place.
 *
 * `createSession(rooms, io, socket)` returns a map of event name -> handler.
 * The real server binds them to a socket.io connection; the browser binds them
 * to a local in-page transport so a game against a bot needs no backend at all.
 *
 * `socket` only has to provide:
 *   id            a stable string
 *   data          a mutable bag the handlers reassign wholesale
 *   join(room)    / leave(room)
 * `io` only has to provide:
 *   to(target).emit(event, payload)
 */

const ack = (fn, payload) => { if (typeof fn === 'function') fn(payload); };

function createSession(rooms, io, socket) {
  // socket.data: { playerId, name, code, seat, spectator }

  // Shared by room:create, room:join, room:leave and disconnect, so it lives
  // alongside them rather than being passed around.
  const leaveCurrent = () => {
    const room = rooms.get(socket.data.code);
    if (!room) return;
    socket.leave(room.code);
    room.spectators.delete(socket.id);
    const seat = socket.data.seat;
    if (seat !== undefined && seat >= 0 && room.seats[seat]) {
      room.seats[seat].sockets.delete(socket.id);
      if (room.seats[seat].sockets.size === 0) rooms.markDisconnect(room, seat);
    }
    rooms.emitLobby(room);
    socket.data.code = undefined;
    socket.data.seat = undefined;
  };

  return {
    'room:create': (payload = {}, cb) => {
      const { name = 'Trader', vsBot = false, difficulty = 'normal', playerId } = payload;
      if (!playerId) return ack(cb, { ok: false, error: 'Missing player id.' });
      leaveCurrent();

      const room = rooms.create({ difficulty });
      const seat = 0;
      const s = room.sit(seat, { playerId, name: String(name).slice(0, 18) || 'Trader' });
      s.sockets.add(socket.id);
      socket.data = { playerId, name: s.name, code: room.code, seat };
      socket.join(room.code);

      if (vsBot) {
        room.addBot(1, difficulty);
        rooms.emitLobby(room);
        rooms.start(room);
      } else {
        rooms.emitLobby(room);
      }
      ack(cb, { ok: true, code: room.code, seat, lobby: room.lobbyView() });
    },

    'room:join': (payload = {}, cb) => {
      const { code, name = 'Trader', playerId, asSpectator = false } = payload;
      if (!playerId) return ack(cb, { ok: false, error: 'Missing player id.' });
      const room = rooms.get(code);
      if (!room) return ack(cb, { ok: false, error: `No room called "${code}".` });
      leaveCurrent();

      // Reclaim a seat first — this is how reconnects work.
      let seat = room.seatOf(playerId);
      if (seat < 0 && !asSpectator) seat = room.freeSeat();

      if (seat >= 0) {
        if (!room.seats[seat]) {
          room.sit(seat, { playerId, name: String(name).slice(0, 18) || 'Trader' });
        } else {
          room.seats[seat].name = room.seats[seat].name || name;
        }
        room.seats[seat].sockets.add(socket.id);
        socket.data = { playerId, name: room.seats[seat].name, code: room.code, seat };
        socket.join(room.code);
        rooms.markReconnect(room, seat);
        rooms.emitLobby(room);
        if (room.started && room.match) rooms.emitUpdate(room, [], { kind: 'resync' });
        else if (room.isFull()) rooms.start(room);
        // lobbyView() is read AFTER start() so `started` reflects reality.
        return ack(cb, { ok: true, code: room.code, seat, lobby: room.lobbyView() });
      }

      // The game seats exactly two. Everyone else watches.
      room.spectators.set(socket.id, { playerId, name });
      socket.data = { playerId, name, code: room.code, seat: -1, spectator: true };
      socket.join(room.code);
      rooms.emitLobby(room);
      if (room.match) rooms.emitUpdate(room, [], { kind: 'resync' });
      ack(cb, { ok: true, code: room.code, seat: -1, spectator: true, lobby: room.lobbyView() });
    },

    'room:addBot': (payload = {}, cb) => {
      const room = rooms.get(socket.data.code);
      if (!room) return ack(cb, { ok: false, error: 'Not in a room.' });
      const seat = room.freeSeat();
      if (seat < 0) return ack(cb, { ok: false, error: 'Both seats are taken.' });
      room.addBot(seat, payload.difficulty || room.difficulty);
      rooms.emitLobby(room);
      rooms.start(room);
      ack(cb, { ok: true });
    },

    'room:substituteBot': (payload = {}, cb) => {
      const room = rooms.get(socket.data.code);
      if (!room) return ack(cb, { ok: false, error: 'Not in a room.' });
      const seat = 1 - socket.data.seat;
      ack(cb, rooms.substituteBot(room, seat, payload.difficulty));
    },

    'game:action': (payload = {}, cb) => {
      const room = rooms.get(socket.data.code);
      if (!room) return ack(cb, { ok: false, error: 'Not in a room.' });
      if (socket.data.spectator) return ack(cb, { ok: false, error: 'Spectators cannot play.' });
      ack(cb, rooms.act(room, socket.data.playerId, payload.action));
    },

    'game:nextRound': (_p, cb) => {
      const room = rooms.get(socket.data.code);
      if (!room || !room.match) return ack(cb, { ok: false, error: 'No game.' });
      if (socket.data.spectator) return ack(cb, { ok: false, error: 'Spectators cannot advance the game.' });
      rooms.nextRound(room);
      ack(cb, { ok: true });
    },

    'game:rematch': (_p, cb) => {
      const room = rooms.get(socket.data.code);
      if (!room || !room.match) return ack(cb, { ok: false, error: 'No game.' });
      if (socket.data.spectator) return ack(cb, { ok: false, error: 'Spectators cannot restart the match.' });
      if (!room.match.state.matchOver) return ack(cb, { ok: false, error: 'The match is still running.' });
      rooms.rematch(room);
      ack(cb, { ok: true });
    },

    chat: (payload = {}) => {
      const room = rooms.get(socket.data.code);
      if (!room) return;
      const text = String(payload.text || '').slice(0, 200).trim();
      if (!text) return;
      const line = { name: socket.data.name || 'Trader', text, at: Date.now(), seat: socket.data.seat };
      room.chat.push(line);
      if (room.chat.length > 120) room.chat.shift();
      io.to(room.code).emit('chat', line);
    },

    'room:leave': () => leaveCurrent(),
    disconnect: () => leaveCurrent(),
  };
}

module.exports = { createSession, ack };
