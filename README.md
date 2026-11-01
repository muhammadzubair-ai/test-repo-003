# MotoArk Search Part

The starting point for greenfield projects on the `nextjs-prisma-postgres` stack of Agentic Delivery Studio. An executor copies these files into a new, empty project repo as its first PR (the "Seed from boilerplate" unit), and every other unit is built on top.

Stack: Next.js 16 (App Router) · TypeScript · Prisma 7 with the `pg` adapter · Postgres 17 · Tailwind CSS 4 · Vitest · ESLint.

## Data (confidential)

The Interview Dataset `.xlsx` is read from a path **outside this repository** (for example via `npm run import -- --file /absolute/path/to/dataset.xlsx` once the importer exists). Do not copy the workbook into the repo. `data/`, `reports/`, and `.env` are gitignored. No seed data other than that Interview Dataset is ever loaded; there is no checked-in fixture catalogue.

## Run it locally

Needs Node 24, pnpm 11 and Docker.

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm db:deploy
pnpm dev
```

Open http://localhost:3000. The page shows whether the database answers, and `GET /api/health` returns `{ status, database, checkedAt }` (503 while the database is down).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server (`output: "standalone"`) |
| `pnpm lint` | ESLint with the Next.js rules |
| `pnpm typecheck` | Generates the Prisma client and route types, then `tsc` |
| `pnpm test` | Vitest, tests in `tests/` |
| `pnpm db:up` / `pnpm db:down` | Local Postgres from `compose.yml` |
| `pnpm db:migrate --name <change>` | Create and apply a migration after editing `prisma/schema.prisma` |
| `pnpm db:deploy` | Apply existing migrations |

CI (`.github/workflows/ci.yml`) runs install, migrations against a Postgres service, typecheck, lint, test and build on every pull request.

## Layout

```
src/web/            web-layer UI (must not import src/db)
src/api/            api-layer domain modules
src/db/             db layer; re-exports the Prisma client from src/lib/db.ts
src/app/            App Router pages and route handlers
src/lib/db.ts       the Prisma client (server only) — single client for the app
src/lib/health.ts   health logic, unit tested
infra/              infra notes (compose.yml stays at repo root)
prisma/             schema and migrations
tests/              unit tests
```

The `Note` model is a placeholder so the first migration has something in it; replace it with the first real model.
