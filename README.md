# Canasta-website

## Overview

An online multiplayer Canasta card game, played 2 vs 2. This repository
currently contains the **frontend** of the app: a fully interactive UI shell
with mocked/local game state, ready to be wired up to a real
server-authoritative rules engine once the exact Canasta ruleset (deck
composition, meld/canasta requirements, going-out conditions, wild card
handling, and scoring) is finalized.

The official rules reference for this project lives in
`Canasta Rules_2025.pdf` at the repo root, but note that **the exact ruleset
used by the app has not been finalized yet** — see the "Game rules status"
section below.

## Tech stack

- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/)
- [Zustand](https://github.com/pmndrs/zustand) for client-side state management
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [React Router](https://reactrouter.com/) for navigation (`/`, `/lobby/:roomId`, `/game/:roomId`)
- [socket.io-client](https://socket.io/docs/v4/client-api/) is included as a dependency for future
  real-time wiring, but is **not connected to any server yet** — see
  `src/lib/socket.ts` for the placeholder setup and a sketch of the intended
  event contract.

All card, avatar, and table visuals are original SVG/CSS generated in-project
(no third-party image assets). See `assets/MANIFEST.json` for the full asset
inventory and licensing notes.

## Running locally

```bash
npm install
npm run dev
```

The dev server runs at `http://localhost:5173` by default. Open two browser
windows/tabs pointed at the same room to see the mocked "multiplayer"
experience (though today only one browser tab is a "real" player — the other
three seats are filled by mock/placeholder players so the UI can be
demoed solo).

To type-check and build for production:

```bash
npm run build
```

## Game rules status — IMPORTANT

The detailed Canasta rules (exact deck composition, minimum meld point
values, canasta requirements, going-out conditions, wild card handling,
frozen discard pile rules, and the scoring table) have **not been finalized**
by the project owner yet. Rather than bake in guesses that would need to be
ripped out later, this frontend uses clearly-marked **mock/placeholder game
logic** so the UI is fully interactive and demoable right now:

- All game-state mutations are isolated behind a single store API in
  `src/store/gameStore.ts` (`useGameStore().actions`). Nothing else in the
  app mutates game state directly.
- The mock logic can deal a shuffled deck, let the local player draw, select
  cards, discard, and "lay a meld" (currently just groups selected cards by
  matching rank — no real validation).
- Every place a real rule is required instead has a `TODO(rules)` or
  `TODO(backend)` comment, especially in `src/types/game.ts`,
  `src/lib/deck.ts`, and `src/store/gameStore.ts`.

When the ruleset is finalized and a real server-authoritative engine exists,
the intended integration path is:

1. Replace the body of the action functions in `src/store/gameStore.ts` with
   `socket.emit(...)` calls using the client set up in `src/lib/socket.ts`.
2. Have the server's authoritative `room:state` / `game:state` events call
   `set(...)` in the store instead of the local mock mutations.
3. UI components should not need to change, since they only ever read from
   the store and call `actions.*` — they don't know or care whether the
   state came from a mock or a real server.
