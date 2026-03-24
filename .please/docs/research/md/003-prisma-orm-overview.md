---
id: 001
title: "Prisma ORM — Comprehensive Overview (Databases, Edge, Bun, Migrate, Performance)"
url: "https://www.prisma.io/docs/orm/overview/introduction/what-is-prisma"
date: 2026-03-24
summary: "Full research summary of Prisma ORM v7: supported databases, edge/serverless deployment, Bun runtime compatibility, migration tooling, bundle size implications, and latest version details."
tags: [prisma, orm, typescript, database, edge, bun, migrations, serverless]
---

# Prisma ORM — Comprehensive Overview

Sources fetched:
- https://www.prisma.io/docs/getting-started
- https://www.prisma.io/docs/orm/overview/databases
- https://www.prisma.io/docs/orm/prisma-client/deployment/edge/overview
- https://www.prisma.io/docs/orm/overview/introduction/what-is-prisma
- https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
- https://www.prisma.io/docs/orm/prisma-migrate
- https://www.prisma.io/docs/orm/reference/system-requirements
- https://www.prisma.io/docs/guides/runtimes/bun

---

## 1. Latest Version

**Latest stable: Prisma ORM v7.5.0** (as of 2026-03-24, from npm registry).

The documentation site currently shows `v7`. Prisma ORM ships a major release roughly every few weeks.

### v7 Key Breaking Changes (from v6)

- Prisma ORM now ships as an **ES Module** (`"type": "module"` required in `package.json`). This aligns it natively with Bun, Deno, and Node ESM.
- The `prisma-client-js` generator provider is deprecated; replaced with `prisma-client` (new **Rust-free client**).
- The `output` field in the generator block is now **required** — client is no longer generated into `node_modules` by default.
- Driver adapters are now **required** for all databases (previously optional). `PrismaClient` must be instantiated with an adapter.
- `datasource` fields (`url`, `directUrl`, `shadowDatabaseUrl`) are moved out of `schema.prisma` into a new `prisma.config.ts` file.
- MongoDB is **not yet supported** in v7. Stay on v6 for MongoDB.
- Minimum Node.js: **20.19.0** (recommended: 22.x). TypeScript minimum: **5.4.0**.

### "Prisma Next" (announced)

Prisma announced a full TypeScript rewrite called **Prisma Next** with a new query API, SQL builder, and extensible architecture. This is a future evolution beyond v7.

---

## 2. Supported Databases

### Self-Hosted

| Database | Supported Versions |
|---|---|
| PostgreSQL | 9.6, 10, 11, 12, 13, 14, 15, 16, 17, 18 |
| MySQL | 5.6, 5.7, 8.0, 8.4 |
| MariaDB | 10.0+, 11.0+ |
| SQLite | All versions (bundled with Prisma) |
| Microsoft SQL Server | 2017, 2019, 2022 |
| MongoDB | 4.2+ (**not yet in v7**; use v6) |
| CockroachDB | 21.2.4+ |

### Managed / Cloud

| Database | Notes |
|---|---|
| AWS Aurora | All versions |
| AWS Aurora Serverless | Supported (not Data API) |
| Azure SQL | All versions |
| CockroachDB-as-a-Service | All versions |
| MongoDB Atlas | All versions (v6 only currently) |
| Neon Serverless Postgres | All versions |
| PlanetScale | All versions |
| Cloudflare D1 | Preview |
| Aiven (MySQL & Postgres) | All versions |
| Prisma Postgres | Prisma's own managed Postgres (unikernels, scales to zero) |

---

## 3. Edge / Serverless Support

### Edge Function Provider Support Matrix

| Provider | Native Prisma ORM (Preview) | With Prisma Postgres / Accelerate |
|---|---|---|
| Vercel Edge Functions | Yes (Preview; compatible drivers only) | Yes |
| Vercel Edge Middleware | Yes (Preview; compatible drivers only) | Yes |
| Cloudflare Workers | Yes (Preview; compatible drivers only) | Yes |
| Cloudflare Pages | Yes (Preview; compatible drivers only) | Yes |
| Deno Deploy | Not yet | Yes |

**Note:** Edge support is currently in **Preview**. Edge runtimes run in V8 isolates (Cloudflare/Vercel) or Deno — they lack the full Node.js API surface and have constrained TCP access.

### Edge-Compatible Database Drivers

Standard Prisma uses a Rust query engine binary, which is incompatible with edge runtimes. Driver adapters replace this with pure-JS HTTP or TCP drivers:

| Driver | Transport | Works On |
|---|---|---|
| Neon Serverless | HTTP | Cloudflare Workers, Vercel Edge |
| PlanetScale Serverless | HTTP | Cloudflare Workers, Vercel Edge |
| `node-postgres` (`pg`) | TCP (Cloudflare `connect()`) | Cloudflare Workers only |
| `@libsql/client` (Turso) | HTTP/WebSocket | Cloudflare Workers, Vercel Edge |
| Cloudflare D1 | D1 binding | Cloudflare Workers only |
| Prisma Postgres | HTTP/unikernel | Cloudflare Workers, Vercel |

### What Is Prisma Accelerate?

**Prisma Accelerate** is a connection pooler and global cache layer provided by Prisma (managed service). It sits between your Prisma client and your database, proxying connections over HTTP — which makes it compatible with edge runtimes.

**Is it still needed for edge in v7?**

- With the new driver adapters (v7 default), you can connect **directly** to edge-compatible databases (Neon, PlanetScale, Prisma Postgres) without Accelerate.
- Accelerate is still useful as an optional **connection pool** for serverless/edge workloads where your underlying database only accepts TCP (traditional Postgres, MySQL) and does not have its own HTTP driver.
- For Prisma Postgres specifically, direct connection is supported without Accelerate.
- Summary: **Accelerate is now optional** if your database has a compatible HTTP driver adapter. It remains valuable for pooling traditional databases at the edge.

---

## 4. Bun Compatibility

Prisma ORM has **official Bun support** and a dedicated guide at `https://www.prisma.io/docs/guides/runtimes/bun`.

### Setup with Bun

```bash
bun add -d prisma @types/pg
bun add @prisma/client @prisma/adapter-pg pg

bunx --bun prisma init --db
bunx --bun prisma migrate dev --name init
bunx --bun prisma generate
```

**Note:** Use `bunx --bun prisma` (the `--bun` flag) to ensure the Prisma CLI runs under the Bun runtime rather than forking Node.

### v7 + Bun Alignment

Prisma v7's move to **ESM** is specifically called out as aligning with Bun's module system. The getting-started page lists Bun alongside Node.js and Deno as supported runtimes: "runs smoothly across Node.js, Bun, and Deno."

### Bun Client Code Pattern

```typescript
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

export const prisma = new PrismaClient({ adapter });
```

### System Requirements

The official system requirements page lists only Node.js (minimum 20.19.0 for v7). Bun is explicitly supported in practice but not listed as a formal requirement since it is a runtime replacement, not a Node.js version.

---

## 5. Migration Tooling (Prisma Migrate)

Prisma Migrate is a **hybrid migration tool** — declarative schema → imperative SQL files.

### Key Features

- **`prisma migrate dev`** — generates a new SQL migration file from schema diff, applies it to the dev database, runs seeds. Uses a shadow database for comparison.
- **`prisma migrate deploy`** — applies pending migrations in production (no shadow DB needed).
- **`prisma migrate reset`** — drops and recreates the database (dev only).
- **`prisma migrate status`** — shows which migrations have been applied.
- **`prisma migrate resolve`** — marks a failed migration as applied/rolled back (for manual recovery).
- **`db push`** — pushes schema changes to DB without generating migration files (prototyping only; not for production).
- **`db pull` / `introspect`** — reverse-engineers an existing database into a Prisma schema.

### Migration File Format

Generates plain `.sql` files stored in `prisma/migrations/`. Files are fully customizable for native DB features or data migrations.

### Configuration (v7)

```typescript
// prisma.config.ts
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: `bun run prisma/seed.ts`,
  },
  datasource: {
    url: env("DATABASE_URL"),
    shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
  },
});
```

### MongoDB

MongoDB does **not** use `prisma migrate`. Use `db push` instead.

### Shadow Database

`prisma migrate dev` requires a shadow database to safely calculate diffs. Can be configured via `shadowDatabaseUrl`. In hosted environments where shadow databases are not available, use `--create-only` to generate migration files locally, then deploy with `prisma migrate deploy`.

---

## 6. Bundle Size / Performance

### v6 and Earlier: Rust Query Engine Binary

Previously, Prisma bundled a **Rust-based query engine binary** (`prisma-engines`). This binary:
- Was ~30–50 MB depending on target platform
- Required OS-specific binaries (downloaded at `prisma generate` time)
- Was incompatible with edge runtimes due to binary execution constraints
- Contributed significantly to cold start times in serverless environments

### v7: New Rust-Free Client

The v7 upgrade guide explicitly states the new `prisma-client` provider uses a **"Rust-free client"** that delivers:
- **Faster queries**
- **Smaller bundle size**
- **Lower resource requirements** when deployed

The npm package for v7 (`@prisma/client@7`) lists `@prisma/engines` as a dependency but its role changes — the main query path no longer requires spawning a separate engine process.

Driver adapters (e.g., `@prisma/adapter-pg`) replace the query engine for direct DB connections, meaning the heavy binary is no longer in the critical path for bundle size.

### Cold Start Impact

- v7 with driver adapters: significantly improved cold start vs. v6 (no engine process spawn)
- Using HTTP-based drivers (Neon, PlanetScale serverless): query latency overhead of an HTTP round-trip but no binary load
- Prisma Postgres uses unikernels on bare metal and is tuned for low-latency edge access

---

## Summary Table

| Topic | Status / Notes |
|---|---|
| Latest version | 7.5.0 |
| MongoDB in v7 | Not yet supported (use v6) |
| Edge support | Preview; requires HTTP-based driver adapters |
| Prisma Accelerate (edge) | Now optional with compatible driver adapters |
| Bun support | Official; use `bunx --bun prisma` |
| ESM | Required in v7 (set `"type": "module"`) |
| Migration tooling | Full featured; SQL files; hybrid declarative+imperative |
| Bundle size (v7) | Improved — Rust-free client, no engine binary in critical path |
| Cold starts (v7) | Improved with driver adapters |
