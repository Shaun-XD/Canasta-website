"""Long-lived Node game-bridge process (JSON lines over stdin/stdout)."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
BRIDGE_DIR = ROOT / "game_bridge"


class GameBridge:
    def __init__(self) -> None:
        self._proc: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task | None = None
        self._pending: dict[int, asyncio.Future] = {}
        self._next_id = 1
        self._lock = asyncio.Lock()
        self._ready = asyncio.Event()

    async def start(self) -> None:
        if self._proc and self._proc.returncode is None:
            return

        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None
        self._proc = None
        self._ready = asyncio.Event()
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(RuntimeError("Game engine restarted."))
        self._pending.clear()

        env = os.environ.copy()
        # Prefer local node_modules/.bin/tsx after npm install in game_bridge/
        tsx = BRIDGE_DIR / "node_modules" / ".bin" / "tsx"
        if tsx.exists():
            cmd = [str(tsx), "bridge.ts"]
        else:
            cmd = ["npx", "--yes", "tsx", "bridge.ts"]

        self._proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(BRIDGE_DIR),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        self._reader_task = asyncio.create_task(self._read_loop())
        asyncio.create_task(self._stderr_loop())
        await asyncio.wait_for(self._ready.wait(), timeout=30)

    async def stop(self) -> None:
        if self._proc and self._proc.returncode is None:
            self._proc.terminate()
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._proc.kill()
        self._proc = None
        if self._reader_task:
            self._reader_task.cancel()

    async def _stderr_loop(self) -> None:
        if not self._proc or not self._proc.stderr:
            return
        while True:
            line = await self._proc.stderr.readline()
            if not line:
                break
            print(f"[bridge:err] {line.decode().rstrip()}", flush=True)

    async def _read_loop(self) -> None:
        assert self._proc and self._proc.stdout
        while True:
            line = await self._proc.stdout.readline()
            if not line:
                break
            try:
                msg = json.loads(line.decode())
            except json.JSONDecodeError:
                continue
            if msg.get("result", {}).get("ready") is True and msg.get("id") is None:
                self._ready.set()
                continue
            req_id = msg.get("id")
            fut = self._pending.pop(req_id, None)
            if fut and not fut.done():
                fut.set_result(msg)

    async def call(self, method: str, params: dict[str, Any] | None = None) -> Any:
        await self.start()
        assert self._proc and self._proc.stdin

        async with self._lock:
            req_id = self._next_id
            self._next_id += 1
            loop = asyncio.get_running_loop()
            fut: asyncio.Future = loop.create_future()
            self._pending[req_id] = fut
            payload = json.dumps({"id": req_id, "method": method, "params": params or {}}) + "\n"
            self._proc.stdin.write(payload.encode())
            await self._proc.stdin.drain()

        try:
            msg = await asyncio.wait_for(fut, timeout=30)
        except asyncio.TimeoutError as exc:
            self._pending.pop(req_id, None)
            raise RuntimeError(f"Bridge timeout on {method}") from exc

        if not msg.get("ok"):
            raise RuntimeError(msg.get("error") or "Bridge error")
        return msg.get("result")


bridge = GameBridge()
