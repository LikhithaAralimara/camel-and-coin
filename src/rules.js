'use strict';
/*
 * Jaipur — rules constants.
 *
 * Verified against the Space Cowboys / Asmodee rulebook (2019 edition).
 * All token arrays are stored ASCENDING; a sale pops from the END so the
 * highest remaining token is always paid out first.
 */

const GOODS = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather'];
const CAMEL = 'camel';

// 55 cards total: 6+6+6+8+8+10 goods + 11 camels.
const DECK_COUNTS = Object.freeze({
  diamond: 6, gold: 6, silver: 6, cloth: 8, spice: 8, leather: 10, camel: 11,
});
const TOTAL_CARDS = Object.values(DECK_COUNTS).reduce((a, b) => a + b, 0); // 55

const GOODS_TOKENS = Object.freeze({
  diamond: [5, 5, 5, 7, 7],
  gold:    [5, 5, 5, 6, 6],
  silver:  [5, 5, 5, 5, 5],
  cloth:   [1, 1, 2, 2, 3, 3, 5],
  spice:   [1, 1, 2, 2, 3, 3, 5],
  leather: [1, 1, 1, 1, 1, 1, 2, 3, 4],
});

// Bonus tokens are drawn FACE DOWN and stay secret until the round ends.
const BONUS_TOKENS = Object.freeze({
  3: [1, 1, 2, 2, 2, 3, 3],
  4: [4, 4, 5, 5, 6, 6],
  5: [8, 8, 9, 10, 10],
});

// Expensive goods may never be sold as a single card.
const MIN_SELL = Object.freeze({
  diamond: 2, gold: 2, silver: 2, cloth: 1, spice: 1, leather: 1,
});

const MARKET_SIZE = 5;
const HAND_LIMIT = 7;         // camels live in the herd and do not count
const START_HAND = 5;
const START_MARKET_CAMELS = 3;
const CAMEL_TOKEN_VALUE = 5;  // "most camels" award, nobody on a tie
const SEALS_TO_WIN = 2;       // best of three rounds
const EMPTY_PILES_TO_END = 3;

const GOOD_RANK = Object.freeze({
  diamond: 6, gold: 5, silver: 4, cloth: 3, spice: 2, leather: 1, camel: 0,
});

module.exports = {
  GOODS, CAMEL, DECK_COUNTS, TOTAL_CARDS, GOODS_TOKENS, BONUS_TOKENS,
  MIN_SELL, MARKET_SIZE, HAND_LIMIT, START_HAND, START_MARKET_CAMELS,
  CAMEL_TOKEN_VALUE, SEALS_TO_WIN, EMPTY_PILES_TO_END, GOOD_RANK,
};
