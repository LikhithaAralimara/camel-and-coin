'use strict';
/*
 * Jaipur game engine — pure logic, zero I/O.
 *
 *   createMatch(opts)                  -> MatchState
 *   legalActions(state, seat)          -> Action[]
 *   applyAction(state, seat, action)   -> { ok, error? , events? }
 *   startNextRound(state)              -> { ok, events? }
 *   serializeFor(state, seat)          -> view object safe to send to that seat
 *
 * Every mutating call returns an ORDERED event list. The client replays those
 * events as animations, so the server must describe *what moved where*, never
 * just the resulting snapshot.
 */

const R = require('./rules');

/* ------------------------------------------------------------------ random */
// Deterministic PRNG kept inside the state so games are reproducible in tests.
function rand(state) {
  let a = state.rngState | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  state.rngState = a;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ------------------------------------------------------------------ setup */
function freshDeck(state) {
  const deck = [];
  let n = 0;
  for (const good of Object.keys(R.DECK_COUNTS)) {
    for (let i = 0; i < R.DECK_COUNTS[good]; i++) {
      deck.push({ id: `${good}-${i}-${state.round}-${n++}`, good });
    }
  }
  return shuffle(state, deck);
}

function freshTokens() {
  const t = {};
  for (const g of R.GOODS) t[g] = R.GOODS_TOKENS[g].slice();
  return t;
}

function createMatch(opts = {}) {
  const state = {
    id: opts.id || 'local',
    seed: (opts.seed === undefined ? (Math.random() * 2 ** 32) >>> 0 : opts.seed) >>> 0,
    rngState: 0,
    round: 0,
    seals: [0, 0],
    matchOver: false,
    matchWinner: null,
    players: [0, 1].map((i) => ({
      name: (opts.names && opts.names[i]) || `Trader ${i + 1}`,
      isBot: !!(opts.bots && opts.bots[i]),
      hand: [],
      herd: 0,
      goodsTokens: [],   // { good, value }
      bonusTokens: [],   // { size, value }  -- SECRET until round end
      camelToken: false,
    })),
    market: [],
    deck: [],
    tokens: freshTokens(),
    bonus: {},
    turn: 0,
    roundOver: false,
    roundResult: null,
    history: [],
  };
  state.rngState = state.seed;
  const events = beginRound(state, 0);
  return { state, events };
}

// Full reset between rounds: deck reshuffled, all tokens returned, hands redealt.
// Seals persist. The player who did NOT start last round starts this one.
function beginRound(state, firstSeat) {
  state.round += 1;
  state.roundOver = false;
  state.roundResult = null;
  state.tokens = freshTokens();
  state.bonus = {};
  for (const size of [3, 4, 5]) state.bonus[size] = shuffle(state, R.BONUS_TOKENS[size].slice());
  state.deck = freshDeck(state);
  state.market = [];
  for (const p of state.players) {
    p.hand = [];
    p.herd = 0;
    p.goodsTokens = [];
    p.bonusTokens = [];
    p.camelToken = false;
  }
  state.turn = firstSeat;
  state.firstSeat = firstSeat;

  const events = [{ t: 'round_start', round: state.round, first: firstSeat }];

  // Three camels are pulled out of the deck and placed in the market.
  for (let i = 0; i < R.START_MARKET_CAMELS; i++) {
    const idx = state.deck.findIndex((c) => c.good === R.CAMEL);
    const camel = state.deck.splice(idx, 1)[0];
    state.market.push(camel);
    events.push({ t: 'deal', card: camel, to: { zone: 'market', slot: state.market.length - 1 } });
  }
  // Deal 5 to each player, alternating, starting with the first player.
  for (let i = 0; i < R.START_HAND; i++) {
    for (let k = 0; k < 2; k++) {
      const seat = (firstSeat + k) % 2;
      const card = state.deck.pop();
      if (card.good === R.CAMEL) {
        state.players[seat].herd += 1;
        events.push({ t: 'deal', card, to: { zone: 'herd', seat } });
      } else {
        state.players[seat].hand.push(card);
        events.push({ t: 'deal', card, to: { zone: 'hand', seat } });
      }
    }
  }
  // Top up the market to five.
  while (state.market.length < R.MARKET_SIZE) {
    const card = state.deck.pop();
    state.market.push(card);
    events.push({ t: 'deal', card, to: { zone: 'market', slot: state.market.length - 1 } });
  }
  events.push({ t: 'turn', seat: state.turn });
  return events;
}

/* ------------------------------------------------------------------ helpers */
const handCount = (p, good) => p.hand.filter((c) => c.good === good).length;
const marketCamels = (s) => s.market.filter((c) => c && c.good === R.CAMEL);
const marketGoods = (s) => s.market.filter((c) => c && c.good !== R.CAMEL);
const emptyPileCount = (s) => R.GOODS.filter((g) => s.tokens[g].length === 0).length;

/* ---------------------------------------------------------- legal actions */
function legalActions(state, seat) {
  if (state.roundOver || state.matchOver || state.turn !== seat) return [];
  const p = state.players[seat];
  const out = [];

  // 1. Take a single goods card.
  if (p.hand.length < R.HAND_LIMIT) {
    state.market.forEach((c, slot) => {
      if (c && c.good !== R.CAMEL) out.push({ type: 'take', slot });
    });
  }
  // 2. Take every camel in the market.
  if (marketCamels(state).length > 0) out.push({ type: 'camels' });

  // 3. Sell.
  for (const g of R.GOODS) {
    const have = handCount(p, g);
    for (let n = R.MIN_SELL[g]; n <= have; n++) out.push({ type: 'sell', good: g, count: n });
  }

  // 4. Exchanges. Enumerated by (multiset of goods given, multiset taken) so the
  //    list stays small; the bot and the UI both consume this.
  const takeable = [];
  state.market.forEach((c, slot) => { if (c && c.good !== R.CAMEL) takeable.push(slot); });
  const giveableCards = p.hand.slice();
  const maxSwap = Math.min(takeable.length, giveableCards.length + p.herd);
  for (let n = 2; n <= maxSwap; n++) {
    for (const takeSet of combinations(takeable, n)) {
      const takenGoods = new Set(takeSet.map((s) => state.market[s].good));
      // Camels are always legal to give; hand cards must not duplicate a taken type.
      const legalHand = giveableCards.filter((c) => !takenGoods.has(c.good));
      for (let camels = Math.max(0, n - legalHand.length); camels <= Math.min(p.herd, n); camels++) {
        const fromHand = n - camels;
        if (fromHand < 0 || fromHand > legalHand.length) continue;
        if (p.hand.length - fromHand + n > R.HAND_LIMIT) continue;
        for (const giveSet of combinations(legalHand.map((c) => c.id), fromHand)) {
          out.push({ type: 'exchange', give: giveSet, camels, takeSlots: takeSet });
        }
      }
    }
  }
  return out;
}

function combinations(arr, k) {
  const res = [];
  if (k < 0 || k > arr.length) return res;
  if (k === 0) return [[]];
  const pick = (start, acc) => {
    if (acc.length === k) { res.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return res;
}

/* ------------------------------------------------------------ apply action */
function applyAction(state, seat, action) {
  if (state.matchOver) return { ok: false, error: 'The match is already over.' };
  if (state.roundOver) return { ok: false, error: 'The round is over.' };
  if (state.turn !== seat) return { ok: false, error: 'It is not your turn.' };

  const p = state.players[seat];
  const events = [];

  switch (action && action.type) {
    case 'take': {
      const slot = action.slot;
      const card = state.market[slot];
      if (!card) return { ok: false, error: 'That market slot is empty.' };
      if (card.good === R.CAMEL) return { ok: false, error: 'Use "take all camels" for camels.' };
      if (p.hand.length >= R.HAND_LIMIT) return { ok: false, error: 'Your hand is full (7 cards).' };
      state.market[slot] = null;
      p.hand.push(card);
      events.push({ t: 'take', seat, card, slot });
      break;
    }

    case 'camels': {
      const camels = [];
      const slots = [];
      state.market.forEach((c, i) => {
        if (c && c.good === R.CAMEL) { camels.push(c); slots.push(i); state.market[i] = null; }
      });
      if (!camels.length) return { ok: false, error: 'There are no camels in the market.' };
      p.herd += camels.length;
      events.push({ t: 'camels', seat, cards: camels, slots });
      break;
    }

    case 'exchange': {
      const give = Array.isArray(action.give) ? action.give.slice() : [];
      const camels = action.camels | 0;
      const takeSlots = Array.isArray(action.takeSlots) ? action.takeSlots.slice() : [];
      const n = give.length + camels;
      if (n !== takeSlots.length) return { ok: false, error: 'Give and take the same number of cards.' };
      if (n < 2) return { ok: false, error: 'An exchange needs at least two cards.' };
      if (camels < 0 || camels > p.herd) return { ok: false, error: 'You do not have that many camels.' };
      if (new Set(takeSlots).size !== takeSlots.length) return { ok: false, error: 'Duplicate market slot.' };
      if (new Set(give).size !== give.length) return { ok: false, error: 'Duplicate card offered.' };

      const taken = [];
      for (const slot of takeSlots) {
        const c = state.market[slot];
        if (!c) return { ok: false, error: 'That market slot is empty.' };
        if (c.good === R.CAMEL) return { ok: false, error: 'Camels cannot be taken in an exchange.' };
        taken.push(c);
      }
      const givenCards = [];
      for (const id of give) {
        const c = p.hand.find((x) => x.id === id);
        if (!c) return { ok: false, error: 'You do not hold that card.' };
        givenCards.push(c);
      }
      // Standard restriction: you may not hand back a goods type you are taking.
      const takenGoods = new Set(taken.map((c) => c.good));
      for (const c of givenCards) {
        if (takenGoods.has(c.good)) {
          return { ok: false, error: `You cannot trade ${c.good} for ${c.good}.` };
        }
      }
      if (p.hand.length - givenCards.length + taken.length > R.HAND_LIMIT) {
        return { ok: false, error: 'That exchange would overfill your hand.' };
      }

      // Cards go into the exact slots they came out of.
      const giveQueue = givenCards.slice();
      const placed = [];
      for (const slot of takeSlots) {
        if (giveQueue.length) {
          const c = giveQueue.shift();
          state.market[slot] = c;
          placed.push({ card: c, slot, fromHerd: false });
        } else {
          const camel = { id: `camel-herd-${state.round}-${seat}-${slot}-${(rand(state) * 1e9) | 0}`, good: R.CAMEL };
          state.market[slot] = camel;
          placed.push({ card: camel, slot, fromHerd: true });
        }
      }
      p.herd -= camels;
      p.hand = p.hand.filter((c) => !give.includes(c.id));
      for (const c of taken) p.hand.push(c);
      events.push({
        t: 'exchange', seat, camels,
        taken: taken.map((c, i) => ({ card: c, slot: takeSlots[i] })),
        placed,
      });
      break;
    }

    case 'sell': {
      const good = action.good;
      if (!R.GOODS.includes(good)) return { ok: false, error: 'Unknown goods type.' };
      const owned = p.hand.filter((c) => c.good === good);
      const count = action.count === undefined ? owned.length : action.count | 0;
      if (count < R.MIN_SELL[good]) {
        return { ok: false, error: `${good} must be sold ${R.MIN_SELL[good]} at a time or more.` };
      }
      if (count > owned.length) return { ok: false, error: `You only hold ${owned.length} ${good}.` };

      const sold = owned.slice(0, count);
      const soldIds = new Set(sold.map((c) => c.id));
      p.hand = p.hand.filter((c) => !soldIds.has(c.id));

      // Highest-value tokens first. A short pile simply pays out what is left.
      const paid = [];
      for (let i = 0; i < count && state.tokens[good].length; i++) {
        paid.push({ good, value: state.tokens[good].pop() });
      }
      p.goodsTokens.push(...paid);

      // Bonus token for 3, 4 or 5 cards in one sale. 6+ still draws from the
      // 5-card pile. Nothing extra if that pile is exhausted.
      let bonus = null;
      if (count >= 3) {
        const size = Math.min(count, 5);
        if (state.bonus[size] && state.bonus[size].length) {
          bonus = { size, value: state.bonus[size].pop() };
          p.bonusTokens.push(bonus);
        } else {
          bonus = { size, value: null, empty: true };
        }
      }
      events.push({
        t: 'sell', seat, good, cards: sold, tokens: paid,
        bonus, pilesLeft: state.tokens[good].length,
      });
      break;
    }

    default:
      return { ok: false, error: 'Unknown action.' };
  }

  // Refill the market at the end of any take/exchange (a sale never empties it).
  if (action.type !== 'sell') {
    for (let i = 0; i < R.MARKET_SIZE; i++) {
      if (state.market[i] == null && state.deck.length) {
        const card = state.deck.pop();
        state.market[i] = card;
        events.push({ t: 'refill', card, slot: i });
      }
    }
  }
  state.market = state.market.map((c) => c || null);

  // --- round-end checks, in rulebook order -------------------------------
  const piles = emptyPileCount(state);
  const marketShort = state.market.some((c) => c == null);
  if (piles >= R.EMPTY_PILES_TO_END || marketShort) {
    events.push(...endRound(state, piles >= R.EMPTY_PILES_TO_END ? 'three_piles' : 'deck_empty'));
  } else {
    state.turn = 1 - seat;
    events.push({ t: 'turn', seat: state.turn });
  }

  state.history.push({ seat, action });
  return { ok: true, events };
}

/* --------------------------------------------------------------- round end */
function endRound(state, reason) {
  state.roundOver = true;
  const [a, b] = state.players;

  // Camel token: 5 points to whoever has the most camels; nobody on a tie.
  let camelSeat = null;
  if (a.herd > b.herd) camelSeat = 0;
  else if (b.herd > a.herd) camelSeat = 1;
  if (camelSeat !== null) state.players[camelSeat].camelToken = true;

  const score = (p) => {
    const goods = p.goodsTokens.reduce((s, t) => s + t.value, 0);
    const bonus = p.bonusTokens.reduce((s, t) => s + t.value, 0);
    const camel = p.camelToken ? R.CAMEL_TOKEN_VALUE : 0;
    return { goods, bonus, camel, total: goods + bonus + camel };
  };
  const scores = [score(a), score(b)];

  // points -> most bonus tokens -> most goods tokens -> camel token holder
  let winner = null;
  if (scores[0].total !== scores[1].total) {
    winner = scores[0].total > scores[1].total ? 0 : 1;
  } else if (a.bonusTokens.length !== b.bonusTokens.length) {
    winner = a.bonusTokens.length > b.bonusTokens.length ? 0 : 1;
  } else if (a.goodsTokens.length !== b.goodsTokens.length) {
    winner = a.goodsTokens.length > b.goodsTokens.length ? 0 : 1;
  } else if (a.camelToken !== b.camelToken) {
    winner = a.camelToken ? 0 : 1;
  }

  if (winner !== null) state.seals[winner] += 1;
  state.roundResult = {
    round: state.round, reason, winner, camelSeat, scores,
    seals: state.seals.slice(),
    reveal: state.players.map((p) => ({
      goodsTokens: p.goodsTokens.slice(),
      bonusTokens: p.bonusTokens.slice(),
      camelToken: p.camelToken,
      herd: p.herd,
      hand: p.hand.slice(),
    })),
  };

  const events = [{ t: 'round_end', result: state.roundResult }];

  if (state.seals[0] >= R.SEALS_TO_WIN || state.seals[1] >= R.SEALS_TO_WIN) {
    state.matchOver = true;
    state.matchWinner = state.seals[0] >= R.SEALS_TO_WIN ? 0 : 1;
    events.push({ t: 'match_end', winner: state.matchWinner, seals: state.seals.slice() });
  } else if (state.round >= 3) {
    // Three rounds played without anyone reaching two seals (only possible with
    // a drawn round) -> most seals wins, otherwise the match is a draw.
    state.matchOver = true;
    state.matchWinner = state.seals[0] === state.seals[1]
      ? null
      : (state.seals[0] > state.seals[1] ? 0 : 1);
    events.push({ t: 'match_end', winner: state.matchWinner, seals: state.seals.slice(), draw: state.matchWinner === null });
  }
  return events;
}

function startNextRound(state) {
  if (state.matchOver) return { ok: false, error: 'The match is over.' };
  if (!state.roundOver) return { ok: false, error: 'The round is still running.' };
  return { ok: true, events: beginRound(state, 1 - state.firstSeat) };
}

/* -------------------------------------------------------------- serialize */
// The ONLY path from state to a client. Hidden information never crosses it.
// A seat of -1 is a spectator: both hands, and both sets of bonus token VALUES,
// stay hidden from them until the round ends.
function serializeFor(state, seat) {
  const spectator = !(seat === 0 || seat === 1);
  const view = spectator ? 0 : seat;
  const pub = (p, isMe) => ({
    name: p.name,
    isBot: p.isBot,
    herd: p.herd,
    handCount: p.hand.length,
    goodsTokens: p.goodsTokens.slice(),           // face up
    bonusCount: p.bonusTokens.length,             // count only...
    bonusSizes: p.bonusTokens.map((t) => t.size), // ...plus which pile it came from
    bonusTokens: isMe || state.roundOver ? p.bonusTokens.slice() : undefined,
    camelToken: p.camelToken,
    visiblePoints: p.goodsTokens.reduce((s, t) => s + t.value, 0)
      + (p.camelToken ? R.CAMEL_TOKEN_VALUE : 0),
  });
  return {
    matchId: state.id,
    you: view,
    spectator,
    round: state.round,
    seals: state.seals.slice(),
    turn: state.turn,
    roundOver: state.roundOver,
    matchOver: state.matchOver,
    matchWinner: state.matchWinner,
    roundResult: state.roundResult,
    market: state.market.map((c) => (c ? { id: c.id, good: c.good } : null)),
    deckCount: state.deck.length,
    tokens: R.GOODS.reduce((o, g) => { o[g] = state.tokens[g].slice(); return o; }, {}),
    bonusCounts: { 3: state.bonus[3].length, 4: state.bonus[4].length, 5: state.bonus[5].length },
    hand: spectator ? [] : state.players[view].hand.map((c) => ({ id: c.id, good: c.good })),
    players: [
      pub(state.players[0], !spectator && view === 0),
      pub(state.players[1], !spectator && view === 1),
    ],
    legal: spectator
      ? { yourTurn: false, take: [], camels: false, sell: {}, canExchange: false }
      : legalActionSummary(state, view),
  };
}

// Compact affordances for the UI (full exchange enumeration is too big to ship).
function legalActionSummary(state, seat) {
  if (state.turn !== seat || state.roundOver || state.matchOver) {
    return { yourTurn: false, take: [], camels: false, sell: {}, canExchange: false };
  }
  const p = state.players[seat];
  const sell = {};
  for (const g of R.GOODS) {
    const have = handCount(p, g);
    if (have >= R.MIN_SELL[g]) sell[g] = { min: R.MIN_SELL[g], max: have };
  }
  return {
    yourTurn: true,
    take: p.hand.length < R.HAND_LIMIT
      ? state.market.map((c, i) => (c && c.good !== R.CAMEL ? i : -1)).filter((i) => i >= 0)
      : [],
    camels: marketCamels(state).length > 0,
    sell,
    canExchange: marketGoods(state).length >= 2 && (p.hand.length + p.herd) >= 2,
    handLimit: R.HAND_LIMIT,
  };
}

module.exports = {
  createMatch, beginRound, startNextRound, applyAction, legalActions,
  serializeFor, legalActionSummary, rand, shuffle, handCount, R,
};

/* ---------------------------------------------------------------- redaction */
// Events travel to both clients so they can animate the same motion, but the
// face-down parts must be stripped per recipient:
//   - cards dealt into the opponent's HAND are face down (herd/market are not)
//   - the opponent's bonus token value stays secret until the round ends
function redactEvents(events, forSeat) {
  return events.map((ev) => {
    if (ev.t === 'deal' && ev.to && ev.to.zone === 'hand' && ev.to.seat !== forSeat) {
      return { ...ev, card: { id: ev.card.id, good: null, faceDown: true } };
    }
    if (ev.t === 'sell' && ev.seat !== forSeat && ev.bonus) {
      return { ...ev, bonus: { size: ev.bonus.size, value: null, hidden: !ev.bonus.empty, empty: !!ev.bonus.empty } };
    }
    return ev;
  });
}
module.exports.redactEvents = redactEvents;
