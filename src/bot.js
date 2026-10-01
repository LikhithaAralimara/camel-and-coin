'use strict';
/*
 * Bot opponent.
 *
 * The bot only ever reads information a real player at the table can see:
 * its own hand and herd, the market, the face-up token piles, and the
 * opponent's herd / face-up tokens / hand count. Before it simulates a
 * candidate move it reshuffles its copy of the deck and of the bonus piles,
 * so it can never peek at the next refill or at an undrawn bonus token.
 */

const E = require('./engine');
const R = require('./rules');

const DIFFICULTY = {
  easy:   { noise: 7.0,  blunder: 0.30, threat: 0.05, patience: 0.55 },
  normal: { noise: 2.2,  blunder: 0.08, threat: 0.18, patience: 0.80 },
  hard:   { noise: 0.45, blunder: 0.00, threat: 0.30, patience: 0.95 },
};

/* ------------------------------------------------------------- utilities */
function cloneLite(s) {
  const c = {
    ...s,
    players: s.players.map((p) => ({
      ...p,
      hand: p.hand.slice(),
      goodsTokens: p.goodsTokens.slice(),
      bonusTokens: p.bonusTokens.slice(),
    })),
    market: s.market.slice(),
    deck: s.deck.slice(),
    tokens: {},
    bonus: {},
    // seals MUST be copied: a simulated round-end writes to it, and sharing the
    // array would score the real match from inside the bot's own daydream.
    seals: s.seals.slice(),
    history: [],
    roundResult: null,
    rngState: (s.rngState ^ 0x9e3779b9) | 0,
  };
  for (const g of R.GOODS) c.tokens[g] = s.tokens[g].slice();
  for (const k of [3, 4, 5]) c.bonus[k] = s.bonus[k].slice();
  // Blind the bot to hidden order.
  E.shuffle(c, c.deck);
  for (const k of [3, 4, 5]) E.shuffle(c, c.bonus[k]);
  return c;
}

const topN = (pile, n) => {
  let sum = 0;
  for (let i = pile.length - 1, k = 0; i >= 0 && k < n; i--, k++) sum += pile[i];
  return sum;
};
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/* ------------------------------------------------------------ evaluation */
function handPotential(hand, tokens, bonus, patience) {
  let v = 0;
  for (const g of R.GOODS) {
    const c = hand.filter((x) => x.good === g).length;
    if (!c) continue;
    const sellable = Math.min(c, tokens[g].length);
    // Cards beyond the remaining pile are nearly worthless except for the bonus.
    v += topN(tokens[g], sellable) * patience;
    if (c < R.MIN_SELL[g]) v -= 1.2;                    // stranded expensive single
    if (c >= 3) v += avg(bonus[Math.min(c, 5)]) * 0.8;  // bonus already secured
    else if (c === 2) v += avg(bonus[3]) * 0.30;        // one card away
    else v += avg(bonus[3]) * 0.08;
    if (c > sellable + 1) v -= (c - sellable - 1) * 0.8; // hoarding dead cards
  }
  return v;
}

function herdValue(mine, theirs) {
  // 5 flat points for the bigger herd, plus camels are exchange fuel.
  let v = mine * 0.75;
  if (mine > theirs) v += 4.0;
  else if (mine === theirs) v += 1.0;
  else v -= Math.min(2.5, (theirs - mine) * 0.7);
  return v;
}

function marketThreat(state) {
  // What a decent opponent could pull out of the market right now.
  const best = state.market
    .filter((c) => c && c.good !== R.CAMEL)
    .map((c) => topN(state.tokens[c.good], 1))
    .sort((a, b) => b - a);
  const camels = state.market.filter((c) => c && c.good === R.CAMEL).length;
  return (best[0] || 0) + (best[1] || 0) * 0.45 + camels * 1.1;
}

function evaluate(state, seat, cfg) {
  const me = state.players[seat];
  const op = state.players[1 - seat];

  let v = me.goodsTokens.reduce((a, t) => a + t.value, 0);
  v += me.bonusTokens.reduce((a, t) => a + t.value, 0);
  v += handPotential(me.hand, state.tokens, state.bonus, cfg.patience);
  v += herdValue(me.herd, op.herd);

  // Opponent: public information only. Bonus tokens are known by size, not value.
  let opp = op.goodsTokens.reduce((a, t) => a + t.value, 0);
  opp += op.bonusTokens.reduce((a, t) => a + avg(R.BONUS_TOKENS[t.size]), 0);
  opp += herdValue(op.herd, me.herd);
  opp += op.hand.length * 1.1;              // count only -- no card identities read
  v -= opp * 0.9;

  v -= marketThreat(state) * cfg.threat;

  // The round ending is worth caring about: if piles are nearly gone, banked
  // points matter far more than hand potential.
  const empties = R.GOODS.filter((g) => state.tokens[g].length === 0).length;
  if (empties >= 2) v += me.goodsTokens.reduce((a, t) => a + t.value, 0) * 0.25;
  if (state.roundOver) {
    const res = state.roundResult;
    v += (res.scores[seat].total - res.scores[1 - seat].total) * 1.5;
    if (res.winner === seat) v += 25;
    else if (res.winner !== null) v -= 25;
  }
  return v;
}

/* --------------------------------------------------- candidate generation */
// A pruned, de-duplicated action list. Full enumeration of every exchange is
// combinatorially large and mostly redundant (two identical market cards give
// identical outcomes), so equivalent moves collapse into one candidate.
function candidates(state, seat) {
  const p = state.players[seat];
  const out = [];
  const seen = new Set();
  const push = (a, key) => { if (!seen.has(key)) { seen.add(key); out.push(a); } };

  // Take one card -- one candidate per distinct goods type.
  if (p.hand.length < R.HAND_LIMIT) {
    state.market.forEach((c, slot) => {
      if (c && c.good !== R.CAMEL) push({ type: 'take', slot }, 'take:' + c.good);
    });
  }
  if (state.market.some((c) => c && c.good === R.CAMEL)) push({ type: 'camels' }, 'camels');

  // Sell: the minimum, everything, and each bonus threshold in between.
  for (const g of R.GOODS) {
    const have = E.handCount(p, g);
    if (have < R.MIN_SELL[g]) continue;
    const counts = new Set([R.MIN_SELL[g], have, 3, 4, 5].filter((n) => n >= R.MIN_SELL[g] && n <= have));
    for (const n of counts) push({ type: 'sell', good: g, count: n }, `sell:${g}:${n}`);
  }

  // Exchanges: for each distinct multiset of goods to take, pick the cheapest
  // legal payment (camels first, then the least useful hand cards).
  const takeable = [];
  state.market.forEach((c, slot) => { if (c && c.good !== R.CAMEL) takeable.push({ slot, good: c.good }); });
  const counts = {};
  for (const g of R.GOODS) counts[g] = E.handCount(p, g);
  const giveRank = (c) => R.GOOD_RANK[c.good] + (counts[c.good] >= 3 ? 12 : counts[c.good] === 2 ? 3 : 0);
  const sortedHand = p.hand.slice().sort((a, b) => giveRank(a) - giveRank(b));

  const maxN = Math.min(takeable.length, p.hand.length + p.herd, 4);
  for (let n = 2; n <= maxN; n++) {
    for (const combo of combos(takeable, n)) {
      const key = 'x:' + combo.map((c) => c.good).sort().join(',');
      const takenGoods = new Set(combo.map((c) => c.good));
      const payable = sortedHand.filter((c) => !takenGoods.has(c.good));
      for (let camels = Math.min(p.herd, n); camels >= 0; camels--) {
        const fromHand = n - camels;
        if (fromHand > payable.length) continue;
        if (p.hand.length - fromHand + n > R.HAND_LIMIT) continue;
        push({
          type: 'exchange',
          give: payable.slice(0, fromHand).map((c) => c.id),
          camels,
          takeSlots: combo.map((c) => c.slot),
        }, key + '|c' + camels);
      }
    }
  }
  return out;
}

function combos(arr, k) {
  const res = [];
  const pick = (start, acc) => {
    if (acc.length === k) { res.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return res;
}

/* ------------------------------------------------------------------- API */
function chooseAction(state, seat, difficulty = 'normal') {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const opts = candidates(state, seat);
  if (!opts.length) {
    const fallback = E.legalActions(state, seat);
    return fallback.length ? fallback[0] : null;
  }
  if (cfg.blunder > 0 && Math.random() < cfg.blunder) {
    return opts[Math.floor(Math.random() * opts.length)];
  }

  let best = null;
  let bestScore = -Infinity;
  for (const action of opts) {
    const sim = cloneLite(state);
    const res = E.applyAction(sim, seat, action);
    if (!res.ok) continue;                       // pruned candidate was illegal; skip
    const score = evaluate(sim, seat, cfg) + (Math.random() - 0.5) * 2 * cfg.noise;
    if (score > bestScore) { bestScore = score; best = action; }
  }
  if (!best) {
    const fallback = E.legalActions(state, seat);
    return fallback.length ? fallback[Math.floor(Math.random() * fallback.length)] : null;
  }
  return best;
}

// Flavour text so the bot's move reads as a decision, not a state diff.
function chatter(action, state, seat) {
  const lines = {
    take: ['Mine.', 'I will take that one.', 'A fine choice.', 'That fits my plan.'],
    camels: ['The camels are mine, friend.', 'A caravan needs camels.', 'Ha! All of them.'],
    exchange: ['Let us trade.', 'A fair swap, no?', 'I improve my hand.'],
    sell: ['To market!', 'Sold, at a good price.', 'The rupees pile up.'],
  };
  const pool = lines[action.type] || ['Hmm.'];
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { chooseAction, chatter, candidates, evaluate, DIFFICULTY };
