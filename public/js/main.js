/* Menu, lobby, networking, and the input layer. */
(function (w) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const G = Game.G;

  /* ------------------------------------------------------------- identity */
  const LS = w.localStorage;
  function pid() {
    let v = null;
    try { v = LS.getItem('jaipur.pid'); } catch (e) { /* private mode */ }
    if (!v) {
      v = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { LS.setItem('jaipur.pid', v); } catch (e) { /* ignore */ }
    }
    return v;
  }
  const PLAYER_ID = pid();
  function savedName() { try { return LS.getItem('jaipur.name') || ''; } catch (e) { return ''; } }
  function saveName(n) { try { LS.setItem('jaipur.name', n); } catch (e) { /* ignore */ } }

  const state = { code: null, seat: -1, spectator: false, difficulty: 'normal', net: null };

  /* -------------------------------------------------------------- screens */
  function show(id) {
    $$('.screen').forEach((s) => s.classList.toggle('show', s.id === id));
  }
  function overlay(id, on) {
    const o = document.getElementById(id);
    if (o) o.classList.toggle('open', on);
  }
  function closeAllOverlays() { $$('.overlay').forEach((o) => o.classList.remove('open')); }

  /* --------------------------------------------------------------- socket */
  // `socket` is the transport facade from net.js: a local in-page server when
  // you play a bot, a real socket.io connection when you play a person.
  const socket = Net;

  socket.on('connect', () => {
    if (state.code) {
      socket.emit('room:join', { code: state.code, name: nameValue(), playerId: PLAYER_ID }, (r) => {
        if (!r || !r.ok) { FX.toast(r && r.error || 'Could not rejoin.', 'bad'); show('menu'); state.code = null; }
      });
    }
  });
  socket.on('disconnect', () => FX.toast('Connection lost — reconnecting…', 'bad'));

  socket.on('room:lobby', (lobby) => {
    state.code = lobby.code;
    renderLobby(lobby);
    if (!lobby.started) show('lobby');
  });

  socket.on('game:update', (payload) => {
    if (!payload || !payload.view) return;
    state.spectator = !!payload.view.spectator;
    if (!$('#table').classList.contains('show')) {
      show('table');
      closeAllOverlays();
      Game.setView(payload.view);
      if (!payload.events || !payload.events.length) return;
    }
    if (payload.meta && payload.meta.kind === 'resync' && (!payload.events || !payload.events.length)) {
      Game.setView(payload.view);
      return;
    }
    // A new round can begin without this client pressing anything — the server
    // advances a bot room on a timer, and the other player can advance a human
    // one. Never leave last round's scoreboard sitting over a live table.
    if ((payload.events || []).some((e) => e.t === 'round_start')) {
      overlay('scoreOverlay', false);
      overlay('sellOverlay', false);
    }
    Game.handle(payload);
  });

  socket.on('room:opponent', (p) => {
    // Connection state lives in the room, not in the game state, so paint it here.
    const v = G.view;
    if (v && p.seat !== v.you) {
      const tag = document.getElementById('oppTag');
      if (tag) tag.textContent = p.connected ? (v.players[p.seat].isBot ? 'bot' : '') : 'away';
      document.getElementById('oppSide').classList.toggle('gone', !p.connected);
    }
    if (p.connected) {
      FX.toast(`${p.name} is back.`, 'good');
      overlay('waitOverlay', false);
    } else {
      FX.toast(`${p.name} dropped out — waiting for them…`, 'bad');
    }
  });

  socket.on('room:stalled', (p) => {
    $('#waitTitle').textContent = `${p.name} has not come back`;
    $('#waitSub').textContent = 'You can hand their seat to a bot and keep playing, or leave the table.';
    overlay('waitOverlay', true);
  });

  socket.on('room:substituted', (p) => {
    FX.toast(`${p.name} has taken the empty seat.`, 'good');
    overlay('waitOverlay', false);
  });

  socket.on('room:closed', () => { FX.toast('The room was closed.', 'bad'); show('menu'); state.code = null; });

  socket.on('chat', (line) => addChat(line));

  /* ----------------------------------------------------------------- menu */
  $('#nameInput').value = savedName();
  const nameValue = () => ($('#nameInput').value.trim().slice(0, 18) || 'Trader');

  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.tabpane').forEach((p) => p.classList.toggle('show', p.dataset.pane === t.dataset.tab));
  }));

  $$('#difficulty .seg').forEach((b) => b.addEventListener('click', () => {
    $$('#difficulty .seg').forEach((x) => x.classList.toggle('active', x === b));
    state.difficulty = b.dataset.v;
  }));

  $('#playBot').addEventListener('click', async () => {
    saveName(nameValue());
    FX.SFX.turn();
    state.code = null;               // never carry a room across a transport switch
    await Net.useLocal();            // no backend involved in a game against a bot
    socket.emit('room:create', {
      name: nameValue(), vsBot: true, difficulty: state.difficulty, playerId: PLAYER_ID,
    }, (r) => {
      if (!r || !r.ok) return FX.toast((r && r.error) || 'Could not start.', 'bad');
      state.code = r.code; state.seat = r.seat;
    });
  });

  // Hosting and joining need the always-on room server.
  async function goOnline() {
    if (!Net.canPlayOnline) {
      FX.toast('This deployment plays bots only — no room server is configured.', 'bad');
      return false;
    }
    if (Net.kind === 'remote') return true;
    state.code = null;               // never carry a room across a transport switch
    FX.toast('Reaching the room server…', '');
    try {
      await Net.useRemote();
      return true;
    } catch (e) {
      FX.toast('Could not reach the room server. If it sleeps when idle, give it a minute and try again.', 'bad');
      return false;
    }
  }

  $('#hostRoom').addEventListener('click', async () => {
    saveName(nameValue());
    if (!await goOnline()) return;
    socket.emit('room:create', {
      name: nameValue(), vsBot: false, difficulty: state.difficulty, playerId: PLAYER_ID,
    }, (r) => {
      if (!r || !r.ok) return FX.toast((r && r.error) || 'Could not open a room.', 'bad');
      state.code = r.code; state.seat = r.seat;
      show('lobby');
    });
  });

  $('#codeInput').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  $('#joinRoom').addEventListener('click', doJoin);
  $('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  async function doJoin() {
    const code = $('#codeInput').value.trim().toUpperCase();
    if (code.length !== 4) return FX.toast('A room code is four letters.', 'bad');
    saveName(nameValue());
    if (!await goOnline()) return;
    socket.emit('room:join', { code, name: nameValue(), playerId: PLAYER_ID }, (r) => {
      if (!r || !r.ok) return FX.toast((r && r.error) || 'Could not join.', 'bad');
      state.code = r.code; state.seat = r.seat; state.spectator = !!r.spectator;
      if (r.spectator) FX.toast('Both chairs are taken — you are watching.', '');
      // The ack lands after the first game:update, so never pull a player who
      // just walked into a running game back out to the lobby.
      if (!(r.lobby && r.lobby.started)) show('lobby');
    });
  }

  /* ---------------------------------------------------------------- lobby */
  let netInfo = null;
  if (Net.canPlayOnline) {
    fetch((Net.roomServer || '') + '/api/net')
      .then((r) => r.json())
      .then((n) => { netInfo = n; paintInvite(); })
      .catch(() => { /* static host, or the server is asleep — the link still works */ });
  }

  function paintInvite() {
    if (!state.code) return;
    const base = (netInfo && netInfo.lanUrl && location.hostname === 'localhost')
      ? netInfo.lanUrl : location.origin;
    $('#inviteLink').value = `${base}/?room=${state.code}`;
    $('#netNote').textContent = (netInfo && netInfo.note) || '';
  }

  function renderLobby(lobby) {
    $('#roomCode').textContent = lobby.code;
    paintInvite();
    const list = $('#seatList');
    list.innerHTML = '';
    lobby.seats.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'seat' + (s ? '' : ' open') + (s && !s.connected ? ' away' : '');
      d.innerHTML = s
        ? `<i class="av">${(s.name || '?').charAt(0).toUpperCase()}</i>
           <b>${esc(s.name)}</b>
           <em>${s.isBot ? 'bot' : (s.connected ? 'ready' : 'away')}</em>`
        : `<i class="av wait">…</i><b>Empty chair</b><em>waiting</em>`;
      list.appendChild(d);
    });
    if (lobby.spectators && lobby.spectators.length) {
      const d = document.createElement('div');
      d.className = 'seat spec';
      d.innerHTML = `<i class="av">👁</i><b>${lobby.spectators.length} watching</b><em>${esc(lobby.spectators.join(', '))}</em>`;
      list.appendChild(d);
    }
    $('#lobbyChat').innerHTML = '';
    (lobby.chat || []).forEach(addChat);
    $('#lobbyAddBot').style.display = lobby.seats.some((s) => !s) ? '' : 'none';
  }

  $('#copyLink').addEventListener('click', async () => {
    const v = $('#inviteLink').value;
    try { await navigator.clipboard.writeText(v); FX.toast('Invite link copied.', 'good'); }
    catch (e) { $('#inviteLink').select(); FX.toast('Press ⌘C to copy.', ''); }
  });

  $('#lobbyAddBot').addEventListener('click', () => {
    socket.emit('room:addBot', { difficulty: state.difficulty }, (r) => {
      if (!r || !r.ok) FX.toast((r && r.error) || 'Could not add a bot.', 'bad');
    });
  });
  $('#lobbyLeave').addEventListener('click', () => {
    socket.emit('room:leave');
    state.code = null;
    show('menu');
  });

  $('#lobbyChatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#lobbyChatInput').value.trim();
    if (!t) return;
    socket.emit('chat', { text: t });
    $('#lobbyChatInput').value = '';
  });

  function addChat(line) {
    const box = $('#lobbyChat');
    const d = document.createElement('div');
    d.className = 'cline';
    d.innerHTML = `<b>${esc(line.name)}</b> ${esc(line.text)}`;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------ selection */
  const sel = G.sel;
  sel.camelTake = false;

  Game.el.market.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card || !playable()) return;
    const slot = Number(card.closest('.slot').dataset.slot);
    if (card.dataset.good === 'camel') {
      sel.camelTake = !sel.camelTake;
      sel.market.clear(); sel.hand.clear(); sel.camels = 0;
      if (sel.camelTake) $$('#market .iscamel').forEach((c) => c.classList.add('picked'));
      FX.SFX.card();
      return refresh();
    }
    sel.camelTake = false;
    if (sel.market.has(slot)) sel.market.delete(slot); else sel.market.add(slot);
    FX.SFX.card();
    refresh();
  });

  Game.el.hand.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card || !playable()) return;
    sel.camelTake = false;
    const id = card.dataset.id;
    if (sel.hand.has(id)) sel.hand.delete(id); else sel.hand.add(id);
    FX.SFX.card();
    refresh();
  });

  $('#herdBtn').addEventListener('click', () => {
    if (!playable()) return;
    const v = G.view;
    const herd = v.players[v.you].herd;
    sel.camelTake = false;
    sel.camels = herd === 0 ? 0 : (sel.camels + 1) % (herd + 1);
    FX.SFX.card();
    refresh();
  });

  function playable() {
    const v = G.view;
    return !!(v && v.legal && v.legal.yourTurn && !G.busy && !state.spectator && !v.roundOver);
  }

  function selectedGoods() {
    const v = G.view;
    return [...sel.hand].map((id) => (v.hand.find((c) => c.id === id) || {}).good).filter(Boolean);
  }

  function derive() {
    const v = G.view;
    if (!v || !playable()) return { take: false, camels: false, exchange: false, sell: false, why: '' };
    const L = v.legal;
    const marketSlots = [...sel.market];
    const goods = selectedGoods();
    const sameGood = goods.length > 0 && goods.every((g) => g === goods[0]);

    const take = marketSlots.length === 1 && sel.hand.size === 0 && sel.camels === 0
      && L.take.includes(marketSlots[0]);
    const swapN = sel.hand.size + sel.camels;
    const exchange = marketSlots.length >= 2 && swapN === marketSlots.length
      && marketSlots.every((s) => v.market[s] && v.market[s].good !== 'camel')
      && !goods.some((g) => marketSlots.some((s) => v.market[s].good === g))
      && (v.hand.length - sel.hand.size + marketSlots.length) <= 7;
    const sell = marketSlots.length === 0 && sel.camels === 0 && sameGood
      && sel.hand.size >= Cards.META[goods[0]].min;

    let why = '';
    if (sel.camelTake) why = 'Claim every camel in the market.';
    else if (take) why = `Take the ${Cards.META[v.market[marketSlots[0]].good].short}.`;
    else if (exchange) why = `Swap ${swapN} for ${marketSlots.length}.`;
    else if (sell) why = `Sell ${sel.hand.size}× ${Cards.META[goods[0]].short}.`;
    else if (marketSlots.length >= 2 && swapN !== marketSlots.length) {
      why = `Offer ${marketSlots.length} card${marketSlots.length > 1 ? 's' : ''} back — pick ${marketSlots.length - swapN} more from your hand or herd.`;
    } else if (goods.length && !sameGood) why = 'A sale must be a single kind of goods.';
    else if (goods.length && sameGood && sel.hand.size < Cards.META[goods[0]].min) {
      why = `${Cards.META[goods[0]].label} must be sold two or more at a time.`;
    } else if (v.hand.length >= 7 && !L.take.length) why = 'Your hand is full — sell, exchange, or take camels.';
    else why = 'Take a card, swap several, take the camels, or sell.';

    return { take, camels: sel.camelTake && L.camels, exchange, sell, why, goods, marketSlots };
  }

  function refresh() {
    const d = derive();
    $('#btnTake').disabled = !d.take;
    $('#btnCamels').disabled = !d.camels;
    $('#btnExchange').disabled = !d.exchange;
    $('#btnSell').disabled = !(d.sell || (playable() && Object.keys((G.view.legal || {}).sell || {}).length));
    $('#btnClear').disabled = !(sel.market.size || sel.hand.size || sel.camels || sel.camelTake);
    $('#btnCamels').classList.toggle('pulse', !!d.camels);
    paintPrompt(d);
    Game.render();
  }

  function paintPrompt(d) {
    const v = G.view;
    if (!v) { $('#prompt').textContent = 'Waiting…'; return; }
    $('#prompt').textContent =
        v.roundOver ? 'Round over.'
      : state.spectator ? 'You are watching this table.'
      : v.turn !== v.you ? `${v.players[1 - v.you].name} is thinking…`
      : G.busy ? 'Your move.'
      : d.why;
  }
  G.onSettled = () => {
    const d = derive();
    $('#btnTake').disabled = !d.take;
    $('#btnCamels').disabled = !d.camels;
    $('#btnExchange').disabled = !d.exchange;
    $('#btnSell').disabled = !(d.sell || (playable() && Object.keys(((G.view || {}).legal || {}).sell || {}).length));
    $('#btnClear').disabled = !(sel.market.size || sel.hand.size || sel.camels || sel.camelTake);
    paintPrompt(d);
  };

  function send(action) {
    if (!playable()) return;
    socket.emit('game:action', { action }, (r) => {
      if (!r || !r.ok) { FX.SFX.err(); FX.toast((r && r.error) || 'Illegal move.', 'bad'); }
    });
    sel.market.clear(); sel.hand.clear(); sel.camels = 0; sel.camelTake = false;
  }

  $('#btnTake').addEventListener('click', () => send({ type: 'take', slot: [...sel.market][0] }));
  $('#btnCamels').addEventListener('click', () => send({ type: 'camels' }));
  $('#btnExchange').addEventListener('click', () => send({
    type: 'exchange', give: [...sel.hand], camels: sel.camels, takeSlots: [...sel.market],
  }));
  $('#btnClear').addEventListener('click', () => {
    sel.market.clear(); sel.hand.clear(); sel.camels = 0; sel.camelTake = false; refresh();
  });

  $('#btnSell').addEventListener('click', () => {
    const d = derive();
    if (d.sell) return send({ type: 'sell', good: d.goods[0], count: sel.hand.size });
    openSellSheet();
  });

  /* ------------------------------------------------------------ sell sheet */
  function openSellSheet() {
    const v = G.view;
    const offers = (v.legal && v.legal.sell) || {};
    const box = $('#sellOpts');
    box.innerHTML = '';
    const keys = Object.keys(offers);
    if (!keys.length) return FX.toast('Nothing in your hand can be sold yet.', 'bad');
    $('#sellHint').textContent = 'Higher-value tokens are paid out first. Three or more cards in one sale also earns a bonus token.';
    for (const good of keys) {
      const { min, max } = offers[good];
      const row = document.createElement('div');
      row.className = 'sellrow g-' + good;
      row.innerHTML = `<div class="sg">${Cards.icon(good)}<b>${Cards.META[good].label}</b></div>`;
      const btns = document.createElement('div');
      btns.className = 'sbtns';
      for (let n = min; n <= max; n++) {
        const pile = (v.tokens[good] || []).slice();
        const pay = [];
        for (let i = 0; i < n && pile.length; i++) pay.push(pile.pop());
        const total = pay.reduce((a, b) => a + b, 0);
        const b = document.createElement('button');
        b.className = 'btn sellbtn' + (n >= 3 ? ' bonus' : '');
        b.innerHTML = `<b>${n}</b><span>${total} rp${n >= 3 ? ` + ${Math.min(n, 5)}-bonus` : ''}</span>`;
        b.addEventListener('click', () => {
          overlay('sellOverlay', false);
          send({ type: 'sell', good, count: n });
        });
        btns.appendChild(b);
      }
      row.appendChild(btns);
      box.appendChild(row);
    }
    overlay('sellOverlay', true);
  }
  $('#sellCancel').addEventListener('click', () => overlay('sellOverlay', false));

  /* --------------------------------------------------------- end of round */
  G.onRoundEnd = async (result, view) => {
    const you = view.you;
    const reasons = {
      three_piles: 'Three kinds of goods tokens ran out — the round ends at once.',
      deck_empty: 'The deck is empty and the market cannot be refilled.',
    };
    $('#scoreReason').textContent = reasons[result.reason] || '';
    const won = result.winner === you;
    $('#scoreTitle').textContent = result.winner === null ? 'The round is a draw'
      : won ? 'You take the round' : `${view.players[1 - you].name} takes the round`;

    const grid = $('#scoreGrid');
    grid.innerHTML = '';
    for (const side of [you, 1 - you]) {
      const p = result.reveal[side];
      const s = result.scores[side];
      const col = document.createElement('div');
      col.className = 'scol' + (side === you ? ' mine' : '') + (result.winner === side ? ' won' : '');
      col.innerHTML = `
        <h3>${esc(view.players[side].name)}${side === you ? ' (you)' : ''}</h3>
        <div class="srow"><span>Goods tokens</span><b>${s.goods}</b></div>
        <div class="srow bonusrow"><span>Bonus tokens (${p.bonusTokens.length})</span><b>${s.bonus}</b></div>
        <div class="srow"><span>Camels${p.camelToken ? ' — most camels' : ''} (${p.herd})</span><b>${s.camel}</b></div>
        <div class="srow total"><span>Rupees</span><b class="bigno">0</b></div>
        <div class="revealtokens"></div>`;
      const rt = col.querySelector('.revealtokens');
      for (const t of p.goodsTokens) rt.appendChild(Cards.tokenEl(t.good, t.value, { cls: 'mini' }));
      if (p.camelToken) rt.appendChild(Cards.camelTokenEl({ cls: 'mini' }));
      for (const b of p.bonusTokens) rt.appendChild(Cards.bonusEl(b.size, b.value, { cls: 'mini reveal' }));
      grid.appendChild(col);
    }

    $('#sealRow').innerHTML = '';
    for (const side of [you, 1 - you]) {
      const r = document.createElement('div');
      r.className = 'sealtally' + (side === you ? ' mine' : '');
      r.innerHTML = `<span>${esc(view.players[side].name)}</span>`
        + [0, 1].map((i) => `<i class="seal ${result.seals[side] > i ? 'on' : ''}"></i>`).join('');
      grid.parentNode && $('#sealRow').appendChild(r);
    }

    $('#scoreNext').textContent = view.matchOver ? 'See the result' : 'Next round';
    // Either player may move things along; the server ignores a second request
    // for the same round, and a bot room also advances on its own timer.
    $('#scoreNext').onclick = () => {
      overlay('scoreOverlay', false);
      if (view.matchOver) overlay('matchOverlay', true);
      else socket.emit('game:nextRound');
    };

    overlay('scoreOverlay', true);
    await FX.sleep(220);
    // count the totals up, one column at a time
    const nums = $$('#scoreGrid .bigno');
    [you, 1 - you].forEach((side, i) => {
      setTimeout(() => {
        FX.countUp(nums[i], 0, result.scores[side].total, 900);
        FX.SFX.coin();
      }, 260 + i * 420);
    });
    if (result.winner !== null) {
      setTimeout(() => {
        FX.shake(1.6);
        FX.flash(won ? 'rgba(255,215,120,.35)' : 'rgba(80,90,140,.3)', 520);
        if (won) { FX.confetti(90); FX.SFX.win(); } else FX.SFX.lose();
      }, 1500);
    }
    await FX.sleep(900);
  };

  G.onMatchEnd = async (ev, view) => {
    const won = ev.winner === view.you;
    $('#matchTitle').textContent = ev.draw ? 'A drawn match' : won ? 'The Maharaja favours you' : 'Defeat';
    $('#matchSub').textContent = ev.draw
      ? 'Neither merchant could claim two seals of excellence.'
      : `${esc(view.players[ev.winner].name)} wins ${ev.seals[ev.winner]}–${ev.seals[1 - ev.winner]} and takes two seals of excellence.`;
    $('.trophy').textContent = ev.draw ? '⚖️' : won ? '🏆' : '🥀';
    if (won) { FX.confetti(240); FX.fireworks(7); FX.SFX.win(); } else FX.SFX.lose();
  };

  $('#btnRematch').addEventListener('click', () => {
    overlay('matchOverlay', false);
    socket.emit('game:rematch', {}, (r) => { if (!r || !r.ok) FX.toast((r && r.error) || 'Could not restart.', 'bad'); });
  });
  $('#btnQuit').addEventListener('click', () => {
    closeAllOverlays();
    socket.emit('room:leave');
    state.code = null;
    show('menu');
  });

  $('#waitBot').addEventListener('click', () => {
    socket.emit('room:substituteBot', { difficulty: state.difficulty }, (r) => {
      if (!r || !r.ok) FX.toast((r && r.error) || 'Could not substitute.', 'bad');
      else overlay('waitOverlay', false);
    });
  });
  $('#waitQuit').addEventListener('click', () => {
    closeAllOverlays();
    socket.emit('room:leave');
    state.code = null;
    show('menu');
  });

  /* ----------------------------------------------------------------- chrome */
  $('#hudMenu').addEventListener('click', () => {
    socket.emit('room:leave');
    state.code = null;
    closeAllOverlays();
    show('menu');
  });
  $('#hudRules').addEventListener('click', () => overlay('rulesOverlay', true));
  $('#openRules').addEventListener('click', () => overlay('rulesOverlay', true));
  $('#closeRules').addEventListener('click', () => overlay('rulesOverlay', false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAllOverlays(); }
    if (e.key === 'c' && playable() && !$('#btnCamels').disabled) $('#btnCamels').click();
    if (e.key === 'Enter' && playable()) {
      for (const id of ['#btnTake', '#btnExchange', '#btnSell']) {
        if (!$(id).disabled) { $(id).click(); break; }
      }
    }
  });

  let muted = false;
  try { muted = LS.getItem('jaipur.muted') === '1'; } catch (e) { /* ignore */ }
  FX.setMuted(muted);
  $('#hudSound').classList.toggle('off', muted);
  $('#hudSound').addEventListener('click', () => {
    muted = !muted;
    FX.setMuted(muted);
    try { LS.setItem('jaipur.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
    $('#hudSound').classList.toggle('off', muted);
    if (!muted) FX.SFX.turn();
  });

  /* ------------------------------------------------------------- rules text */
  $('#rulesBody').innerHTML = `
    <p>You and one rival are merchants in the markets of Jaipur. Win two rounds to earn two <b>seals of excellence</b> and the Maharaja's favour.</p>
    <h3>Your turn — do exactly one thing</h3>
    <ul>
      <li><b>Take one goods card</b> from the five-card market into your hand.</li>
      <li><b>Take every camel</b> in the market into your herd. Camels sit outside your hand.</li>
      <li><b>Exchange</b> two or more market cards for the same number from your hand and/or herd. You may never take camels this way, and you may not hand back a type you are taking.</li>
      <li><b>Sell</b> cards of a single goods type. Diamonds, gold and silver must be sold two or more at a time.</li>
    </ul>
    <h3>Selling</h3>
    <p>You always receive the <b>highest remaining tokens</b> of that goods type. Sell three, four or five cards at once and you also draw a face-down <b>bonus token</b> — worth more the bigger the sale.</p>
    <table class="rtab">
      <tr><th>Goods</th><th>Tokens (paid highest first)</th></tr>
      ${Cards.GOODS.map((g) => `<tr class="g-${g}"><td><span class="rswatch">${Cards.icon(g)}</span> ${Cards.META[g].label}${Cards.META[g].min > 1 ? ' <em>(min 2)</em>' : ''}</td><td>${Cards.TOKENS[g].slice().reverse().join(' · ')}</td></tr>`).join('')}
      <tr><td>3-card bonus</td><td>${Cards.BONUS[3].join(' · ')}</td></tr>
      <tr><td>4-card bonus</td><td>${Cards.BONUS[4].join(' · ')}</td></tr>
      <tr><td>5-card bonus</td><td>${Cards.BONUS[5].join(' · ')}</td></tr>
    </table>
    <h3>Limits</h3>
    <ul>
      <li>Seven cards in hand, maximum. Camels in your herd never count.</li>
      <li>The market is topped back up to five cards at the end of every turn.</li>
    </ul>
    <h3>Ending a round</h3>
    <p>The round stops the moment <b>three kinds of goods tokens run out</b>, or when the market cannot be refilled. Whoever holds the <b>most camels</b> then takes a 5-rupee token — nobody gets it on a tie.</p>
    <p>Most rupees wins the round and a seal. Ties are broken by bonus tokens, then goods tokens, then the camel token.</p>
    <h3>Shortcuts</h3>
    <p><b>Click</b> market cards and hand cards to build a move · <b>click your herd</b> to add camels to an exchange · <b>C</b> takes the camels · <b>Enter</b> confirms · <b>Esc</b> closes a panel.</p>
  `;

  /* ------------------------------------------- online availability notice */
  if (!Net.canPlayOnline) {
    for (const pane of ['host', 'join']) {
      const p = $(`.tabpane[data-pane="${pane}"]`);
      if (!p) continue;
      p.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
      const note = document.createElement('p');
      note.className = 'hint offline-note';
      note.textContent = 'Playing other people needs an always-on room server, '
        + 'which this build is deployed without. Bot play below works fully.';
      p.prepend(note);
    }
    $$('.tab').forEach((t) => {
      if (t.dataset.tab !== 'bot') t.classList.add('dim');
    });
  }

  /* --------------------------------------------------- deep link ?room=CODE */
  const q = new URLSearchParams(location.search);
  const invited = (q.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (invited && Net.canPlayOnline) {
    $('#codeInput').value = invited;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'join'));
    $$('.tabpane').forEach((p) => p.classList.toggle('show', p.dataset.pane === 'join'));
    if (savedName()) setTimeout(doJoin, 350);
    else FX.toast(`You were invited to room ${invited} — enter a name and join.`, 'good');
  } else if (invited) {
    FX.toast(`Room ${invited} can't be opened here — this build has no room server.`, 'bad');
  }

  refresh();
})(window);
