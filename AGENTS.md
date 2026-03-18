# AGENTS.md — miau-trader

## What this is
A TypeScript web app for crypto perpetual futures decision-support on Backpack exchange. Read-only public market data — no trade execution, no account endpoints.

## Hard rules
- **No trade execution** — no order placement, no private/account API calls
- **No Docker, no CI** (for now)
- **Clean Architecture layering** — domain imports nothing from adapters; application depends only on ports + domain; adapters implement ports
- **All domain types are `readonly`** — no mutation, use spreads
- **Tests cover our logic** — not third-party library correctness

## Commands
```
npm i              # install
npm run dev        # dev server (port 3000)
npm run build      # compile
npm run start      # run built app
npm test           # vitest
```

## Personas
Use these when the user asks you to switch persona or references one by name. Always start your response by acknowledging which persona file you are using.
- `persona/market-structure-trader.md` — crypto domain expert, thinks in liquidity and structure
- `persona/senior-fullstack-engineer.md` — TypeScript implementer, clean architecture
- `persona/signal-designer.md` — information design, progressive disclosure, terminal aesthetic

## Orientation
- Entry point: `src/web.ts` (composition root, DI wiring)
- Domain plans: `plans/*.md`
- SQLite data: `data/` (gitignored)
- Frontend: `src/adapters/web/static/` (Preact + htm, no build step)
