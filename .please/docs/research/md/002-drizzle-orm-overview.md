---
id: 002
title: "Drizzle ORM — Supported Databases, Edge/Serverless, Bun, Migrations, Bundle Size"
url: "https://orm.drizzle.team/docs/overview"
date: 2026-03-24
summary: "Comprehensive overview of Drizzle ORM covering supported databases and drivers, edge/serverless runtime compatibility (Cloudflare Workers, Vercel Edge, Bun, Deno), migration tooling via drizzle-kit, and bundle size characteristics. Sources: official docs + npm registry."
tags: [drizzle, orm, typescript, database, sqlite, postgresql, mysql, edge, serverless, bun, migrations]
---

# Drizzle ORM — Research Overview

Sources fetched: https://orm.drizzle.team/docs/overview, https://orm.drizzle.team/docs/get-started, https://orm.drizzle.team/docs/connect-overview

---

## 1. Latest Version

| Package | Latest Stable | Notes |
|---------|--------------|-------|
| `drizzle-orm` | **0.45.1** | Published ~3 months ago (as of 2026-03) |
| `drizzle-kit` | **0.31.10** | CLI migration tool |
| `drizzle-orm` v1 beta | **1.0.0-beta.2** | Released 2025-02-12; adds MSSQL, RQBv2, migration architecture rewrite |

A v1.0.0 beta track is in progress. The stable track remains on 0.x.

---

## 2. Supported Databases and Drivers

Drizzle supports three primary SQL dialects, each with multiple driver options.

### PostgreSQL

| Driver | Package | Notes |
|--------|---------|-------|
| `node-postgres` | `pg` | Standard Node.js driver |
| `postgres.js` | `postgres` | Modern, high-performance |
| Neon serverless | `@neondatabase/serverless` | HTTP/WebSocket, edge-compatible |
| Vercel Postgres | `@vercel/postgres` | Wraps `pg` for Vercel edge |
| Supabase | `@supabase/supabase-js` | Managed Postgres |
| AWS Data API | `@aws-sdk/client-rds-data` | RDS via HTTP |
| Xata | `@xata.io/client` | Serverless Postgres-compatible |
| PGlite | `@electric-sql/pglite` | Postgres in WASM (browser/edge) |

### MySQL

| Driver | Package | Notes |
|--------|---------|-------|
| `mysql2` | `mysql2` | Standard driver |
| PlanetScale | `@planetscale/database` | HTTP-based, edge-compatible |
| TiDB Cloud | `@tidbcloud/serverless` | Serverless HTTP driver |
| SingleStore | — | Added in v1 beta |

### SQLite

| Driver | Package | Notes |
|--------|---------|-------|
| `better-sqlite3` | `better-sqlite3` | Node.js sync driver |
| `libsql` / Turso | `@libsql/client` | Remote Turso + local SQLite |
| Cloudflare D1 | `@cloudflare/workers-types` | D1 binding in CF Workers |
| Bun SQLite | `bun:sqlite` (built-in) | Native Bun runtime driver |
| Bun SQL | `bun:sql` (built-in) | Bun's new general SQL API |
| `expo-sqlite` | `expo-sqlite` | React Native / Expo |
| `op-sqlite` | `@op-engineering/op-sqlite` | React Native native SQLite |
| WASM SQLite | `@sqlite.org/sqlite-wasm` | Browser/edge WASM |

### Other

- **Gel** (formerly EdgeDB) dialect — added as a separate dialect in v1 beta track
- **MSSQL** (SQL Server) — added in v1.0.0-beta.2

---

## 3. Edge / Serverless Support

Drizzle is explicitly designed for edge and serverless environments. Key characteristics:

- **Zero native binaries**: no Rust, no OS-level binaries, no serverless adapters needed
- **Works in every major JS runtime**: Node.js, Bun, Deno, Cloudflare Workers, Supabase Edge Functions, Vercel Edge Runtime, AWS Lambda, browsers
- **No special configuration**: same API across all runtimes

### Verified edge-compatible combinations

| Platform | Recommended driver |
|----------|--------------------|
| Cloudflare Workers | D1 binding, Neon serverless HTTP, PlanetScale HTTP, Turso/libsql HTTP |
| Cloudflare Durable Objects | D1 via DO SQLite storage |
| Vercel Edge Functions | Neon serverless, Vercel Postgres, PlanetScale HTTP |
| Deno Deploy | postgres.js (with Deno compat), Neon serverless |
| AWS Lambda | `pg`, `mysql2`, AWS Data API |
| Supabase Edge Functions | `@supabase/supabase-js`, Neon |
| Bun | `bun:sqlite`, `bun:sql`, `pg`, `mysql2`, `better-sqlite3` |

---

## 4. Bun Compatibility

Drizzle has **first-class Bun support**:

- **`bun:sqlite` driver** — dedicated adapter at `drizzle-orm/bun-sqlite`. Uses Bun's built-in `Database` class; no additional npm dependency required.
- **`bun:sql` driver** — dedicated adapter at `drizzle-orm/bun-sql` for Bun's newer general SQL API (PostgreSQL/MySQL over Bun's native SQL layer).
- **`better-sqlite3`** — also works under Bun via Node.js compatibility.
- **`pg`, `mysql2`, `postgres.js`** — all work under Bun's Node.js compatibility layer.
- Official "Get Started with Drizzle and Bun:SQLite" guide exists at `orm.drizzle.team/docs/get-started/bun-sqlite-new`.
- `drizzle-kit push` and `drizzle-kit migrate` both work with Bun projects (`bunx drizzle-kit push`).

---

## 5. Migration Tooling — drizzle-kit

`drizzle-kit` is the companion CLI. Four primary workflows:

| Command | Description |
|---------|-------------|
| `drizzle-kit generate` | Reads schema files, generates SQL migration files (`.sql`) into a migrations folder |
| `drizzle-kit migrate` | Applies pending SQL migration files to the database |
| `drizzle-kit push` | Pushes schema changes directly to DB without generating files (code-first / dev mode) |
| `drizzle-kit pull` (introspect) | Pulls existing DB schema and generates Drizzle schema TypeScript files |
| `drizzle-kit studio` | Opens Drizzle Studio — a local GUI for browsing/editing data |
| `drizzle-kit check` | Validates generated migration files for consistency |
| `drizzle-kit up` | Upgrades outdated snapshot files |

### Configuration (`drizzle.config.ts`)

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',           // 'postgresql' | 'mysql' | 'sqlite'
  dbCredentials: {
    url: './local.db',
  },
})
```

### Custom migrations

Drizzle supports empty custom SQL migration files for DDL operations not covered by the generator (e.g., data seeding, exotic DDL), which are then run via `drizzle-kit migrate`.

### v1 beta migration changes

The v1.0.0-beta.2 release includes a full architecture rewrite of the migration system, closing major stability issues and reducing schema introspection time from ~10 seconds to under 1 second.

---

## 6. Bundle Size and Performance

| Metric | Value |
|--------|-------|
| Core bundle size (minified + gzipped) | **~7.4 kB** |
| Dependencies | **0** (zero external runtime deps) |
| Tree-shakeable | Yes |
| Comparison vs Prisma | ~90% smaller |

### Real-world reported gains (after migrating from Prisma to Drizzle)

- Cold start time: **73% faster**
- Bundle size: **78% smaller**
- First request time: **3 seconds → 700ms**

The small bundle and zero-dependency design make Drizzle well-suited for full-stack frameworks that bundle server code (SolidStart, Qwik, Next.js edge runtime).

---

## 7. Key Design Characteristics

- **SQL-first**: query builder closely mirrors SQL syntax (`select`, `from`, `where`, `join`)
- **Type-safe**: full TypeScript inference from schema definitions; no code generation step needed at runtime
- **Two query APIs**: SQL-like builder + Relational Query Builder (RQBv2 in v1 beta) for nested relation fetching
- **Schema = source of truth**: TypeScript schema files drive both the ORM queries and migration generation
- **No Prisma-style schema file**: schema is plain TypeScript
