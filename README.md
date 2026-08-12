# Canasta-website

## Overview

An online multiplayer Canasta card game, played 2 vs 2. This repository
contains the **frontend** app plus a fully client-side implementation of the
**real Rajasthani Canasta rules engine** — 108-card deck (2 decks + 4
jokers), Set/Sequence melds with wild-card limits, Canasta/Limpa
classification & bonuses, the dynamic wild-card "Slide", the 11-card
Pozzetto reserve stack per team, Top Touch discard-pile pickup, Show/Open
Show going-out conditions, sudden-death stock depletion, and full round
scoring.

The official rules reference lives in `Canasta Rules_2025.pdf` at the repo
root. Two points from that ruleset were left open by the product owner and
are marked with `TODO(rules)` at their point of use in the code:

1. The default match target score (implemented as **2100**, configurable
   per room at creation time).
2. Whether the -100/-500 style tournament penalties (unclaimed Pozzetto,
   wrong-meld detection) apply as specified — implemented as given since no
   contradicting guidance was provided, but flagged for confirmation since
   they're noted as carried over from an earlier tournament ruleset.

## Tech stack

- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/)
- [Zustand](https://github.com/pmndrs/zustand) for client-side state management
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [React Router](https://reactrouter.com/) for navigation (`/`, `/lobby/:roomId`, `/game/:roomId`)
- [Vitest](https://vitest.dev/) for unit-testing the rules engine
- [socket.io-client](https://socket.io/docs/v4/client-api/) talks to the FastAPI
  realtime backend in `server/` (see `server/README.md` and `src/lib/socket.ts`).

All card, avatar, and table visuals are original SVG/CSS generated in-project
(no third-party image assets). See `assets/MANIFEST.json` for the full asset
inventory and licensing notes.

## Running locally

### Frontend only (solo / bots)

```bash
npm install
npm run dev
```

Choose **Solo (bots)** on the landing page. Three seats are filled by bots.

### Online multiplayer (devices / browsers)

1. Start the FastAPI realtime server (see [`server/README.md`](server/README.md)):

```bash
cd server/game_bridge && npm install && cd ..
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:asgi_app --host 0.0.0.0 --port 4000
```

2. Point the Vite app at it and start the UI:

```bash
# repo root
cp .env.example .env.local   # VITE_SOCKET_URL=http://localhost:4000
npm install
npm run dev
```

3. Open the site on two+ devices → **Online** → create/join the same room code.

### Deploy

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the full branch workflow:

| Branch | Frontend | Backend |
| --- | --- | --- |
| `main` | Vercel **Production** | Railway production API |
| `develop` / `feature/*` | Vercel **Preview** | Railway staging API (or shared API) |

- **Frontend:** Vercel (static Vite build). Set `VITE_SOCKET_URL` to your Railway HTTPS URL (Production + Preview).
- **Backend:** Railway (Dockerfile) — Vercel cannot host WebSockets. Details in `server/README.md`.

Preview/production UIs cannot use `localhost:4000`; the browser would call the *visitor’s* machine, not yours.

To type-check and build for production:

```bash
npm run build
```

To run the rules-engine unit tests:

```bash
npm run test
```

## Rules engine

All rules logic lives in `src/engine/`, decoupled from Zustand/React so it's
independently unit-testable (`*.test.ts` files alongside each module):

- `cardValues.ts` — card point values, rank ordering, wild-capability checks.
- `meldValidation.ts` — building Sets & Sequences from scratch (including
  illegal-opener rejection and the 1-wild-per-meld limit), appending cards to
  existing melds, the Slide mechanic (relocating a displaced wild to a chosen
  edge), the `canBecomeLimpa` flag state machine, and Canasta/Limpa/
  Canasta-of-2s/Limpa-of-2s classification + bonus values.
- `turnEngine.ts` — the 3-phase turn state machine: Draw (stock or Top
  Touch), Action (meld/append), Discard, plus Top Touch validation/failure
  penalty handling.
- `pozzetto.ts` — the two Pozzetto (11-card reserve) trigger conditions:
  end-of-turn claim on discard, and mid-turn "running turn" claim on
  melding to an empty hand.
- `showEligibility.ts` — the 3-condition Show (going-out) eligibility check.
- `scoring.ts` — round-end scoring for both the Normal Show ending and the
  sudden-death ending, including all bonuses/penalties from the ruleset.
- `aiPlayer.ts` — a simple greedy planner for the mock/placeholder players
  that reuses the exact same validation functions as human play (no
  separate "fake" AI logic path).

`src/store/gameStore.ts` is the only place that mutates room/game state on
the client: it composes calls into `src/engine/` and calls Zustand's
`set(...)`. When a real server-authoritative engine exists, the intended
integration path is unchanged from before: replace the body of the action
functions with `socket.emit(...)` calls (see `src/lib/socket.ts`), and have
incoming server events call `set(...)` instead — UI components only ever
read from the store and call `actions.*`, so they don't need to change.

### Judgment calls made during implementation

A few specific points in the ruleset required an interpretation call beyond
the two flagged `TODO(rules)` items above; these are also called out inline
in code comments:

- A 7+ card meld with 0 current wild cards but whose `canBecomeLimpa` flag
  has already been permanently tripped (e.g. by the "9 and 2 in the same
  sequence" rule) is classified as a Mixed Canasta rather than a Limpa,
  since the source ruleset doesn't specify a distinct bucket for that edge
  case.
- Top Touch appends that would trigger a wild-card Slide default to sliding
  the displaced wild to the top edge automatically, since Top Touch is a
  single atomic pickup action rather than a multi-step UI flow; the
  mock/placeholder AI players similarly skip any append that would require a
  Slide edge choice, to avoid needing a UI prompt for a non-human player.
- Sudden-death detection (stock pile reaching 0) is surfaced to the human
  player as available tools (Top Touch, melding, Declare Show) plus an
  explicit "End Round (Sudden Death)" button they use if they determine they
  cannot both Top Touch validly and immediately empty their hand with a
  legal Show in that same turn, rather than the engine auto-detecting every
  possible line of play on the player's behalf.
