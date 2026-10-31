# MotoArk Search Part

The starting point for greenfield projects on the `nextjs-prisma-postgres` stack of Agentic Delivery Studio. An executor copies these files into a new, empty project repo as its first PR (the "Seed from boilerplate" unit), and every other unit is built on top.

Stack: Next.js 16 (App Router) · TypeScript · Prisma 7 with the `pg` adapter · Postgres 17 · Tailwind CSS 4 · Vitest · ESLint.

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
src/app/            pages and route handlers (App Router)
src/app/api/health  health check
src/lib/db.ts       the Prisma client (server only)
src/lib/health.ts   health logic, unit tested
prisma/             schema and migrations
tests/              unit tests
```

The `Note` model is a placeholder so the first migration has something in it; replace it with the first real model.
