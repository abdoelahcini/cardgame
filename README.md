# Spark

An original online card game for 2–4 players. Match the top card's color or symbol and be the first to empty your hand.

## Run

    npm install
    npm start          # http://localhost:3000

## Play online with someone

The other player has to be able to reach your server. Pick one:

- **Quick (from your PC):** run `npm start`, then in another terminal `npx cloudflared tunnel --url http://localhost:3000`.
  Send the `https://….trycloudflare.com` link it prints. It works only while your PC and both commands stay running.
- **Always online:** push this folder to GitHub and deploy it as a Node web service on Render or Railway
  (start command `npm start`; the server reads `PORT`).

Create a room, press **Copy invite link**, send it, then press **Start** once they've joined.

## Cards (108)

| Card | Effect |
|---|---|
| 0–9 | Match by color or number |
| ⦸ Skip | Next player loses their turn |
| +2 | Next player draws 2 and loses their turn |
| 🎁 Gift | Give one of your cards to the next player |
| ★ Wild | Choose the color |
| +4 Wild | Choose the color; next player draws 4 and loses their turn |

Can't play? Draw one card. If it fits, you may play it right away; otherwise your turn ends.
At one card left, press **Last card!** If you forget, anyone can press **Catch!** and you draw 2.
The round winner scores the cards left in the other hands: numbers count face value, action cards 20, wilds 50.
