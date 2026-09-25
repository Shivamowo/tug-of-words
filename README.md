# TUG OF WORDS 🪢

A 2-minute tug of war played in chat. Every message is a move, and **TypeSafe Jev** judges each one live (~100ms).
Pixel/synthwave look, chiptune music and sound effects, room codes, 1v1 up to 5v5.

## Run locally
```bash
npm install
TYPESAFE_API_KEY=xxx npm start   # without a key it runs in MOCK mode
# open http://localhost:3000
```

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render → **New → Blueprint** → pick the repo (it uses `render.yaml`). Or **New → Web Service**: build `npm install`, start `npm start`.
3. Set the env var **`TYPESAFE_API_KEY`** in the Render dashboard. Never commit it.
4. Open the URL, press START, enter a name, create a room, send the link to a friend.

Check `/health` to see Jev status (live, calls, fails, last latency, last error).

## How scoring works
One Jev call per message, with every question answered in parallel:
| id | primitive | effect |
|---|---|---|
| quality | score (5 levels) | base pull 2–12 |
| funny | noul > .6 | +4 (LOL) |
| counter | noul > .6 | ×1.5 COMBO (replying to the opponent's last line) |
| spam | noul > .6 (or exact repeat) | −5, backfires |
| offtopic | noul > .7 | 0, fizzles |
| rule | noul > .5 (semantic events only) | +3 or −6 |

Then a luck roll: 12% WHIFF ×0.25, 12% CRIT ×2 (40% during CRIT STORM). Pull is divided by √(team size).
Deterministic event rules (CAPS, no E, ≤4 words, question, emoji) are checked in code. Semantic ones (pirate, rhyme, compliment, Shakespeare) are checked by Jev.
If Jev fails, the game falls back to a heuristic judge so matches never stall.

## Files
- `server.js`: rooms, match timeline, scoring, Socket.IO
- `jev.js`: Jev gateway (fan-out questions, timeout, retry, fallback)
- `content.js`: prompt deck and chaos events
- `public/`: pixel UI (`index.html`, `style.css`, `app.js`) and the chiptune engine (`audio.js`)

Tune everything at the top of `server.js` and in `content.js`.
