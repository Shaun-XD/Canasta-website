# Deploy guide — Vercel UI + Railway API

Vercel only serves the static React app. Socket.IO needs a long-running
process, so the FastAPI server lives on **Railway**.

## Target workflow

| Git branch | Vercel | Railway (API) |
| --- | --- | --- |
| `main` | **Production** URL | **Prod** Railway service |
| `develop` | **Preview** URL | **Staging** Railway service |
| `feature/*` | **Preview** URL | **Staging** Railway service |

```
Browser (Vercel URL)
    │  Socket.IO  (VITE_SOCKET_URL — different per env)
    ▼
FastAPI + bridge (Railway HTTPS URL)
```

`localhost:4000` only works when you run the API on your machine. A Vercel
preview opened on a phone / another PC cannot reach your laptop.

---

## Staging API for `develop` (add beside existing prod)

You already have a production Railway service. Add a second service for staging:

### A. Railway — create staging

1. Open your existing Railway **project** (same project as prod is fine).
2. **+ New** → **GitHub Repo** → `Shaun-XD/Canasta-website`  
   (or **Duplicate** the prod service if Railway offers that).
3. Rename it to something clear, e.g. `canasta-api-staging`.
4. **Settings → Source**:
   - Repo: same repo
   - **Branch: `develop`** (not `main`)
5. **Settings → Networking → Generate Domain** → copy the new HTTPS URL  
   (e.g. `https://canasta-api-staging.up.railway.app`).
6. Confirm `https://STAGING-DOMAIN/health` returns `"ok": true` and ideally
   `"gitBranch": "develop"`.
7. Env vars: copy from prod if any (`FRONTEND_ORIGINS=*`, etc.). Defaults already allow `*.vercel.app`.

### B. Railway — lock prod to `main`

On your **existing** (prod) service:

1. **Settings → Source → Branch** = `main`
2. Keep its existing public domain (this is what Vercel Production should use).

| Service | Branch | Domain |
| --- | --- | --- |
| `canasta-api` (prod) | `main` | existing Railway URL |
| `canasta-api-staging` | `develop` | new Railway URL |

### C. Vercel — split `VITE_SOCKET_URL`

1. **Settings → Environment Variables**
2. Edit / add `VITE_SOCKET_URL` (no trailing slash):

| Environment | Value |
| --- | --- |
| **Production** | your **prod** Railway URL |
| **Preview** | your **staging** Railway URL |
| **Development** (optional) | `http://localhost:4000` |

If you currently have one `VITE_SOCKET_URL` applied to both Production and Preview:

1. Remove Preview from that variable (or delete and recreate).
2. Add Production → prod URL.
3. Add Preview → staging URL.

3. **Redeploy**:
   - Production deployment (from `main`)
   - Latest Preview for `develop` (Deployments → Redeploy, or push a commit)

Vite bakes the URL in at build time — old deployments keep the old API until redeployed.

### D. Smoke test

| URL | Landing “Server:” should show |
| --- | --- |
| Production Vercel | prod Railway URL |
| `develop` Preview Vercel | staging Railway URL |

Then: two browsers on the **preview** URL → Online → same room. Rooms on staging are separate from prod.

---

## First-time (only if you have no Railway yet)

1. Railway → New Project → Deploy from GitHub → this repo.
2. Root `Dockerfile` + `railway.toml` are used automatically.
3. Generate domain → `/health` → `"ok": true`.
4. Then follow **Staging API for develop** above for the second service.

---

## Local still works

```bash
# API
cd server && uvicorn main:asgi_app --host 0.0.0.0 --port 4000 --reload

# UI
echo 'VITE_SOCKET_URL=http://localhost:4000' > .env.local
npm run dev
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Preview still hits prod API | Preview `VITE_SOCKET_URL` not set / not redeployed |
| Online fails; Server shows `localhost:4000` | `VITE_SOCKET_URL` missing on that Vercel env |
| Staging `/health` shows `main` | Staging service Source branch is still `main` — set to `develop` |
| CORS / blocked socket from a preview URL | `FRONTEND_ORIGINS=*` or default `*.vercel.app` regex on staging |
| UI new but Online rules old | Wrong Railway service / branch not redeployed |
| `/health` ok but socket fails | Use `https://` (not `http://`) in `VITE_SOCKET_URL` |
