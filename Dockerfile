# Realtime API + game bridge (needs full repo: server/ + src/)
FROM node:22-bookworm-slim AS node_base

FROM python:3.13-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Node (for the TypeScript game bridge)
COPY --from=node_base /usr/local/bin/node /usr/local/bin/node
COPY --from=node_base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app

COPY package.json package-lock.json* ./
COPY server/requirements.txt server/requirements.txt
COPY server/game_bridge/package.json server/game_bridge/package.json
COPY server/game_bridge/package-lock.json* server/game_bridge/

RUN pip install --no-cache-dir -r server/requirements.txt \
  && cd server/game_bridge && npm install --omit=dev

COPY src ./src
COPY server ./server

WORKDIR /app/server
ENV PORT=4000
EXPOSE 4000

CMD ["sh", "-c", "uvicorn main:asgi_app --host 0.0.0.0 --port ${PORT:-4000}"]
