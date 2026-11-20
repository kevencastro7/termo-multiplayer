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

Locally, the game reads its word list from `word-statuses.json`. To test PostgreSQL locally instead, set `DATABASE_URL` before starting the server. When using a hosted database that requires SSL, also set `DATABASE_SSL=true`.

## Build and run

```sh
npm run typecheck
npm run build
npm start
```

The production server serves the Socket.IO backend and listens on `PORT` (default 3001). Serve the `dist/` static client from the same origin in production to enable same-origin PWA installation and socket connections. The app manifest and service worker are in `public/`.

## Deploy to Railway

This repository is configured as a **single Railway web service**: Railway builds the Vite client and TypeScript server, then starts Express, which serves the client and Socket.IO from the same domain. The `/health` endpoint is configured for Railway's deployment health check. Keep the repository root as the service root so both `word-statuses.json` and `railway.json` are included.

1. Push this repository to GitHub.
2. In Railway, create a project and choose **Deploy from GitHub repo**, then select this repository.
3. Leave the service root directory set to `/`. Railway reads `railway.json` and runs `npm run build` followed by `npm start`.
4. After the first deployment is healthy, open the service's **Settings → Networking** and generate a public domain.
5. Open the generated HTTPS domain. The same origin serves the web app and real-time Socket.IO connection; no separate `CLIENT_URL` or manually configured port is needed.

For production, configure `DATABASE_URL` in Railway's service variables with the PostgreSQL connection string, preferably using Railway's linked PostgreSQL service reference. Do not commit credentials. Set `DATABASE_SSL=true` only if the provider requires SSL. The server loads statuses from the `reviewed_words` table used by the `word-review` app; ensure that app has initialized/populated the table before deploying this game. Production startup fails if `DATABASE_URL` is missing or the table cannot be read.

Railway provides the `PORT` variable automatically; the server listens on it. Rooms are held in memory, so active matches are cleared when a deployment restarts. Run one replica unless you later add shared room storage and a Socket.IO adapter for horizontal scaling.

## Rules

- Secret words are selected only from entries marked `approved` in `word-statuses.json`.
- Every five-letter word listed in `word-statuses.json` is accepted as a guess, regardless of status; it does not need to be a possible answer.
- The room host starts each round. All players in the room compete on the same word, each with six attempts and a five-minute server-side timer.
- Players who join during a round wait until it ends, then can play in the next round.
- Returning to the lobby keeps the room open for another round; the next round uses a new target word.
- Other players see attempt counts and finish status, not the guesses or letter feedback.
- The final ranking places solvers first, ordered by fewer guesses then faster solve time. Players who did not solve follow, ordered by more attempts used, then longer time in the match.

Rooms are held in server memory; restarting the server clears active games. Use a persistent/shared store and Socket.IO adapter for multi-instance deployment.