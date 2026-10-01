/*
 * Transport. Everything above this file talks to `Net` as if it were a socket.
 *
 *   local   the room manager and the protocol run inside this page, so a game
 *           against a bot needs no backend — which is what makes the static
 *           deploy work. Same engine, same rules, same bot.
 *   remote  a real socket.io connection to a room server, for playing other
 *           people. The client library is fetched on demand, so a visitor who
 *           only plays bots never touches the network.
 *
 * window.ROOM_SERVER_URL (from the generated config.js):
 *   ""     this page's own origin
 *   null   no room server — multiplayer is unavailable
 *   <url>  an always-on server elsewhere
 */
(function (w) {
  'use strict';

  const listeners = {};

  function deliver(event, payload) {
    const fns = listeners[event];
    if (!fns) return;
    for (const fn of fns) {
      try { fn(payload); } catch (e) { console.error('[net] handler failed for ' + event, e); }
    }
  }

  /* ───────────────────────────── local ──────────────────────────────── */
  function createLocal() {
    const Core = w.GameCore;
    if (!Core) throw new Error('core-bundle.js did not load.');

    // Tearing a transport down makes it emit (a disconnect leaves the room,
    // which broadcasts a lobby update). Those events must not reach the app
    // after the switch, or the dead server's room code overwrites the new one.
    let live = true;
    const push = (event, payload) => { if (live) deliver(event, payload); };

    // One page, one client: every broadcast target resolves to us.
    const io = { to: () => ({ emit: push }) };
    const rooms = new Core.rooms.RoomManager(io);
    const socket = { id: 'local-0', data: {}, join() {}, leave() {} };
    const handlers = Core.session.createSession(rooms, io, socket);

    return {
      kind: 'local',
      rooms,
      emit(event, payload, cb) {
        if (!live) return;
        const fn = handlers[event];
        if (!fn) {
          if (cb) cb({ ok: false, error: `"${event}" needs a room server.` });
          return;
        }
        // Keep a real socket's asynchrony so callers behave the same either way.
        setTimeout(() => { if (live) fn(payload, cb); }, 0);
      },
      close() {
        live = false;
        try { handlers.disconnect(); } catch (e) { /* already gone */ }
      },
    };
  }

  /* ───────────────────────────── remote ─────────────────────────────── */
  const PUSHED = ['connect', 'disconnect', 'room:lobby', 'game:update', 'room:opponent',
    'room:stalled', 'room:substituted', 'room:closed', 'chat'];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('Could not reach the room server.'));
      document.head.appendChild(el);
    });
  }

  async function createRemote() {
    const base = Net.roomServer;
    if (base === null) throw new Error('This deployment has no room server.');
    if (!w.io) await loadScript((base || '') + '/socket.io/socket.io.js');
    if (!w.io) throw new Error('The room server did not serve a client library.');

    const opts = { transports: ['websocket', 'polling'] };
    const sock = base ? w.io(base, opts) : w.io(opts);
    let live = true;
    for (const event of PUSHED) {
      sock.on(event, (payload) => { if (live) deliver(event, payload); });
    }

    return {
      kind: 'remote',
      sock,
      emit(event, payload, cb) { if (live) sock.emit(event, payload, cb); },
      close() {
        live = false;
        try { sock.close(); } catch (e) { /* already closed */ }
      },
    };
  }

  /* ───────────────────────────── facade ─────────────────────────────── */
  const Net = {
    transport: null,

    get kind() { return Net.transport ? Net.transport.kind : null; },
    get roomServer() {
      return typeof w.ROOM_SERVER_URL === 'undefined' ? '' : w.ROOM_SERVER_URL;
    },
    // Hosting and joining need a backend; playing a bot never does.
    get canPlayOnline() { return Net.roomServer !== null; },

    on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },

    emit(event, payload, cb) {
      if (!Net.transport) {
        if (cb) cb({ ok: false, error: 'Not connected yet.' });
        return;
      }
      Net.transport.emit(event, payload, cb);
    },

    drop() {
      if (Net.transport) Net.transport.close();
      Net.transport = null;
    },

    useLocal() {
      if (Net.kind === 'local') return Promise.resolve(Net.transport);
      Net.drop();
      Net.transport = createLocal();
      return Promise.resolve(Net.transport);
    },

    async useRemote() {
      if (Net.kind === 'remote') return Net.transport;
      Net.drop();
      Net.transport = await createRemote();
      return Net.transport;
    },
  };

  w.Net = Net;
})(window);
