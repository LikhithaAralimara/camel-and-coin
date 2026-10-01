/*
 * Goods metadata, inline artwork, and card / token markup.
 *
 * The palette mirrors the published Jaipur components, where each good is
 * colour-coded: diamonds red, gold yellow, silver blue, cloth purple,
 * spice green, leather brown, camels sand. Two sets of custom properties
 * drive every piece of art:
 *
 *   --c1 --c2 --c3   the CARD / TOKEN ground (light -> mid -> shadow)
 *   --o1 --o2 --o3   the depicted OBJECT (highlight -> body -> shade)
 *   --o4             an accent (a gem table, a mound of spice)
 *
 * They live in styles.css under a single `.g-<good>` block so a card, its
 * token, its pile and its row in the rules table can never drift apart.
 */
(function (w) {
  'use strict';

  const GOODS = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather'];

  const META = {
    diamond: { label: 'Diamonds', short: 'Diamond', min: 2, ground: 'red' },
    gold:    { label: 'Gold',     short: 'Gold',    min: 2, ground: 'yellow' },
    silver:  { label: 'Silver',   short: 'Silver',  min: 2, ground: 'blue' },
    cloth:   { label: 'Cloth',    short: 'Cloth',   min: 1, ground: 'purple' },
    spice:   { label: 'Spice',    short: 'Spice',   min: 1, ground: 'green' },
    leather: { label: 'Leather',  short: 'Leather', min: 1, ground: 'brown' },
    camel:   { label: 'Camels',   short: 'Camel',   min: 0, ground: 'sand' },
  };

  const TOKENS = {
    diamond: [5, 5, 5, 7, 7],
    gold:    [5, 5, 5, 6, 6],
    silver:  [5, 5, 5, 5, 5],
    cloth:   [1, 1, 2, 2, 3, 3, 5],
    spice:   [1, 1, 2, 2, 3, 3, 5],
    leather: [1, 1, 1, 1, 1, 1, 2, 3, 4],
  };
  const BONUS = { 3: [1, 1, 2, 2, 2, 3, 3], 4: [4, 4, 5, 5, 6, 6], 5: [8, 8, 9, 10, 10] };

  /* ───────────────────────────── drawing helpers ───────────────────────── */
  const svg = (inner) => `<svg class="ic" viewBox="0 0 48 48" aria-hidden="true">${inner}</svg>`;

  // A brilliant-cut stone: pavilion, crown facets and a bright table.
  function gem(cx, cy, s) {
    return `<g transform="translate(${cx} ${cy}) scale(${s})">
      <path d="M-11-3H11L0 14Z" class="o2"/>
      <path d="M0 14-11-3h4Z" class="o3"/>
      <path d="M0 14 11-3H7Z" class="o3" opacity=".55"/>
      <path d="M-11-3-6-11H6l5 8Z" class="o1"/>
      <path d="M-6-11H6l1 8H-7Z" class="o4"/>
      <path d="M-11-3H11M-7-3-6-11M7-3 6-11" class="lnx"/>
    </g>`;
  }

  // An ingot drawn as a lit top face over a shaded front face.
  function ingot(cx, cy, wd, ht, dep) {
    const h = wd / 2;
    return `<path d="M${cx - h + dep} ${cy - dep}H${cx + h - dep}L${cx + h} ${cy}H${cx - h}Z" class="o1"/>
      <path d="M${cx - h} ${cy}H${cx + h}L${cx + h - 2} ${cy + ht}H${cx - h + 2}Z" class="o2"/>
      <path d="M${cx - h} ${cy}H${cx + h}" class="lnx"/>`;
  }

  function coin(cx, cy, r) {
    return `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.82}" class="o2"/>
      <ellipse cx="${cx}" cy="${cy - r * 0.18}" rx="${r * 0.74}" ry="${r * 0.56}" class="o1"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.82}" class="lnx"/>`;
  }

  // A bolt of cloth: a rolled cylinder with the wound end showing.
  function bolt(cx, cy, wd, ht, rot) {
    const h = ht / 2;
    return `<g transform="translate(${cx} ${cy}) rotate(${rot})">
      <rect x="${-wd / 2}" y="${-h}" width="${wd}" height="${ht}" rx="${h}" class="o2"/>
      <path d="M${-wd / 2 + h} ${-h}H${wd / 2 - 2}" class="o1x"/>
      <ellipse cx="${-wd / 2 + h}" cy="0" rx="${h * 0.62}" ry="${h * 0.9}" class="o1"/>
      <path d="M${-wd / 2 + h} ${-h * 0.82}a${h * 0.3} ${h * 0.5} 0 1 0 .1 0" class="lnx"/>
    </g>`;
  }

  // A burlap sack: gathered at the neck, bulging at the base, heaped with
  // ground spice at the mouth.
  function sack(cx, cy, s) {
    return `<g transform="translate(${cx} ${cy}) scale(${s})">
      <path d="M-5-15C-9-10-13-5-13 2c0 7 3 11 9 11h8c6 0 9-4 9-11 0-7-4-12-8-17Z" class="o2"/>
      <path d="M-5-15C-9-10-13-5-13 2c4 3 22 3 26 0 0-7-4-12-8-17Z" class="o1"/>
      <path d="M-7-14Q0-23 7-14 0-9-7-14Z" class="o4"/>
      <path d="M-7-14H7" class="lnx"/>
      <path d="M-11 3Q0 7 11 3M-10 8Q0 12 10 8" class="lnx" opacity=".5"/>
    </g>`;
  }

  /* ─────────────────────────────── the goods ───────────────────────────── */
  function icon(good) {
    switch (good) {
      // Red ground, a pale cut stone flanked by two smaller ones.
      case 'diamond':
        return svg(gem(24, 23, 1.08) + gem(11, 38, 0.5) + gem(37, 38, 0.5));

      // Yellow ground, a pyramid of three bullion bars.
      case 'gold':
        return svg(ingot(14, 32, 19, 8, 5) + ingot(34, 32, 19, 8, 5) + ingot(24, 20, 19, 8, 5));

      // Blue ground, bars and loose coins in cool white metal.
      case 'silver':
        return svg(coin(7, 38, 5.6) + coin(41, 38, 5.6)
          + ingot(24, 32, 21, 8, 5) + ingot(24, 21, 16, 7, 4));

      // Purple ground, three rolled bolts with the wound ends facing out.
      case 'cloth':
        return svg(bolt(26, 35, 31, 11, -7) + bolt(22, 23, 29, 11, 6) + bolt(25, 12, 23, 9, -4));

      // Green ground, two burlap sacks heaped with spice.
      case 'spice':
        return svg(sack(15, 26, 0.72) + sack(31, 31, 0.9));

      // Brown ground, a stretched and stitched hide.
      case 'leather':
        return svg(`<g transform="translate(24 24) scale(1.06)">
          <path d="M-7-17C-3-13 3-13 7-17 12-21 18-15 16-9 15-5 15-1 16 3 18 9 12 17 6 14 2 12-2 12-6 14-12 17-18 9-16 3-15-1-15-5-16-9-18-15-12-21-7-17Z" class="o2"/>
          <path d="M-7-17C-3-13 3-13 7-17 12-21 18-15 16-9 5-5-9-5-16-9-18-15-12-21-7-17Z" class="o1"/>
          <path d="M-11-1Q0 4 11-1M-10 7Q0 11 10 7" class="lnx"/>
        </g>`);

      // Sand ground, a dromedary in a Rajasthani saddle blanket. Drawn back to
      // front so the near legs and the blanket sit over the body.
      case 'camel':
        return svg(`
          <path d="M11.5 26q-3.6 1.4-3 5.2" class="o3x"/>
          <rect x="13.1" y="29" width="2.9" height="11" rx="1.3" class="o3"/>
          <rect x="24.1" y="29" width="2.9" height="11" rx="1.3" class="o3"/>
          <path d="M13.5 28Q22 8.5 30.5 28Z" class="o2"/>
          <ellipse cx="22" cy="28" rx="11" ry="5.6" class="o2"/>
          <path d="M29 26.5 34.2 24 40 13.6 35 11.2Z" class="o2"/>
          <ellipse cx="38.6" cy="12" rx="4.2" ry="3.2" transform="rotate(-22 38.6 12)" class="o2"/>
          <ellipse cx="42.2" cy="13.6" rx="2.5" ry="1.8" transform="rotate(-18 42.2 13.6)" class="o1"/>
          <path d="M36.6 9.4 37.4 5.2 40.2 8.2Z" class="o3"/>
          <circle cx="39.4" cy="11.4" r=".95" class="lndot"/>
          <path d="M15.4 26.4 27.4 24 28.8 31 16.8 33Z" class="o4"/>
          <path d="M15.8 29.6 28.1 27.4" class="lnx"/>
          <path d="M16.8 33 28.8 31" class="o1x"/>
          <rect x="17.6" y="29" width="2.9" height="11" rx="1.3" class="o2"/>
          <rect x="28.6" y="29" width="2.9" height="11" rx="1.3" class="o2"/>
          <path d="M13.3 38.6h2.5M17.8 38.6h2.5M24.3 38.6h2.5M28.8 38.6h2.5" class="lnx"/>`);

      default:
        return svg('');
    }
  }

  /* ─────────────────────────── cards and tokens ────────────────────────── */
  // `card` = { id, good }; a null good renders the shared back.
  function cardEl(card, opts = {}) {
    const el = document.createElement('div');
    const good = card && card.good;
    el.className = 'card' + (good ? ' g-' + good : ' back') + (opts.cls ? ' ' + opts.cls : '');
    el.dataset.rect = 'card:' + (card ? card.id : 'back');
    if (card) el.dataset.id = card.id;
    if (good) el.dataset.good = good;
    if (opts.slot !== undefined) el.dataset.slot = opts.slot;
    el.innerHTML = good
      ? `<div class="cface">
           <div class="cart">${icon(good)}</div>
           <div class="cframe"></div>
           <div class="cpip tl">${icon(good)}</div>
           <div class="cpip br">${icon(good)}</div>
           <div class="cname">${META[good].short}</div>
           <div class="sheen"></div>
         </div>`
      : `<div class="cface cback">
           <div class="bmedallion"><i></i><b></b><span>${icon('camel')}</span></div>
           <div class="sheen"></div>
         </div>`;
    return el;
  }

  // Goods tokens are punched card discs: a milled rim, the goods art, the value.
  function tokenEl(good, value, opts = {}) {
    const el = document.createElement('div');
    el.className = 'token g-' + good + (opts.cls ? ' ' + opts.cls : '');
    el.dataset.good = good;
    el.title = `${META[good].label} — ${value} rupees`;
    el.innerHTML = `<span class="trim"></span><span class="tart">${icon(good)}</span>`
      + `<span class="tv">${value}</span>`;
    return el;
  }

  // Bonus tokens show their pile size on the back and their value on the face.
  function bonusEl(size, value, opts = {}) {
    const el = document.createElement('div');
    const faceUp = value != null;
    el.className = 'token bonus' + (faceUp ? ' up' : ' down') + (opts.cls ? ' ' + opts.cls : '');
    el.title = faceUp
      ? `Bonus token from the ${size}-card pile — ${value} rupees`
      : `A face-down bonus token from the ${size}-card pile`;
    el.innerHTML = faceUp
      ? `<span class="trim"></span><span class="tv">${value}</span><span class="tb">${size}</span>`
      : `<span class="trim"></span><span class="tv">${size}</span><span class="tdots"></span>`;
    return el;
  }

  // The camel token: 5 rupees to the largest herd.
  function camelTokenEl(opts = {}) {
    const el = document.createElement('div');
    el.className = 'token g-camel camelTok' + (opts.cls ? ' ' + opts.cls : '');
    el.title = 'Camel token — 5 rupees for the largest herd';
    el.innerHTML = `<span class="trim"></span><span class="tart">${icon('camel')}</span>`
      + `<span class="tv">5</span>`;
    return el;
  }

  w.Cards = { GOODS, META, TOKENS, BONUS, icon, cardEl, tokenEl, bonusEl, camelTokenEl };
})(window);
