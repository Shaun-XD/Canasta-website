"""
Canasta realtime server — FastAPI + python-socketio.

Game rules live in the TypeScript engine (`src/engine`); this process owns
sockets/rooms and delegates mutations to `game_bridge/bridge.ts`.
"""

from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager
from typing import Any

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bridge import bridge

# Comma-separated exact origins, or "*" to allow any.
# Preview Vercel URLs change per branch — also match FRONTEND_ORIGIN_REGEX.
FRONTEND_ORIGINS = os.environ.get("FRONTEND_ORIGINS", "*").strip()
# Default allows every *.vercel.app preview/production alias + local Vite.
FRONTEND_ORIGIN_REGEX = os.environ.get(
    "FRONTEND_ORIGIN_REGEX",
    r"https://([a-z0-9-]+\.)*vercel\.app|http://(localhost|127\.0\.0\.1):\d+",
).strip()

_explicit_origins = (
    ["*"]
    if FRONTEND_ORIGINS == "*"
    else [o.strip() for o in FRONTEND_ORIGINS.split(",") if o.strip()]
)
_origin_re = re.compile(FRONTEND_ORIGIN_REGEX) if FRONTEND_ORIGIN_REGEX else None


def _origin_allowed(origin: str | None, _environ: Any = None) -> bool:
    if not origin:
        return True
    if "*" in _explicit_origins:
        return True
    if origin in _explicit_origins:
        return True
    if _origin_re is not None and _origin_re.fullmatch(origin):
        return True
    return False


sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=_origin_allowed,
    cors_credentials=False,
    logger=False,
    engineio_logger=False,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await bridge.start()
    yield
    await bridge.stop()


app = FastAPI(title="Canasta realtime", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if "*" in _explicit_origins else _explicit_origins,
    allow_origin_regex=FRONTEND_ORIGIN_REGEX or None,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# sid -> { roomId, playerId }
CLIENTS: dict[str, dict[str, str]] = {}


def _opaque_cards(n: int, prefix: str) -> list[dict[str, Any]]:
    return [{"id": f"{prefix}-{i}", "rank": "3", "suit": None} for i in range(n)]


def sanitize_room(room: dict[str, Any], viewer_id: str) -> dict[str, Any]:
    players = []
    for p in room.get("players", []):
        players.append({**p, "isLocal": p.get("id") == viewer_id})
    return {**room, "players": players}


def sanitize_game(game: dict[str, Any] | None, viewer_id: str) -> dict[str, Any] | None:
    if not game:
        return None
    hands_in = game.get("hands") or {}
    hands_out: dict[str, Any] = {}
    for pid, cards in hands_in.items():
        if pid == viewer_id:
            hands_out[pid] = cards
        else:
            hands_out[pid] = _opaque_cards(len(cards), f"hidden-{pid}")

    stock = game.get("stock") or []
    pozzetto = game.get("pozzettoStacks") or {}
    acquired = game.get("lastAcquired")
    if isinstance(acquired, dict) and acquired.get("playerId") != viewer_id:
        acquired = {**acquired, "cardIds": []}
    return {
        **game,
        "hands": hands_out,
        "stock": _opaque_cards(len(stock), "stock"),
        "pozzettoStacks": {
            tid: ([] if not cards else _opaque_cards(len(cards), f"poz-{tid}"))
            for tid, cards in pozzetto.items()
        },
        "lastAcquired": acquired,
    }


async def broadcast_state(room_id: str, room: dict[str, Any], game: dict[str, Any] | None) -> None:
    room_id = room_id.upper()
    for sid, meta in list(CLIENTS.items()):
        if meta.get("roomId") != room_id:
            continue
        pid = meta["playerId"]
        await sio.emit(
            "room:state",
            {"room": sanitize_room(room, pid), "playerId": pid},
            to=sid,
        )
        await sio.emit(
            "game:state",
            {"game": sanitize_game(game, pid), "playerId": pid},
            to=sid,
        )


async def emit_error(sid: str, message: str) -> None:
    await sio.emit("action:error", {"error": message}, to=sid)


@app.get("/health")
async def health() -> dict[str, Any]:
    """Liveness + deploy identity (Railway / Render inject these env vars)."""
    return {
        "ok": True,
        "service": "canasta-realtime",
        "gitCommit": os.environ.get("RAILWAY_GIT_COMMIT_SHA")
        or os.environ.get("RENDER_GIT_COMMIT")
        or os.environ.get("GIT_COMMIT")
        or None,
        "gitBranch": os.environ.get("RAILWAY_GIT_BRANCH")
        or os.environ.get("RENDER_GIT_BRANCH")
        or os.environ.get("GIT_BRANCH")
        or None,
        "environment": os.environ.get("RAILWAY_ENVIRONMENT_NAME")
        or os.environ.get("APP_ENV")
        or None,
    }


@sio.event
async def connect(sid, environ):
    print(f"[socket] connect {sid}", flush=True)


@sio.event
async def disconnect(sid):
    meta = CLIENTS.pop(sid, None)
    if not meta:
        return
    try:
        result = await bridge.call(
            "set_connection",
            {"roomId": meta["roomId"], "playerId": meta["playerId"], "status": "disconnected"},
        )
        await broadcast_state(meta["roomId"], result["room"], result.get("game"))
    except Exception as exc:  # noqa: BLE001
        print(f"[socket] disconnect cleanup failed: {exc}", flush=True)


async def _bind_client(sid: str, room_id: str, player_id: str) -> None:
    CLIENTS[sid] = {"roomId": room_id.upper(), "playerId": player_id}
    await sio.enter_room(sid, room_id.upper())


@sio.on("room:create")
async def room_create(sid, data):
    data = data or {}
    try:
        result = await bridge.call(
            "create_room",
            {
                "playerName": data.get("playerName") or "Player",
                "targetScore": data.get("targetScore"),
                "turnTimerSeconds": data.get("turnTimerSeconds"),
                "maxPlayers": data.get("maxPlayers"),
            },
        )
        await _bind_client(sid, result["roomId"], result["playerId"])
        await broadcast_state(result["roomId"], result["room"], result.get("game"))
        return {"ok": True, **result, "room": sanitize_room(result["room"], result["playerId"])}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@sio.on("room:join")
async def room_join(sid, data):
    data = data or {}
    try:
        result = await bridge.call(
            "join_room",
            {"roomId": data.get("roomId", ""), "playerName": data.get("playerName") or "Player"},
        )
        await _bind_client(sid, result["roomId"], result["playerId"])
        await broadcast_state(result["roomId"], result["room"], result.get("game"))
        return {"ok": True, **result, "room": sanitize_room(result["room"], result["playerId"])}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@sio.on("room:rejoin")
async def room_rejoin(sid, data):
    data = data or {}
    try:
        result = await bridge.call(
            "rejoin_room",
            {"roomId": data.get("roomId", ""), "playerId": data.get("playerId", "")},
        )
        await _bind_client(sid, result["roomId"], result["playerId"])
        await broadcast_state(result["roomId"], result["room"], result.get("game"))
        return {
            "ok": True,
            **result,
            "room": sanitize_room(result["room"], result["playerId"]),
            "game": sanitize_game(result.get("game"), result["playerId"]),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


async def _player_action(sid: str, method: str, extra: dict[str, Any] | None = None):
    meta = CLIENTS.get(sid)
    if not meta:
        await emit_error(sid, "Not in a room.")
        return {"ok": False, "error": "Not in a room."}
    params = {"roomId": meta["roomId"], "playerId": meta["playerId"], **(extra or {})}
    try:
        result = await bridge.call(method, params)
        await broadcast_state(meta["roomId"], result["room"], result.get("game"))
        if result.get("error"):
            await emit_error(sid, result["error"])
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        await emit_error(sid, str(exc))
        return {"ok": False, "error": str(exc)}


@sio.on("room:setTeam")
async def room_set_team(sid, data):
    return await _player_action(sid, "set_team", {"teamId": (data or {}).get("teamId")})


@sio.on("room:setSeat")
async def room_set_seat(sid, data):
    return await _player_action(sid, "set_seat", {"seat": (data or {}).get("seat", 0)})


@sio.on("room:setReady")
async def room_set_ready(sid, data):
    ready = (data or {}).get("ready")
    extra = {"ready": ready} if isinstance(ready, bool) else {}
    return await _player_action(sid, "set_ready", extra)


@sio.on("room:setTimer")
async def room_set_timer(sid, data):
    return await _player_action(sid, "set_timer", {"seconds": (data or {}).get("seconds", 120)})


@sio.on("room:setMaxPlayers")
async def room_set_max_players(sid, data):
    return await _player_action(sid, "set_max_players", {"maxPlayers": (data or {}).get("maxPlayers", 4)})


@sio.on("room:setTarget")
async def room_set_target(sid, data):
    return await _player_action(sid, "set_target", {"score": (data or {}).get("score", 2100)})


@sio.on("room:start")
async def room_start(sid, data):
    return await _player_action(sid, "start_game")


@sio.on("game:draw")
async def game_draw(sid, data):
    return await _player_action(sid, "draw")


@sio.on("game:attemptMeld")
async def game_attempt_meld(sid, data):
    data = data or {}
    return await _player_action(
        sid,
        "attempt_meld",
        {
            "handCardIds": data.get("handCardIds") or [],
            "targetMeldId": data.get("targetMeldId"),
            "selectedDiscardIds": data.get("selectedDiscardIds") or [],
            "slideEdge": data.get("slideEdge"),
        },
    )


@sio.on("game:resolveSlide")
async def game_resolve_slide(sid, data):
    data = data or {}
    return await _player_action(
        sid,
        "resolve_slide",
        {
            "edge": data.get("edge"),
            "handCardIds": data.get("handCardIds") or [],
            "targetMeldId": data.get("targetMeldId"),
        },
    )


@sio.on("game:discard")
async def game_discard(sid, data):
    return await _player_action(sid, "discard", {"cardId": (data or {}).get("cardId")})


@sio.on("game:moveWild")
async def game_move_wild(sid, data):
    return await _player_action(sid, "move_wild", {"meldId": (data or {}).get("meldId")})


@sio.on("game:declareShow")
async def game_declare_show(sid, data):
    return await _player_action(sid, "declare_show")


@sio.on("game:forceSuddenDeath")
async def game_force_sudden_death(sid, data):
    return await _player_action(sid, "force_sudden_death")


@sio.on("game:autoEndTurn")
async def game_auto_end_turn(sid, data):
    return await _player_action(sid, "auto_end_turn")


@sio.on("game:togglePause")
async def game_toggle_pause(sid, data):
    return await _player_action(sid, "toggle_pause")


@sio.on("game:startNewGame")
async def game_start_new_game(sid, data):
    return await _player_action(sid, "start_new_game")


@sio.on("game:nextRound")
async def game_next_round(sid, data):
    return await _player_action(sid, "next_round")


@sio.on("room:returnToLobby")
async def room_return_to_lobby(sid, data):
    return await _player_action(sid, "return_to_lobby")


asgi_app = socketio.ASGIApp(sio, other_asgi_app=app)
