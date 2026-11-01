# infra layer

Local Postgres compose file lives at the repo root (`compose.yml`).

## Import

`pnpm import -- --file /absolute/path/to/InterviewDataset.xlsx [--skip-embeddings]`

Reads the Option 2 tabs plus Policies and Systems via exceljs in one Prisma transaction (truncate + reload). No network calls. Derived data (aliases, embeddings, VIN resolution) is handled by later units.
