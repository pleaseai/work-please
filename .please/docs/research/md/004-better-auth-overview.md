---
id: 004
title: "Better Auth: TypeScript Authentication Library Overview"
url: "https://www.better-auth.com/docs/introduction"
date: 2026-03-24
summary: "Better Auth is a comprehensive TypeScript authentication framework supporting Kysely (built-in), Drizzle, Prisma, MongoDB, and direct database drivers. Latest version is 1.5.5 as of March 2026. Works with Bun runtime with known caveats."
tags: [better-auth, authentication, typescript, database-adapters, bun]
---

# Better Auth: TypeScript Authentication Library Overview

## Latest Version

- **better-auth**: `1.5.5` (published ~March 2026)
- **@better-auth/core**: `1.5.6`
- Version 1.5 was the biggest release to date: 600+ commits, 70 new features, 200 bug fixes, 7 new packages (announced March 1, 2026)

---

## Supported Databases and Adapters

### Architecture

Better Auth uses **Kysely** as its default (built-in) database handler. All direct database connections go through Kysely under the hood. ORM adapters (Drizzle, Prisma) sit on top as an alternative path. Schema generation and migrations are handled by the Better Auth CLI.

---

### First-Class / Official Adapters

#### 1. Kysely (Built-in, default)

- Bundled with `better-auth` — no extra package needed
- Supports: **PostgreSQL** (via `pg` driver), **MySQL** (via `mysql2`), **SQLite** (via `better-sqlite3`)
- Also supports via Kysely dialects: MS SQL, Postgres.js, Supabase, PlanetScale, Cloudflare D1, AWS RDS Data API
- `getMigrations()` for programmatic migrations works **only** with the built-in Kysely adapter
- As of Better Auth 1.5: **Cloudflare D1** is natively supported as a first-class option (pass D1 binding directly)

Configuration example (PostgreSQL):
```ts
import { betterAuth } from "better-auth"
import { Pool } from "pg"

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
})
```

#### 2. Drizzle ORM Adapter

- Import: `"better-auth/adapters/drizzle"`
- Supported databases: **PostgreSQL**, **MySQL**, **SQLite**
- Provider must be specified explicitly: `"pg"` | `"mysql"` | `"sqlite"`
- Supports custom schema mappings (field renames)
- **Joins**: supported out of the box since v1.4.0
- CLI `generate` supports `--adapter drizzle` flag (v1.5+)
- Note: `getMigrations()` does **not** work with the Drizzle adapter — use CLI migrations instead

```ts
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "./database"

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg", // "pg" | "mysql" | "sqlite"
  }),
})
```

#### 3. Prisma Adapter

- Import: `"better-auth/adapters/prisma"`
- Supported databases: **PostgreSQL**, **MySQL**, **SQLite** (any database Prisma supports)
- Provider must be specified: `"postgresql"` | `"mysql"` | `"sqlite"`
- **Joins**: supported out of the box since v1.4.0 (requires `experimental.joins: true`)
- CLI `generate` supports `--adapter prisma` flag (v1.5+)
- If using a custom `output` path in `schema.prisma`, import PrismaClient from that path instead of `@prisma/client`

```ts
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    experimental: { joins: true },
  }),
})
```

#### 4. MongoDB Adapter

- Package: `@better-auth/mongo-adapter` (separate install)
- First-class official adapter for MongoDB (NoSQL)
- Mongoose users: extract the MongoDB client from Mongoose and pass it to the adapter

#### 5. Direct Database Adapters (v1.5+, separate packages)

In 1.5, adapters were split into focused packages to trim bundle size:

| Adapter | Doc URL |
|---------|---------|
| PostgreSQL | `better-auth.com/docs/adapters/postgresql` |
| MySQL | `better-auth.com/docs/adapters/mysql` |
| SQLite | `better-auth.com/docs/adapters/sqlite` |
| Other relational | `better-auth.com/docs/adapters/other-relational-databases` |

---

### Community Adapters

Better Auth maintains a community adapters page at `better-auth.com/docs/adapters/community-adapters`. Known community-maintained adapters include:

- **TypeORM** — `github.com/luratnieks/better-auth-typeorm-adapter` (production-ready)
- **Memory adapter** — `@better-auth/memory-adapter` (testing)

#### MikroORM

There is **no official Better Auth MikroORM adapter**. It does not appear in the official documentation or adapter list. The `MikroORM adapter` referenced in search results belongs to Auth.js (NextAuth), not Better Auth. For MikroORM + Better Auth, a custom adapter or community solution would be required.

---

## Bundle Size Optimization

When using Prisma, Drizzle, or MongoDB adapters, you can use:

```ts
import { betterAuth } from "better-auth/minimal"
```

This excludes Kysely from the bundle, reducing bundle size.

---

## Bun Compatibility

**Summary: Works in basic setups; known issues in specific environments.**

| Scenario | Status |
|----------|--------|
| `bun add better-auth` installation | Supported |
| Bun + Hono server | Works — documented examples exist |
| Bun + Next.js 16 (Bun runtime) | Known build failures (chunk resolution errors in server components, reported Dec 2025, issue #6781) |
| Bun migrations (Drizzle SQLite) | Known module resolution issues with `drizzle-orm` Bun SQLite driver (issue #2155) |
| AsyncLocalStorage | Better Auth uses it for context tracking; requires compatibility config in some environments (e.g., Cloudflare Workers) |

The official installation docs reference `bun add better-auth` as a valid install command. Community projects like `bun-hono-better-auth` demonstrate Bun usage in production. The main friction points are Next.js + Bun runtime and certain migration paths.

---

## Sources

- [Better Auth official site](https://better-auth.com/)
- [Drizzle ORM Adapter docs](https://better-auth.com/docs/adapters/drizzle)
- [Prisma adapter docs](https://better-auth.com/docs/adapters/prisma)
- [MongoDB adapter docs](https://better-auth.com/docs/adapters/mongo)
- [Community adapters](https://better-auth.com/docs/adapters/community-adapters)
- [Database concepts](https://better-auth.com/docs/concepts/database)
- [Better Auth 1.5 blog post](https://better-auth.com/blog/1-5)
- [npm: better-auth](https://www.npmjs.com/package/better-auth)
- [GitHub: better-auth/better-auth](https://github.com/better-auth/better-auth)
- [Bun compatibility issue #6781](https://github.com/better-auth/better-auth/issues/6781)
- [Bun migration issue #2155](https://github.com/better-auth/better-auth/issues/2155)
- [LogRocket: Better Auth overview](https://blog.logrocket.com/better-auth-authentication/)
- [TypeORM community adapter](https://github.com/luratnieks/better-auth-typeorm-adapter)
