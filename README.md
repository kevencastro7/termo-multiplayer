# TERMO — multiplayer

Mobile-first Portuguese word game with real-time Socket.IO rooms and installable PWA support.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The development server proxies Socket.IO to port 3001. Use two browser windows or devices on the same network to create and join a room.

## Build and run

```sh
npm run typecheck
npm run build
npm start
```

The production server serves the Socket.IO backend and listens on `PORT` (default 3001). Serve the `dist/` static client from the same origin in production to enable same-origin PWA installation and socket connections. The app manifest and service worker are in `public/`.

## Rules

- One secret word is selected from the first 2,000 dictionary entries when a room is created.
- Any five-letter word in `allWords` is accepted as a guess; it does not need to be a possible answer.
- The room host starts each round. All players in the room compete on the same word, each with six attempts and a five-minute server-side timer.
- Players who join during a round wait until it ends, then can play in the next round.
- Returning to the lobby keeps the room open for another round; the next round uses a new target word.
- Other players see attempt counts and finish status, not the guesses or letter feedback.
- The final ranking places solvers first, ordered by fewer guesses then faster solve time. Players who did not solve follow, ordered by more attempts used, then longer time in the match.

Rooms are held in server memory; restarting the server clears active games. Use a persistent/shared store and Socket.IO adapter for multi-instance deployment.