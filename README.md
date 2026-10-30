# Spark

An original online card game for 2–4 players. Match the top card's color or symbol and be the first to empty your hand.

## Run locally

    npm start          # http://localhost:3000

No install step is needed. Locally, rooms live in memory.

## Deploy (Vercel)

The site is static `public/` plus two functions: `api/action.js` and `api/poll.js`.
Room state is stored in Upstash Redis. Add it from the Vercel Marketplace, and it sets
`KV_REST_API_URL` / `KV_REST_API_TOKEN` for you. Browsers poll about once a second for changes.

## Chat

Tap 💬 in the top-right corner to chat in the lobby or during a game. Messages from the other player show a
badge and a short preview. Each room keeps its last 60 messages, up to 200 characters each.

## Cards (108)

| Card | Effect |
|---|---|
| 0–9 | Match by color or number |
| ⦸ Skip | Next player loses their turn |
| +2 | Next player draws 2 and loses their turn |
| 🎁 Gift | Give one of your cards to the next player |
| ★ Wild | Choose the color |
| +4 Wild | Choose the color; next player draws 4 and loses their turn |

**Stacking:** if you're hit by a +2 or +4, you can play your own to pass the growing total to the next player. A +4 can go on anything; a +2 only on a +2. If you can't (or won't) stack, draw the whole total and lose your turn.

Can't play? Draw one card. If it fits, you may play it right away; otherwise your turn ends.
At one card left, press **Last card!** If you forget, anyone can press **Catch!** and you draw 2.
The round winner scores the cards left in the other hands: numbers count face value, action cards 20, wilds 50.
