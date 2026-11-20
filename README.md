# KasımTombala – Online

KasımTombala is a mobile-friendly Turkish Tombala game built with Node.js, Express and Socket.IO.

## Features
- Room creation and six-digit room codes
- Host approval for joining players
- Up to 100 players per room (application-level cap)
- One automatically generated 3x9 / 15-number ticket per player
- Manual or automatic number drawing
- Server-side validation of first çinko, second çinko and tombala claims
- Winner lists separated by prize category; multiple winners per category are displayed
- `/health` health-check endpoint

## Run locally

```bash
npm install
npm start
```

The server listens on `process.env.PORT` or port `3000`.

## Deploy on Render

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

## Important production notes

The current MVP stores rooms and game state in process memory. A server restart or redeploy clears active rooms and winners. Before relying on the service for regular events, add persistent storage (e.g. PostgreSQL), reconnect/session recovery, and perform a 100-client load test. The 100-player room limit is an application setting, not a verified capacity guarantee.
