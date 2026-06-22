# Working in this repo

A personal learning project: building a tiny React clone ("Didact") by following
https://pomb.us/build-your-own-react/. `src/didact.ts` is hand-written by the
author as a learning exercise — treat it as theirs and don't edit it unless asked.

## Dev server — IMPORTANT

The author usually has `npm run dev` (Vite) running on **port 5173**.

- **NEVER run `pkill -f vite`** (or any broad pattern kill that matches "vite",
  "node", etc.). It kills the author's own dev server, not just one you started.
  This has caused real disruption — don't do it.
- **Prefer reusing the already-running server.** Before starting your own, check
  what's up (`lsof -nP -iTCP:5173 -sTCP:LISTEN`) and just point the browser at
  the existing port (usually http://localhost:5173/).
- **If you genuinely must start your own server**, capture its PID and kill only
  that one — never a pattern match:
  ```bash
  npm run dev > /tmp/vite.log 2>&1 &
  VITE_PID=$!
  # ... do work ...
  kill "$VITE_PID"
  ```
- Vite auto-increments the port (5174, 5175, …) when 5173 is taken, so always
  read the actual URL from its output rather than assuming 5173.

## Commands

- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — production build
- `npm run typecheck` — `tsc --noEmit` (run this after touching `.ts`/`.tsx`)

## Notes

- Browser verification is welcome (Chrome DevTools MCP), but follow the dev-server
  rules above when doing it.
- Deploys to GitHub Pages via Actions on push to `main`.
