/* Board state mirror, rendering, and the animation queue. */
(function (w) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const el = {
    market: $('#market'), hand: $('#hand'), deck: $('#deck'), deckCount: $('#deckCount'),
    pileRail: $('#pileRail'), bonusPiles: $('#bonusPiles'),
    oppName: $('#oppName'), oppTag: $('#oppTag'), oppTokens: $('#oppTokens'), oppHand: $('#oppHand'),
    oppHerd: $('#oppHerd'), oppPoints: $('#oppPoints'), oppBonusChip: $('#oppBonusChip'),
    oppAvatar: $('#oppAvatar'), oppSay: $('#oppSay'),
    youName: $('#youName'), youTokens: $('#youTokens'), youHerd: $('#youHerd'),
    youPoints: $('#youPoints'), youBonusChip: $('#youBonusChip'),
    handCount: $('#handCount'), roundNo: $('#roundNo'), seals: $('#seals'),
    prompt: $('#prompt'), table: $('#table'),
  };
  el.oppTokens.dataset.rect = 'tokens:opp';

  const FULL_TOKENS = Cards.TOKENS;

  // Entry animations must fire only for things that just appeared. Re-rendering
  // the whole hand on every event would otherwise replay them and the cards
  // would flicker away mid-turn.
  const seenBefore = { hand: new Set(), opp: 0, tray: { you: 0, opp: 0 } };

  const G = {
    view: null,          // the board we are currently showing
    server: null,        // last authoritative view
    sel: { market: new Set(), hand: new Set(), camels: 0 },
    busy: false,
    queue: [],
    onSettled: null,     // main.js hooks here to refresh the action bar
    onRoundEnd: null,
    onMatchEnd: null,
  };

  /* ------------------------------------------------- local event replay */
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function resetBoard(v) {
    v.market = [null, null, null, null, null];
    v.hand = [];
    v.deckCount = 55;
    v.tokens = {};
    for (const g of Cards.GOODS) v.tokens[g] = FULL_TOKENS[g].slice();
    v.bonusCounts = { 3: Cards.BONUS[3].length, 4: Cards.BONUS[4].length, 5: Cards.BONUS[5].length };
    for (const p of v.players) {
      p.handCount = 0; p.herd = 0; p.goodsTokens = []; p.bonusCount = 0;
      p.bonusSizes = []; p.bonusTokens = []; p.camelToken = false; p.visiblePoints = 0;
    }
    v.roundOver = false;
    v.roundResult = null;
  }

  function applyEv(v, ev) {
    const you = v.you;
    const mine = (seat) => seat === you;
    switch (ev.t) {
      case 'round_start':
        resetBoard(v);
        v.round = ev.round;
        v.turn = ev.first;
        break;
      case 'deal': {
        v.deckCount = Math.max(0, v.deckCount - 1);
        const to = ev.to;
        if (to.zone === 'market') v.market[to.slot] = ev.card;
        else if (to.zone === 'herd') v.players[to.seat].herd += 1;
        else {
          v.players[to.seat].handCount += 1;
          if (mine(to.seat)) v.hand.push(ev.card);
        }
        break;
      }
      case 'take':
        v.market[ev.slot] = null;
        v.players[ev.seat].handCount += 1;
        if (mine(ev.seat)) v.hand.push(ev.card);
        break;
      case 'camels':
        for (const s of ev.slots) v.market[s] = null;
        v.players[ev.seat].herd += ev.cards.length;
        break;
      case 'exchange': {
        const fromHand = ev.placed.filter((p) => !p.fromHerd);
        if (mine(ev.seat)) {
          const ids = new Set(fromHand.map((p) => p.card.id));
          v.hand = v.hand.filter((c) => !ids.has(c.id));
        }
        v.players[ev.seat].handCount -= fromHand.length;
        v.players[ev.seat].herd -= ev.camels;
        for (const p of ev.placed) v.market[p.slot] = p.card;
        for (const t of ev.taken) {
          v.players[ev.seat].handCount += 1;
          if (mine(ev.seat)) v.hand.push(t.card);
        }
        break;
      }
      case 'refill':
        v.market[ev.slot] = ev.card;
        v.deckCount = Math.max(0, v.deckCount - 1);
        break;
      case 'sell': {
        const p = v.players[ev.seat];
        if (mine(ev.seat)) {
          const ids = new Set(ev.cards.map((c) => c.id));
          v.hand = v.hand.filter((c) => !ids.has(c.id));
        }
        p.handCount -= ev.cards.length;
        for (const t of ev.tokens) {
          p.goodsTokens.push(t);
          p.visiblePoints += t.value;
          if (v.tokens[t.good] && v.tokens[t.good].length) v.tokens[t.good].pop();
        }
        if (ev.bonus && !ev.bonus.empty) {
          p.bonusCount += 1;
          (p.bonusSizes = p.bonusSizes || []).push(ev.bonus.size);
          if (ev.bonus.value != null) (p.bonusTokens = p.bonusTokens || []).push(ev.bonus);
          if (v.bonusCounts[ev.bonus.size]) v.bonusCounts[ev.bonus.size] -= 1;
        }
        break;
      }
      case 'turn':
        v.turn = ev.seat;
        if (v.legal) v.legal.yourTurn = ev.seat === you;
        break;
      case 'round_end':
        v.roundOver = true;
        v.roundResult = ev.result;
        break;
      default:
        break;
    }
  }

  /* --------------------------------------------------------------- render */
  function render() {
    const v = G.view;
    if (!v) return;
    const me = v.players[v.you];
    const op = v.players[1 - v.you];

    el.roundNo.textContent = v.round;
    el.deckCount.textContent = v.deckCount;
    el.deck.classList.toggle('empty', v.deckCount === 0);

    // --- seals -----------------------------------------------------------
    el.seals.innerHTML = '';
    for (let side = 0; side < 2; side++) {
      const seat = side === 0 ? v.you : 1 - v.you;
      const row = document.createElement('div');
      row.className = 'sealrow' + (side === 0 ? ' mine' : '');
      row.title = (side === 0 ? 'Your' : 'Their') + ' seals of excellence';
      for (let i = 0; i < 2; i++) {
        const s = document.createElement('i');
        s.className = 'seal' + (v.seals[seat] > i ? ' on' : '');
        row.appendChild(s);
      }
      el.seals.appendChild(row);
    }

    // --- market ----------------------------------------------------------
    el.market.innerHTML = '';
    v.market.forEach((card, slot) => {
      const wrap = document.createElement('div');
      wrap.className = 'slot';
      wrap.dataset.slot = slot;
      if (!card) { wrap.classList.add('hole'); el.market.appendChild(wrap); return; }
      const c = Cards.cardEl(card, { slot });
      const isCamel = card.good === 'camel';
      const takeable = !!(v.legal && v.legal.yourTurn) && !G.busy;
      if (isCamel) c.classList.add('iscamel');
      if (takeable && !isCamel) c.classList.add('sel-ok');
      if (takeable && isCamel) c.classList.add('camel-ok');
      if (G.sel.market.has(slot)) c.classList.add('picked');
      el.market.appendChild(wrap).appendChild(c);
    });

    // --- token piles -----------------------------------------------------
    el.pileRail.innerHTML = '';
    for (const g of Cards.GOODS) {
      const pile = v.tokens[g] || [];
      const box = document.createElement('div');
      box.className = 'pile g-' + g + (pile.length === 0 ? ' gone' : '');
      box.dataset.rect = 'pile:' + g;
      box.title = `${Cards.META[g].label} — ${pile.length} token${pile.length === 1 ? '' : 's'} left`;
      const top = pile.length ? pile[pile.length - 1] : '—';
      box.innerHTML = `
        <div class="pstack">${pile.slice(-4).map((_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
        <div class="ptop">${top}</div>
        <div class="pico">${Cards.icon(g)}</div>
        <div class="pcount">${pile.length}</div>`;
      el.pileRail.appendChild(box);
    }

    // --- bonus piles -----------------------------------------------------
    el.bonusPiles.innerHTML = '';
    for (const size of [3, 4, 5]) {
      const n = (v.bonusCounts && v.bonusCounts[size]) || 0;
      const b = document.createElement('div');
      b.className = 'bpile' + (n === 0 ? ' gone' : '');
      b.dataset.rect = 'bonus:' + size;
      b.title = `${size}-card bonus tokens — ${n} left`;
      b.innerHTML = `<span class="bn">${size}</span><span class="bc">${n}</span>`;
      el.bonusPiles.appendChild(b);
    }

    // --- opponent --------------------------------------------------------
    el.oppName.textContent = op.name;
    el.oppTag.textContent = op.isBot ? 'bot' : (op.connected === false ? 'away' : '');
    el.oppAvatar.querySelector('span').textContent = (op.name || '?').trim().charAt(0).toUpperCase();
    el.oppAvatar.classList.toggle('active', v.turn !== v.you && !v.roundOver);
    el.oppHerd.querySelector('b').textContent = op.herd;
    el.oppPoints.textContent = op.visiblePoints + ' rp';
    el.oppBonusChip.textContent = op.bonusCount + ' bonus';
    el.oppBonusChip.classList.toggle('hot', op.bonusCount > 0);
    renderTray(el.oppTokens, op, false);
    el.oppHand.innerHTML = '';
    for (let i = 0; i < op.handCount; i++) {
      const c = Cards.cardEl({ id: 'oppback' + i, good: null }, { cls: 'mini' });
      c.style.setProperty('--i', i);
      if (i >= seenBefore.opp) c.classList.add('just-in');
      el.oppHand.appendChild(c);
    }
    seenBefore.opp = op.handCount;

    // --- you -------------------------------------------------------------
    el.youName.textContent = me.name + (v.spectator ? ' (watching)' : '');
    el.youHerd.textContent = me.herd;
    el.youPoints.textContent = me.visiblePoints + ' rp';
    el.youBonusChip.textContent = me.bonusCount + ' bonus';
    el.youBonusChip.classList.toggle('hot', me.bonusCount > 0);
    renderTray(el.youTokens, me, true);

    el.hand.innerHTML = '';
    const n = v.hand.length;
    const handIds = new Set();
    v.hand.forEach((card, i) => {
      const c = Cards.cardEl(card);
      const off = i - (n - 1) / 2;                 // fan maths in JS: calc(abs()) is patchy
      c.style.setProperty('--rot', (off * 2.6).toFixed(2) + 'deg');
      c.style.setProperty('--lift', (Math.abs(off) * 3).toFixed(1) + 'px');
      c.style.setProperty('--i', i);
      if (G.sel.hand.has(card.id)) c.classList.add('picked');
      if (v.legal && v.legal.yourTurn && !G.busy) c.classList.add('sel-ok');
      if (!seenBefore.hand.has(card.id)) c.classList.add('just-in');
      handIds.add(card.id);
      el.hand.appendChild(c);
    });
    seenBefore.hand = handIds;
    el.handCount.textContent = `${n}/7`;
    el.handCount.classList.toggle('full', n >= 7);
    document.getElementById('herdBtn').classList.toggle('picked', G.sel.camels > 0);
    document.getElementById('herdBtn').dataset.sel = G.sel.camels || '';

    el.table.classList.toggle('myturn', !!(v.legal && v.legal.yourTurn));
    el.table.classList.toggle('busy', G.busy);
    if (G.onSettled) G.onSettled();
  }

  function renderTray(node, p, isMe) {
    node.innerHTML = '';
    const key = isMe ? 'you' : 'opp';
    const already = seenBefore.tray[key];
    let placed = 0;
    const fresh = () => placed++ >= already;
    const byGood = {};
    for (const t of p.goodsTokens) (byGood[t.good] = byGood[t.good] || []).push(t.value);
    for (const g of Cards.GOODS) {
      if (!byGood[g]) continue;
      const stack = document.createElement('div');
      stack.className = 'tstack';
      stack.dataset.rect = (isMe ? 'trayg:you:' : 'trayg:opp:') + g;
      byGood[g].sort((a, b) => a - b).forEach((val, i) => {
        const t = Cards.tokenEl(g, val, { cls: 'mini' });
        t.style.setProperty('--i', i);
        if (fresh()) t.classList.add('just-in');
        stack.appendChild(t);
      });
      node.appendChild(stack);
    }
    if (p.camelToken) node.appendChild(Cards.camelTokenEl({ cls: 'mini' }));
    const sizes = p.bonusSizes || [];
    sizes.forEach((size, i) => {
      const known = p.bonusTokens && p.bonusTokens[i];
      const t = Cards.bonusEl(size, known ? known.value : null, { cls: 'mini' });
      node.appendChild(t);
    });
    seenBefore.tray[key] = placed;
    if (!node.children.length) node.innerHTML = '<span class="tempty">no tokens yet</span>';
  }

  /* ----------------------------------------------------------- animations */
  const htmlOf = (card, cls) => Cards.cardEl(card, { cls }).outerHTML;

  function destForHand(after, card, seat, v) {
    if (seat === v.you) return after.get('card:' + card.id) || after.get('hand');
    return after.get('opphand') || after.get('card:' + card.id);
  }

  async function animateGroup(evs, before, after) {
    const v = G.view;
    const jobs = [];
    const first = evs[0];

    switch (first.t) {
      case 'deal': {
        const deck = before.get('deck');
        evs.forEach((ev, i) => {
          const to = ev.to;
          let dest, faceUp = true;
          if (to.zone === 'market') dest = after.get('card:' + ev.card.id);
          else if (to.zone === 'herd') { dest = after.get('herd:' + (to.seat === v.you ? 'you' : 'opp')); }
          else { dest = destForHand(after, ev.card, to.seat, v); faceUp = to.seat === v.you; }
          jobs.push(FX.fly({
            html: htmlOf(ev.card.good ? ev.card : { id: ev.card.id, good: null }),
            from: deck, to: dest, delay: i * 70, dur: 480, flip: faceUp,
            spin: faceUp ? 0 : 180, arc: -70, land: false,
          }));
          setTimeout(() => FX.SFX.card(), i * 70);
        });
        break;
      }

      case 'take': {
        const ev = first;
        const src = before.get('card:' + ev.card.id);
        const dest = destForHand(after, ev.card, ev.seat, v);
        jobs.push(FX.fly({
          html: htmlOf(ev.card), from: src, to: dest, dur: 560, trail: true,
          spin: ev.seat === v.you ? 0 : 180, landCol: '#ffe9a8',
        }));
        FX.SFX.take();
        break;
      }

      case 'camels': {
        const ev = first;
        const dest = after.get('herd:' + (ev.seat === v.you ? 'you' : 'opp'));
        ev.cards.forEach((card, i) => {
          jobs.push(FX.fly({
            html: htmlOf(card), from: before.get('card:' + card.id), to: dest,
            dur: 620, delay: i * 90, spin: 360, arc: -150, trail: true, landCol: '#e7c48a',
          }));
        });
        FX.SFX.camel();
        FX.stampede(ev.seat === v.you ? 1 : -1);
        FX.shake(1.1);
        break;
      }

      case 'exchange': {
        const ev = first;
        ev.taken.forEach((t, i) => {
          jobs.push(FX.fly({
            html: htmlOf(t.card), from: before.get('card:' + t.card.id),
            to: destForHand(after, t.card, ev.seat, v),
            dur: 600, delay: i * 60, arc: -130, spin: ev.seat === v.you ? 0 : 180, trail: true,
          }));
        });
        ev.placed.forEach((p, i) => {
          const src = p.fromHerd
            ? before.get('herd:' + (ev.seat === v.you ? 'you' : 'opp'))
            : (before.get('card:' + p.card.id) || before.get(ev.seat === v.you ? 'hand' : 'opphand'));
          jobs.push(FX.fly({
            html: htmlOf(p.card), from: src, to: after.get('card:' + p.card.id),
            dur: 600, delay: i * 60, arc: 130, spin: -180, sway: 30, land: false,
          }));
        });
        FX.SFX.take();
        FX.flash('rgba(160,220,255,.16)', 320);
        break;
      }

      case 'sell': {
        const ev = first;
        const mine = ev.seat === v.you;
        const hub = before.get('market') || FX.rectOf('#market');
        const tray = after.get(mine ? 'trayg:you:' + ev.good : 'trayg:opp:' + ev.good)
          || after.get(mine ? 'tokens:you' : 'tokens:opp');

        // 1. the sold cards sweep into the middle of the table
        await Promise.all(ev.cards.map((card, i) => FX.fly({
          html: htmlOf(card),
          from: before.get('card:' + card.id) || before.get(mine ? 'hand' : 'opphand'),
          to: { left: hub.left + hub.width / 2 - 36, top: hub.top + hub.height / 2 - 50, width: 72, height: 100 },
          dur: 430, delay: i * 55, arc: mine ? -110 : 110, spin: 180 * (i % 2 ? 1 : -1), land: false,
        })));

        // 2. they implode and pay out
        const cx = hub.left + hub.width / 2, cy = hub.top + hub.height / 2;
        FX.burst(cx, cy, { n: 40, vmin: 120, vmax: 520, ring: 150, col: ['#ffe9a8', '#f0b429', '#fff'] });
        FX.shake(0.7);
        FX.SFX.coin();
        if (tray) FX.coinsTo({ left: cx - 20, top: cy - 20, width: 40, height: 40 }, tray,
          Math.max(4, ev.tokens.length * 4));
        await FX.sleep(360);

        // 3. bonus token fanfare
        if (ev.bonus && !ev.bonus.empty) {
          FX.flash('rgba(255,215,120,.4)', 520);
          FX.SFX.bonus();
          FX.burst(cx, cy - 30, { n: 56, vmin: 160, vmax: 640, ring: 200, col: ['#fff3c4', '#f0b429', '#e0489b'] });
          FX.shake(1.4);
          FX.ticker(`${v.players[ev.seat].name} claimed a ${ev.bonus.size}-card bonus token!`);
        } else if (ev.bonus && ev.bonus.empty) {
          FX.ticker(`${ev.bonus.size}-card bonus tokens are gone — no bonus paid.`);
        }
        const pointsEl = mine ? el.youPoints : el.oppPoints;
        FX.pop(pointsEl, 1.3);
        FX.pop(mine ? el.youTokens : el.oppTokens, 1.05);
        FX.ticker(`${v.players[ev.seat].name} sold ${ev.cards.length}× ${Cards.META[ev.good].short} for ${ev.tokens.reduce((a, t) => a + t.value, 0)} rupees.`);
        break;
      }

      case 'refill': {
        const deck = before.get('deck');
        evs.forEach((ev, i) => {
          jobs.push(FX.fly({
            html: htmlOf(ev.card), from: deck, to: after.get('card:' + ev.card.id),
            dur: 460, delay: i * 90, flip: true, arc: -60, land: false,
          }));
          setTimeout(() => FX.SFX.card(), i * 90);
        });
        break;
      }

      case 'turn': {
        const ev = first;
        const mineTurn = ev.seat === v.you;
        FX.SFX.turn();
        jobs.push(FX.banner(mineTurn ? 'Your turn' : `${v.players[ev.seat].name}'s turn`,
          mineTurn ? 'mine' : 'theirs'));
        break;
      }

      case 'round_start': {
        FX.banner(`Round ${first.round}`, 'round');
        FX.flash('rgba(255,200,120,.22)', 600);
        await FX.sleep(420);
        break;
      }

      case 'round_end':
      case 'match_end':
        break;

      default:
        break;
    }
    await Promise.all(jobs);
  }

  /* ------------------------------------------------------- the event queue */
  // Inbound updates are buffered; input stays locked until the queue drains so
  // the board never changes underneath an animation.
  function handle(payload) {
    G.queue.push(payload);
    if (!G.busy) drain();
  }

  // No animation may hold the board hostage. Each group races a hard deadline,
  // and `busy` is cleared in a finally so a thrown render can never freeze play.
  const GROUP_DEADLINE_MS = 7000;
  function bounded(promise, ms) {
    return Promise.race([
      Promise.resolve(promise).catch(() => {}),
      new Promise((r) => setTimeout(r, ms)),
    ]);
  }

  async function drain() {
    G.busy = true;
    try {
      while (G.queue.length) {
        const { view, events, meta } = G.queue.shift();
        if (!G.view) { G.view = clone(view); render(); }
        G.server = view;

        if (meta && meta.say) showSay(meta.say);

        // A hidden tab pauses every animation. Skip straight to the result and
        // let the player pick the board back up when they return.
        const silent = FX.hidden;
        const groups = groupEvents(events || []);
        for (const grp of groups) {
          const before = silent ? new Map() : FX.snapshot();
          for (const ev of grp) {
            try { applyEv(G.view, ev); } catch (e) { G.view = clone(G.server); }
          }
          render();
          if (!silent) {
            const after = FX.snapshot();
            await bounded(animateGroup(grp, before, after), GROUP_DEADLINE_MS);
          }

          const terminal = grp.find((e) => e.t === 'round_end' || e.t === 'match_end');
          if (terminal) {
            G.view = clone(G.server);
            render();
            if (terminal.t === 'round_end' && G.onRoundEnd) {
              await bounded(G.onRoundEnd(terminal.result, G.server), GROUP_DEADLINE_MS);
            }
            if (terminal.t === 'match_end' && G.onMatchEnd) {
              await bounded(G.onMatchEnd(terminal, G.server), GROUP_DEADLINE_MS);
            }
          }
        }

        // Snap to the authoritative view; it is the source of truth for `legal`.
        G.view = clone(G.server);
        clearSelection();
        FX.purgeGhosts();
        render();
      }
    } finally {
      G.busy = false;
      FX.purgeGhosts();
      render();
    }
  }

  // Consecutive same-kind card motions animate together (dealing, refilling).
  function groupEvents(events) {
    const out = [];
    for (const ev of events) {
      const last = out[out.length - 1];
      const groupable = ev.t === 'deal' || ev.t === 'refill';
      if (last && groupable && last[0].t === ev.t) last.push(ev);
      else out.push([ev]);
    }
    return out;
  }

  let sayTimer = null;
  function showSay(text) {
    el.oppSay.textContent = text;
    el.oppSay.classList.add('show');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => el.oppSay.classList.remove('show'), 2600);
  }

  function clearSelection() {
    G.sel.market.clear();
    G.sel.hand.clear();
    G.sel.camels = 0;
  }

  function setView(view) {
    seenBefore.hand = new Set();
    seenBefore.opp = 0;
    seenBefore.tray = { you: 0, opp: 0 };
    G.view = clone(view);
    G.server = view;
    clearSelection();
    render();
  }

  // Coming back to a tab that was hidden mid-animation: take the server's word
  // for the board and carry on.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && G.server && !G.busy) {
      FX.purgeGhosts();
      setView(G.server);
    }
  });

  w.Game = { G, setView, handle, render, clearSelection, applyEv, el, showSay };
})(window);
