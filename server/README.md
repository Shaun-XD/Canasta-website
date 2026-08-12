# Canasta realtime server

FastAPI + python-socketio frontend gateway, with a Node TypeScript **game bridge**
that reuses the real rules engine in `src/engine/`.

> Vercel hosts the static React app only — it cannot keep WebSocket servers
> alive. Deploy this `server/` process on Railway, Render, Fly.io, or any
> long-running host, then point the frontend at it with `VITE_SOCKET_URL`.

## Architecture

```
Browser (Vercel)  --Socket.IO-->  FastAPI (this server)
                                      |
                                      v
                               Node game_bridge (tsx)
                                      |
                                      v
                               src/engine + src/lib/deck
```

## Local setup

```bash
# 1) Bridge deps
cd server/game_bridge
npm install

# 2) Python deps
cd ..
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3) Run
uvicorn main:asgi_app --host 0.0.0.0 --port 4000 --reload
```

In another terminal, run the Vite app with:

```bash
# repo root
echo 'VITE_SOCKET_URL=http://localhost:4000' > .env.local
npm run dev
```

Open the site on two devices/browsers → **Online** → create/join the same room code.

## Deploy (Railway + Vercel)

Full branch workflow (`main` → prod, `develop` / features → preview):
**[docs/DEPLOY.md](../docs/DEPLOY.md)**.

The bridge imports `src/engine`, so the **whole repo** must be on the API host
(not `server/` alone). A root `Dockerfile` + `railway.toml` handle Python + Node.

### Railway (API)

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub → this repo.
2. Uses root `Dockerfile` / `railway.toml`.
3. Variables (optional — defaults allow all `*.vercel.app` previews):
   - `FRONTEND_ORIGINS=*` **or** exact prod URL(s)
   - `FRONTEND_ORIGIN_REGEX` (default matches `*.vercel.app` + localhost)
4. Generate a public domain (Settings → Networking → Generate Domain).
5. Confirm `https://YOUR-RAILWAY-DOMAIN/health` returns `"ok": true`.

Recommended: one Railway service tracking `main` (prod) and one tracking
`develop` (staging for all Vercel previews).

### Vercel (UI)

1. [vercel.com](https://vercel.com) → Import `Shaun-XD/Canasta-website`.
2. Production Branch = `main` (other branches get Preview URLs automatically).
3. Environment variable `VITE_SOCKET_URL` (no trailing slash):
   - **Production** → Railway prod domain
   - **Preview** → Railway staging domain (or the same prod URL if you only have one)
4. Deploy. Open the Vercel URL → Online → Landing should show your Railway URL, not localhost.

## Health

`GET /health` → `{ "ok": true }`

## Socket events (client → server)

| Event | Payload |
| --- | --- |
| `room:create` | `{ playerName, targetScore?, turnTimerSeconds? }` (ack) |
| `room:join` | `{ roomId, playerName }` (ack) |
| `room:rejoin` | `{ roomId, playerId }` (ack) |
| `room:setTeam` | `{ teamId }` |
| `room:setReady` | `{ ready? }` |
| `room:setTimer` | `{ seconds }` |
| `room:start` | — |
| `game:draw` | — |
| `game:attemptMeld` | `{ handCardIds, targetMeldId?, selectedDiscardIds?, slideEdge? }` |
| `game:discard` | `{ cardId }` |
| `game:declareShow` | — |
| … | see `src/lib/socket.ts` |

## Broadcast (server → client)

- `room:state` `{ room, playerId }` — `isLocal` set for the recipient
- `game:state` `{ game, playerId }` — other hands / stock / pozzetto redacted
- `action:error` `{ error }`
