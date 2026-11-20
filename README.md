# Tombala 90 — Online MVP

A mobile-friendly Turkish tombala web app with room creation, 6-digit room codes, host approval, up to 100 players per room, one ticket per player, manual/automatic draws, and server-side claim validation.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm start
```

Open http://localhost:3000. For testing multiple players, open the URL in multiple browser windows/devices on the same network (use the host computer's LAN IP for phones).

## Deploy

Deploy as a persistent Node.js web service (not a static-site host). Build command: `npm install`; start command: `npm start`. Set `PORT` if your host requires it. Use HTTPS in production.

## Important MVP limitations

- Rooms and game state live in server memory. Restarting the service closes active rooms.
- This is a single-process MVP; horizontal scaling, Redis adapter, persistent storage, monitoring, rate limits, abuse protection, and production load testing are not included.
- Reconnection recovery and account authentication are not yet implemented.
- Automatic draw interval is 5 seconds.
- The UI is a responsive web app; Android/iOS store packaging (PWA/native wrapper) is a later step.
