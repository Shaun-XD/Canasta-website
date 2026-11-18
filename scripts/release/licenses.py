"""Regenerate offline license notices after installing the pinned npm dependencies."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parts = []
for location, package in json.loads((ROOT / "package-lock.json").read_text())["packages"].items():
    if not location or package.get("dev"):
        continue
    directory = ROOT / location
    if not directory.exists() and package.get("optional"):
        continue
    files = sorted(path for path in directory.iterdir()
                   if path.is_file() and path.name.lower().startswith(("license", "licence", "copying", "notice")))
    if not files:
        raise ValueError(f"Review missing license for {location}")
    name = json.loads((directory / "package.json").read_text())["name"]
    parts.append(f"{name} {package['version']}\n\n" + "\n".join(path.read_text() for path in files))
(ROOT / "public/legal/npm-notices.txt").write_text("\n\n".join(parts))
