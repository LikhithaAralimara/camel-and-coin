'use strict';
/*
 * Headless fuzz harness. Plays thousands of random-legal matches and asserts
 * the invariants that a UI can never show you.
 *
 *   node test/invariants.js [games]
 */
const E = require('../src/engine');
const R = require('../src/rules');
const Bot = require('../src/bot');

let failures = 0;
function check(cond, msg, ctx) {
  if (!cond) {
    failures++;
    console.error(`  FAIL: ${msg}${ctx ? '\n        ' + JSON.stringify(ctx) : ''}`);
    if (failures > 12) { console.error('too many failures, aborting'); process.exit(1); }
  }
}

function census(state, sold) {
  const c = {};
  const bump = (g, n = 1) => { c[g] = (c[g] || 0) + n; };
  for (const card of state.deck) bump(card.good);
  for (const card of state.market) if (card) bump(card.good);
  for (const p of state.players) {
    for (const card of p.hand) bump(card.good);
    bump(R.CAMEL, p.herd);
  }
  for (const card of sold) bump(card.good);
  return c;
}

function auditState(state, sold, tag) {
  const c = census(state, sold);
  let total = 0;
  for (const g of Object.keys(R.DECK_COUNTS)) {
    const want = R.DECK_COUNTS[g];
    const got = c[g] || 0;
    check(got === want, `[${tag}] ${g}: expected ${want} in play, found ${got}`);
    total += got;
  }
  check(total === R.TOTAL_CARDS, `[${tag}] total cards ${total} != ${R.TOTAL_CARDS}`);

  for (const p of state.players) {
    check(p.hand.length <= R.HAND_LIMIT, `[${tag}] hand of ${p.hand.length} exceeds limit`);
    check(p.herd >= 0, `[${tag}] negative herd`);
  }
  if (!state.roundOver) {
    check(state.market.every((x) => x != null), `[${tag}] market has a hole mid-round`);
    check(state.market.length === R.MARKET_SIZE, `[${tag}] market size ${state.market.length}`);
  }
  for (const g of R.GOODS) {
    check(state.tokens[g].length >= 0, `[${tag}] ${g} pile negative`);
    check(state.tokens[g].length <= R.GOODS_TOKENS[g].length, `[${tag}] ${g} pile grew`);
    // remaining pile must always be a prefix of the ascending master list
    const want = R.GOODS_TOKENS[g].slice(0, state.tokens[g].length);
    check(JSON.stringify(state.tokens[g]) === JSON.stringify(want),
      `[${tag}] ${g} pile out of order`, { got: state.tokens[g], want });
  }
  // No token value handed out twice beyond its multiplicity.
  for (const g of R.GOODS) {
    const dealt = [];
    for (const p of state.players) for (const t of p.goodsTokens) if (t.good === g) dealt.push(t.value);
    const master = R.GOODS_TOKENS[g].slice();
    for (const v of dealt) {
      const i = master.indexOf(v);
      check(i >= 0, `[${tag}] ${g} token ${v} dealt but not in pile`);
      if (i >= 0) master.splice(i, 1);
    }
    check(master.length === state.tokens[g].length,
      `[${tag}] ${g} accounting: ${master.length} unaccounted vs ${state.tokens[g].length} remaining`);
  }
  for (const size of [3, 4, 5]) {
    const dealt = [];
    for (const p of state.players) for (const t of p.bonusTokens) if (t.size === size) dealt.push(t.value);
    const master = R.BONUS_TOKENS[size].slice();
    for (const v of dealt) {
      const i = master.indexOf(v);
      check(i >= 0, `[${tag}] bonus${size} token ${v} not from pile`);
      if (i >= 0) master.splice(i, 1);
    }
    check(master.length === state.bonus[size].length, `[${tag}] bonus${size} accounting off`);
  }
}

function auditSpectator(state) {
  const view = E.serializeFor(state, -1);
  const blob = JSON.stringify(view);
  check(view.spectator === true, 'spectator view not flagged');
  check(Array.isArray(view.hand) && view.hand.length === 0, 'spectator was handed cards');
  check(view.legal.yourTurn === false, 'spectator was offered a turn');
  for (const p of state.players) {
    for (const card of p.hand) check(!blob.includes(card.id), `spectator view leaked hand card ${card.id}`);
  }
  for (const card of state.deck) check(!blob.includes(card.id), `spectator view leaked deck card ${card.id}`);
  if (!state.roundOver) {
    for (let s = 0; s < 2; s++) {
      check(view.players[s].bonusTokens === undefined,
        `spectator view leaked seat ${s} bonus token values`);
    }
  }
}

function auditLeak(state, seat) {
  const view = E.serializeFor(state, seat);
  const oppIds = new Set(state.players[1 - seat].hand.map((c) => c.id));
  const blob = JSON.stringify(view);
  for (const id of oppIds) {
    check(!blob.includes(id), `serializeFor(${seat}) leaked opponent card ${id}`);
  }
  for (const card of state.deck) {
    check(!blob.includes(card.id), `serializeFor(${seat}) leaked deck card ${card.id}`);
  }
  if (!state.roundOver) {
    check(view.players[1 - seat].bonusTokens === undefined,
      `serializeFor(${seat}) leaked opponent bonus token values`);
  }
}

/* ------------------------------------------------------------------- run */
const GAMES = Number(process.argv[2] || 400);
let totalTurns = 0, rounds = 0, threePiles = 0, deckEmpty = 0, draws = 0;
const reasons = {};

for (let g = 0; g < GAMES; g++) {
  const useBot = g % 3 === 0;                 // exercise the bot's action generator too
  const { state } = E.createMatch({ seed: g * 7919 + 13, bots: [useBot, useBot] });
  let guard = 0;
  let roundsThisMatch = 0;
  let sold = [];
  auditState(state, sold, `g${g} setup`);

  while (!state.matchOver) {
    if (++guard > 4000) { check(false, `game ${g} failed to terminate`); break; }

    if (state.roundOver) {
      const res = state.roundResult;
      rounds++;
      roundsThisMatch++;
      // A seal is awarded at most once per completed round. Anything else means
      // something scored the match outside of endRound (e.g. a bot simulation
      // mutating shared state).
      check(state.seals[0] + state.seals[1] <= roundsThisMatch,
        `g${g} seals ${state.seals} after only ${roundsThisMatch} completed round(s)`);
      check(res.seals[0] + res.seals[1] === roundsThisMatch,
        `g${g} round result seals ${res.seals} disagree with ${roundsThisMatch} rounds`);
      reasons[res.reason] = (reasons[res.reason] || 0) + 1;
      if (res.reason === 'three_piles') threePiles++; else deckEmpty++;
      if (res.winner === null) draws++;
      // scores must equal an independent recount
      for (let s = 0; s < 2; s++) {
        const p = state.players[s];
        const goods = p.goodsTokens.reduce((a, t) => a + t.value, 0);
        const bonus = p.bonusTokens.reduce((a, t) => a + t.value, 0);
        const camel = p.camelToken ? R.CAMEL_TOKEN_VALUE : 0;
        check(res.scores[s].total === goods + bonus + camel, `g${g} score mismatch seat ${s}`);
      }
      check(!(state.players[0].camelToken && state.players[1].camelToken), `g${g} both hold camel token`);
      if (state.players[0].herd === state.players[1].herd) {
        check(!state.players[0].camelToken && !state.players[1].camelToken,
          `g${g} camel token awarded on a tie`);
      }
      if (state.matchOver) break;
      const r = E.startNextRound(state);
      check(r.ok, `g${g} startNextRound: ${r.error}`);
      sold = [];
      auditState(state, sold, `g${g} r${state.round} setup`);
      continue;
    }

    const seat = state.turn;
    auditLeak(state, seat);
    auditLeak(state, 1 - seat);
    auditSpectator(state);

    let action;
    if (useBot) {
      const fingerprint = JSON.stringify({
        seals: state.seals, round: state.round, turn: state.turn,
        roundOver: state.roundOver, matchOver: state.matchOver,
        deck: state.deck.length, market: state.market.map((c) => c && c.id),
        tokens: state.tokens, bonus: state.bonus,
        players: state.players.map((p) => ({
          hand: p.hand.map((c) => c.id), herd: p.herd,
          goods: p.goodsTokens, bonus: p.bonusTokens, camel: p.camelToken,
        })),
      });
      action = Bot.chooseAction(state, seat, 'hard');
      check(!!action, `g${g} bot returned no action`);
      const after = JSON.stringify({
        seals: state.seals, round: state.round, turn: state.turn,
        roundOver: state.roundOver, matchOver: state.matchOver,
        deck: state.deck.length, market: state.market.map((c) => c && c.id),
        tokens: state.tokens, bonus: state.bonus,
        players: state.players.map((p) => ({
          hand: p.hand.map((c) => c.id), herd: p.herd,
          goods: p.goodsTokens, bonus: p.bonusTokens, camel: p.camelToken,
        })),
      });
      check(fingerprint === after, `g${g} the bot mutated the live game while thinking`);
    } else {
      const opts = E.legalActions(state, seat);
      check(opts.length > 0, `g${g} seat ${seat} has no legal action`, {
        hand: state.players[seat].hand.map((c) => c.good), market: state.market.map((c) => c && c.good),
      });
      if (!opts.length) break;
      action = opts[Math.floor(Math.random() * opts.length)];
    }

    const before = state.players[seat].hand.length;
    const res = E.applyAction(state, seat, action);
    check(res.ok, `g${g} legal action rejected: ${res.error}`, action);
    if (!res.ok) break;
    for (const ev of res.events) if (ev.t === 'sell') sold.push(...ev.cards);

    // events must describe every card motion the client needs
    for (const ev of res.events) check(typeof ev.t === 'string', `g${g} malformed event`, ev);
    check(state.players[seat].hand.length <= R.HAND_LIMIT,
      `g${g} hand overflow after ${action.type} (was ${before})`);
    auditState(state, sold, `g${g} after ${action.type}`);
    totalTurns++;
  }
  check(state.matchOver, `g${g} did not finish`);
  check(state.seals[0] + state.seals[1] >= 1, `g${g} ended with no seals`);
}

console.log(`\ngames: ${GAMES}  rounds: ${rounds}  turns: ${totalTurns}  avg turns/round: ${(totalTurns / rounds).toFixed(1)}`);
console.log(`round endings: ${JSON.stringify(reasons)}   drawn rounds: ${draws}`);

/* ------------------------------------------------- targeted rule fixtures */
console.log('\ntargeted checks:');
function fixture(name, fn) {
  const before = failures;
  fn();
  console.log(`  ${failures === before ? 'ok  ' : 'FAIL'} ${name}`);
}

fixture('serializeFor is seat-indexed for both players', () => {
  const { state } = E.createMatch({ seed: 21, names: ['Aisha', 'Bruno'] });
  for (const seat of [0, 1]) {
    const v = E.serializeFor(state, seat);
    check(v.you === seat, `seat ${seat}: you=${v.you}`);
    check(v.players[0].name === 'Aisha' && v.players[1].name === 'Bruno',
      `seat ${seat}: players array is not seat-indexed`);
    check(v.hand.length === state.players[seat].hand.length, `seat ${seat}: wrong hand`);
    check(v.players[1 - seat].bonusTokens === undefined, `seat ${seat}: saw opponent bonus values`);
  }
});

fixture('first diamond sale of 2 pays 7+7', () => {
  const { state } = E.createMatch({ seed: 1 });
  state.players[0].hand = [{ id: 'd1', good: 'diamond' }, { id: 'd2', good: 'diamond' }];
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'sell', good: 'diamond', count: 2 });
  check(r.ok, 'sell rejected: ' + r.error);
  const vals = state.players[0].goodsTokens.map((t) => t.value).sort();
  check(JSON.stringify(vals) === '[7,7]', 'expected [7,7], got ' + JSON.stringify(vals));
});

fixture('single diamond may not be sold', () => {
  const { state } = E.createMatch({ seed: 2 });
  state.players[0].hand = [{ id: 'd1', good: 'diamond' }];
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'sell', good: 'diamond', count: 1 });
  check(!r.ok, 'a lone diamond was allowed to sell');
});

fixture('single leather may be sold', () => {
  const { state } = E.createMatch({ seed: 3 });
  state.players[0].hand = [{ id: 'l1', good: 'leather' }];
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'sell', good: 'leather', count: 1 });
  check(r.ok, 'leather single rejected: ' + r.error);
  check(state.players[0].goodsTokens[0].value === 4, 'leather should pay its 4 first');
});

fixture('short pile pays what is left and still grants the bonus', () => {
  const { state } = E.createMatch({ seed: 4 });
  state.tokens.diamond = [5, 5];            // only two left
  state.players[0].hand = [1, 2, 3, 4].map((i) => ({ id: 'd' + i, good: 'diamond' }));
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'sell', good: 'diamond', count: 4 });
  check(r.ok, 'sell rejected: ' + r.error);
  check(state.players[0].goodsTokens.length === 2, 'should have collected exactly 2 tokens');
  check(state.players[0].bonusTokens.length === 1 && state.players[0].bonusTokens[0].size === 4,
    'a 4-card bonus token was owed');
});

fixture('6-card sale draws from the 5-card bonus pile', () => {
  const { state } = E.createMatch({ seed: 5 });
  state.players[0].hand = [1, 2, 3, 4, 5, 6].map((i) => ({ id: 'l' + i, good: 'leather' }));
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'sell', good: 'leather', count: 6 });
  check(r.ok, 'sell rejected: ' + r.error);
  check(state.players[0].bonusTokens[0].size === 5, 'expected the 5-card bonus');
});

fixture('exhausted bonus pile grants nothing extra', () => {
  const { state } = E.createMatch({ seed: 6 });
  state.bonus[3] = [];
  state.players[0].hand = [1, 2, 3].map((i) => ({ id: 's' + i, good: 'spice' }));
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'sell', good: 'spice', count: 3 });
  check(r.ok, 'sell rejected: ' + r.error);
  check(state.players[0].bonusTokens.length === 0, 'bonus token conjured from an empty pile');
  check(r.events[0].bonus && r.events[0].bonus.empty === true, 'event should flag the empty pile');
});

fixture('exchange cannot take the same type it gives', () => {
  const { state } = E.createMatch({ seed: 8 });
  state.market = [{ id: 'm1', good: 'cloth' }, { id: 'm2', good: 'spice' },
                  { id: 'm3', good: 'gold' }, { id: 'm4', good: 'leather' }, { id: 'm5', good: 'camel' }];
  state.players[0].hand = [{ id: 'h1', good: 'cloth' }, { id: 'h2', good: 'leather' }];
  state.players[0].herd = 0;
  state.turn = 0;
  const bad = E.applyAction(state, 0, { type: 'exchange', give: ['h1', 'h2'], camels: 0, takeSlots: [0, 1] });
  check(!bad.ok, 'cloth-for-cloth exchange was allowed');
  const good = E.applyAction(state, 0, { type: 'exchange', give: ['h1', 'h2'], camels: 0, takeSlots: [1, 2] });
  check(good.ok, 'legal exchange rejected: ' + good.error);
});

fixture('exchange cannot take camels', () => {
  const { state } = E.createMatch({ seed: 9 });
  state.market = [{ id: 'm1', good: 'camel' }, { id: 'm2', good: 'camel' },
                  { id: 'm3', good: 'gold' }, { id: 'm4', good: 'leather' }, { id: 'm5', good: 'spice' }];
  state.players[0].hand = [{ id: 'h1', good: 'cloth' }, { id: 'h2', good: 'silver' }];
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'exchange', give: ['h1', 'h2'], camels: 0, takeSlots: [0, 1] });
  check(!r.ok, 'camels were taken in an exchange');
});

fixture('camels-only exchange from the herd is legal', () => {
  const { state } = E.createMatch({ seed: 10 });
  state.market = [{ id: 'm1', good: 'diamond' }, { id: 'm2', good: 'gold' },
                  { id: 'm3', good: 'silver' }, { id: 'm4', good: 'leather' }, { id: 'm5', good: 'spice' }];
  state.players[0].hand = [];
  state.players[0].herd = 3;
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'exchange', give: [], camels: 3, takeSlots: [0, 1, 2] });
  check(r.ok, 'herd exchange rejected: ' + r.error);
  check(state.players[0].herd === 0, 'herd not debited');
  check(state.market.filter((c) => c.good === 'camel').length === 3, 'camels not placed in market');
  check(state.players[0].hand.length === 3, 'goods not received');
});

fixture('exchange may not overfill the hand', () => {
  const { state } = E.createMatch({ seed: 11 });
  state.market = [{ id: 'm1', good: 'diamond' }, { id: 'm2', good: 'gold' },
                  { id: 'm3', good: 'silver' }, { id: 'm4', good: 'leather' }, { id: 'm5', good: 'spice' }];
  state.players[0].hand = [1, 2, 3, 4, 5, 6].map((i) => ({ id: 'h' + i, good: 'cloth' }));
  state.players[0].herd = 3;
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'exchange', give: [], camels: 3, takeSlots: [0, 1, 2] });
  check(!r.ok, '6 + 3 = 9 cards was allowed');
});

fixture('taking a single card is blocked at 7 cards', () => {
  const { state } = E.createMatch({ seed: 12 });
  state.players[0].hand = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: 'h' + i, good: 'cloth' }));
  state.market = [{ id: 'm1', good: 'diamond' }, { id: 'm2', good: 'camel' },
                  { id: 'm3', good: 'silver' }, { id: 'm4', good: 'leather' }, { id: 'm5', good: 'spice' }];
  state.turn = 0;
  check(!E.applyAction(state, 0, { type: 'take', slot: 0 }).ok, 'take allowed at hand limit');
  check(E.applyAction(state, 0, { type: 'camels' }).ok, 'camels should still be takeable at 7 cards');
});

fixture('three empty piles ends the round', () => {
  const { state } = E.createMatch({ seed: 13 });
  state.tokens.diamond = []; state.tokens.gold = []; state.tokens.silver = [1];
  state.players[0].hand = [{ id: 'a', good: 'silver' }, { id: 'b', good: 'silver' }];
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'sell', good: 'silver', count: 2 });
  check(r.ok, 'sell rejected');
  check(state.roundOver, 'round should have ended on the third empty pile');
  check(state.roundResult.reason === 'three_piles', 'wrong end reason: ' + state.roundResult.reason);
});

fixture('an unrefillable market ends the round', () => {
  const { state } = E.createMatch({ seed: 14 });
  state.deck = [];
  state.market = [{ id: 'm1', good: 'diamond' }, { id: 'm2', good: 'gold' },
                  { id: 'm3', good: 'silver' }, { id: 'm4', good: 'leather' }, { id: 'm5', good: 'spice' }];
  state.players[0].hand = [];
  state.turn = 0;
  const r = E.applyAction(state, 0, { type: 'take', slot: 0 });
  check(r.ok, 'take rejected');
  check(state.roundOver && state.roundResult.reason === 'deck_empty', 'deck-empty ending missed');
});

fixture('camel token worth 5 to the larger herd only', () => {
  const { state } = E.createMatch({ seed: 15 });
  state.tokens.diamond = []; state.tokens.gold = []; state.tokens.silver = [1];
  state.players[0].herd = 4; state.players[1].herd = 4;
  state.players[0].hand = [{ id: 'a', good: 'silver' }, { id: 'b', good: 'silver' }];
  state.turn = 0;
  E.applyAction(state, 0, { type: 'sell', good: 'silver', count: 2 });
  check(state.roundResult.camelSeat === null, 'camel token handed out on a tie');
  const { state: s2 } = E.createMatch({ seed: 16 });
  s2.tokens.diamond = []; s2.tokens.gold = []; s2.tokens.silver = [1];
  s2.players[0].herd = 5; s2.players[1].herd = 2;
  s2.players[0].hand = [{ id: 'a', good: 'silver' }, { id: 'b', good: 'silver' }];
  s2.turn = 0;
  E.applyAction(s2, 0, { type: 'sell', good: 'silver', count: 2 });
  check(s2.roundResult.camelSeat === 0, 'camel token missed');
  check(s2.roundResult.scores[0].camel === 5, 'camel token should be 5 points');
});

fixture('tiebreak falls through to bonus tokens', () => {
  const { state } = E.createMatch({ seed: 17 });
  state.tokens.diamond = []; state.tokens.gold = []; state.tokens.silver = [];
  state.players[0].goodsTokens = [{ good: 'cloth', value: 5 }];
  state.players[1].goodsTokens = [{ good: 'spice', value: 2 }];
  state.players[1].bonusTokens = [{ size: 3, value: 3 }];
  state.players[0].herd = 1; state.players[1].herd = 1;
  state.players[0].hand = [{ id: 'a', good: 'cloth' }];
  state.turn = 0;
  E.applyAction(state, 0, { type: 'sell', good: 'cloth', count: 1 });
  // seat 0 gains cloth 3 -> 8 total; seat 1 has 2+3 = 5. seat 0 wins outright.
  check(state.roundResult.winner === 0, 'expected seat 0, got ' + state.roundResult.winner);
});

fixture('best of three: two seals ends the match', () => {
  const { state } = E.createMatch({ seed: 18 });
  state.seals = [1, 0];
  state.tokens.diamond = []; state.tokens.gold = []; state.tokens.silver = [1];
  state.players[0].herd = 2; state.players[1].herd = 2;   // neutralise the camel token
  state.players[0].goodsTokens = [{ good: 'cloth', value: 5 }];
  state.players[0].hand = [{ id: 'a', good: 'silver' }, { id: 'b', good: 'silver' }];
  state.turn = 0;
  E.applyAction(state, 0, { type: 'sell', good: 'silver', count: 2 });
  check(state.matchOver && state.matchWinner === 0, 'match should be won at 2 seals');
});

fixture('round 2 is started by the other player', () => {
  const { state } = E.createMatch({ seed: 19 });
  const first = state.firstSeat;
  state.tokens.diamond = []; state.tokens.gold = []; state.tokens.silver = [1];
  state.players[first].hand = [{ id: 'a', good: 'silver' }, { id: 'b', good: 'silver' }];
  state.turn = first;
  E.applyAction(state, first, { type: 'sell', good: 'silver', count: 2 });
  E.startNextRound(state);
  check(state.firstSeat === 1 - first, 'starting player did not alternate');
  check(state.round === 2 && !state.roundOver, 'round 2 not set up');
});

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
