# Camel & Coin

**▶ Play it: https://camel-and-coin.onrender.com**

Everything lives on that one service — the page, the bots and the online rooms.
There is also a static mirror at
[likhithaaralimara.github.io/camel-and-coin](https://likhithaaralimara.github.io/camel-and-coin/)
which loads instantly and never sleeps; it points at the same room server, so
both URLs are the same game.

A two-player Rajasthani trading card game, played in a browser — against a bot,
or against a friend in a private room. Full rules, original artwork, heavy
animation, and no framework.

```bash
npm install
npm start          # → http://localhost:3000
```

`npm start` runs a tiny build first (`scripts/build.js`) that wraps `src/*.js`
into a browser bundle and writes the room-server config. There is no bundler and
no framework; the build is thirty lines of `fs.readFileSync`.

> An independent implementation of the rules of *Jaipur*, the two-player card
> game designed by Sébastien Pauchon. Game rules aren't copyrightable, but the
> name and the artwork are — so this is published under its own name with its
> own drawings, and is not affiliated with or endorsed by Space Cowboys.

---

## Playing

**Against a bot** — pick a difficulty (Novice / Merchant / Maharaja) and press
*Enter the bazaar*. The bot only ever reads what a player sitting at the table can
see: the market, the face-up token piles, its own hand, and your herd, tokens and
*card count*. Before it simulates a candidate move it reshuffles its private copy
of the deck and of the bonus piles, so it cannot peek at the next refill.

**Against a friend** — *Host a room* gives you a four-letter code and an invite
link. Send either one. The second person to arrive takes the other chair and the
game starts by itself; anyone after that watches. Rooms also accept a bot if your
friend is slow, and a dropped player can rejoin on the same link and pick up where
they left off — or you can hand their seat to a bot and play on.

### The invite link and who can reach it

The server binds to `0.0.0.0`, so the lobby shows a **LAN link** (e.g.
`http://192.168.0.101:3000/?room=ABCD`). That works for anyone on the same Wi-Fi.

It will **not** work for someone on another network — a `localhost` or `192.168.x.x`
address means nothing to them. For that, put a tunnel in front of it:

```bash
npx cloudflared tunnel --url http://localhost:3000     # or: ngrok http 3000
```

and share the public URL the tunnel prints, with `/?room=ABCD` on the end.

### Controls

Click market cards and hand cards to assemble a move; the bar underneath tells you
what the current selection would do. Click your herd to add camels to an exchange.
`C` takes the camels, `Enter` confirms, `Esc` closes a panel.

---

## The rules, as implemented

Verified against the Space Cowboys rulebook and locked into `src/rules.js`.

**Deck** — 55 cards: 6 diamond, 6 gold, 6 silver, 8 cloth, 8 spice, 10 leather, 11 camel.

**Setup** — 3 camels are pulled into the market, five cards are dealt to each player
(camels going straight to the herd), and the market is topped up to five.

**A turn is exactly one of:**

| | |
|---|---|
| Take one goods card | into your hand |
| Take every camel | into your herd |
| Exchange 2+ | market cards for the same number from hand and/or herd |
| Sell | cards of a single goods type |

Camels can never be *taken* in an exchange, and you may not hand back a goods type
you are taking in the same swap. Giving camels is always legal, including a
camels-only exchange straight out of your herd. Your hand is capped at seven cards;
the herd does not count toward it. The market is refilled to five at the end of
every take or exchange.

**Selling** pays the *highest remaining* tokens of that type. Diamonds, gold and
silver must be sold two or more at a time.

| Goods | Tokens, paid highest first |
|---|---|
| Diamond *(min 2)* | 7 · 7 · 5 · 5 · 5 |
| Gold *(min 2)* | 6 · 6 · 5 · 5 · 5 |
| Silver *(min 2)* | 5 · 5 · 5 · 5 · 5 |
| Cloth | 5 · 3 · 3 · 2 · 2 · 1 · 1 |
| Spice | 5 · 3 · 3 · 2 · 2 · 1 · 1 |
| Leather | 4 · 3 · 2 · 1 · 1 · 1 · 1 · 1 · 1 |

Selling three, four or five cards in one go also draws a face-down **bonus token**:
3-card `1 1 2 2 2 3 3`, 4-card `4 4 5 5 6 6`, 5-card `8 8 9 10 10`.

**Two rulings this implementation makes explicit**, because the rulebook leaves
room to argue:

- A **short pile** pays out whatever is left and the bonus token is still drawn.
  Selling 4 diamonds when only 2 tokens remain gets you those 2 plus a 4-card bonus.
- Selling **6 or more** of one type draws from the 5-card bonus pile. If the pile
  for that size is exhausted, no bonus is paid and the log says so.

**The round ends** the instant three kinds of goods tokens run out, or when the
market cannot be refilled. The larger herd then takes a 5-rupee camel token —
nobody gets it on a tie.

**Scoring** — most rupees wins the round and a seal of excellence. Ties break on
bonus tokens, then goods tokens, then the camel token. Two seals wins the match;
the deck, tokens and hands reset between rounds and the other player deals.

---

## Components

The cards and tokens follow the published game's component set and its colour
coding, so a card you recognise at the table is the card you see here. Cloth is
the pink of the Pink City, which is also the game's own design language:

| Good | Ground | What the card shows | Tokens |
|---|---|---|---|
| Diamonds | red | three cut brilliants | 7 · 7 · 5 · 5 · 5 |
| Gold | yellow | a pyramid of bullion bars | 6 · 6 · 5 · 5 · 5 |
| Silver | blue | ingots and loose coins | 5 · 5 · 5 · 5 · 5 |
| Cloth | pink | three rolled bolts | 5 · 3 · 3 · 2 · 2 · 1 · 1 |
| Spice | green | burlap sacks heaped with spice | 5 · 3 · 3 · 2 · 2 · 1 · 1 |
| Leather | brown | a stretched, stitched hide | 4 · 3 · 2 · 1 · 1 · 1 · 1 · 1 · 1 |
| Camels | sand | a dromedary in a saddle blanket | — |

Goods tokens are round discs with a milled rim, the goods art showing through,
and the rupee value. Bonus tokens carry their pile size (3, 4 or 5) on the back
and their value on the face, so an opponent's token shows you which pile it came
from and nothing more. The camel token is the 5-rupee disc for the largest herd,
and all 55 cards share one back: deep madder red with a gold medallion.

Everything is drawn as inline SVG from a single palette block in `styles.css`,
where each good owns a ground colour (`--c1/--c2/--c3`) and an object colour
(`--o1/--o2/--o3/--o4`). A card, its token, its pile, its row in the rules sheet
and its row in the sell panel all read from that one block, so they cannot drift.

**A note on the art:** these are original drawings matched to the real game's
colour coding, subjects and component shapes. They are not copies of the
published illustrations, which are Space Cowboys' copyright.

---

## Layout

```
server.js              express + socket.io host for online rooms
scripts/build.js       writes public/js/core-bundle.js and public/js/config.js
src/rules.js           every constant, with the rulebook cited
src/engine.js          pure game logic: (state, action) -> { state, events[] }
src/bot.js             opponent AI — public information only
src/rooms.js           rooms, invites, reconnects, bot turn scheduling
src/session.js         the wire protocol, shared by the server and the browser
public/js/net.js       transport: local in-page server, or a remote socket
public/                index.html, styles.css, js/{cards,anim,game,main}.js
test/invariants.js     fuzz harness + rule fixtures
```

### One protocol, two transports

`src/session.js` holds every `room:*` and `game:*` handler. The server binds them
to a socket.io connection. The browser binds the *same* handlers to an in-page
transport, with the same `RoomManager` and the same bot, so a game against a bot
runs entirely in the tab and needs no backend at all. `public/js/net.js` picks:

| You click | Transport | Needs a server |
|---|---|---|
| Play a bot | local, in-page | no |
| Host / Join a room | socket.io | yes |

The socket.io client is only fetched when you actually open a room, so a visitor
who only plays bots never makes a network request.

---

## Deploying

The game is two deployable things, and you can take either or both.

**One service, everything (what's running now).** `render.yaml` deploys this repo
as a single web service: it serves the page *and* the rooms. Online play needs a
long-lived process holding state in memory with real WebSockets, which no
serverless platform gives you — so the whole game lives together.

Serving the page from the same process has a nice side effect on a free tier
that sleeps after 15 minutes idle: *loading the site is what wakes it*, so it's
already warm by the time anyone clicks "Host a room".

```bash
render services create --name camel-and-coin --type web_service \
  --repo https://github.com/LikhithaAralimara/camel-and-coin --branch main \
  --runtime node --region singapore --plan free \
  --build-command "npm ci && npm run build" --start-command "node server.js" \
  --health-check-path /api/rules --env-var ROOM_SERVER_URL=same-origin
```

**Static mirror (bot play).** `.github/workflows/pages.yml` runs the rule suite,
builds, and publishes `public/` to GitHub Pages on every push to `main`. Asset
paths are relative and invite links keep the directory, so the same build works
at a domain root or under a project subpath. `vercel.json` is set up the same way
for `vercel --prod`.

A static host can serve the entire game against bots, because the engine, the bot
and the room protocol all run inside the page. Set the `ROOM_SERVER_URL`
repository variable to the room server's URL and it gets online play too.

To point the static site at the room server, set one variable and redeploy — on
GitHub Pages that's a repository variable named `ROOM_SERVER_URL` (Settings →
Secrets and variables → Actions → Variables), on Vercel an environment variable:

```
ROOM_SERVER_URL = https://<your-room-server>.onrender.com
```

`scripts/build.js` bakes it into `public/js/config.js`:

| `ROOM_SERVER_URL` | Result |
|---|---|
| unset, running locally | the page's own origin |
| unset, on Vercel | no room server — the menu says so and offers bot play |
| set | that URL is used for rooms and invites |

With no room server configured the Host and Join tabs disable themselves with a
one-line explanation rather than failing on click, and an invite link opened
there says plainly that it can't be joined.

Note that free tiers sleep when idle, so the first person to open a room after a
quiet spell may wait up to a minute; the UI says as much instead of hanging.

**Auto-deploy:** Render pushes deploys from a connected GitHub account. This
service was created from the public Git URL, so until the repository is connected
in the Render dashboard (Settings → *Connect GitHub*), deploy a new commit with:

```bash
render deploys create srv-dav5uch42hec73d3oag0 --confirm
```

**The server is authoritative.** Clients send actions, never state. Every outbound
payload passes through `serializeFor(state, seat)` and `redactEvents(events, seat)`,
which are the only paths from the game to a socket. They send the opponent's hand as
a *count*, the deck as a *count*, and the opponent's bonus tokens as *count + size* —
the values stay secret until the round ends.

**Events, not snapshots.** Every action returns an ordered list of what moved where
(`take`, `camels`, `exchange`, `sell`, `refill`, `turn`, `round_end`). The client
replays them one group at a time through an animation queue, measuring source and
destination rectangles around each step so cards fly along real paths instead of
teleporting. Input is locked and inbound updates are buffered until the queue drains.
Every flight is bounded by a watchdog, so a paused tab or a dropped frame can never
strand the board.

---

## Tests

```bash
npm test          # 400 fuzzed matches + 18 targeted rule fixtures
```

The harness plays random-legal and bot-driven matches while asserting, after every
single action:

- card conservation — all 55 accounted for across deck, market, hands, herds and sales
- hand never exceeds 7; herds never go negative
- token piles only shrink, stay in rulebook order, and no token is ever paid twice
- `serializeFor(seat)` contains no card from the other hand and no card from the deck
- the bot does not disturb the live game while it is thinking
- a seal is awarded at most once per completed round
- every match terminates

Rule fixtures cover the first diamond sale paying 7+7, the minimum-sale rule, short
piles, exhausted bonus piles, 6-card sales, both exchange restrictions, the hand cap,
both round-end triggers, the camel token tie, the tiebreak chain, and best-of-three.
