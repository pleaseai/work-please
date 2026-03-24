---

## id: 001 title: "MikroORM Evaluation: Databases, Edge/Serverless, Bun, Migrations, Bundle Size" url: https://mikro-orm.io/docs/installation date: 2026-03-24 summary: "Comprehensive evaluation of MikroORM covering supported databases, edge/serverless compatibility, Bun runtime support, migration tooling, and bundle size characteristics as of v6/v7." tags: \[mikro-orm, orm, typescript, database, serverless, bun, migrations\]

# MikroORM Evaluation

Sources: [Installation](https://mikro-orm.io/docs/installation) | [Usage with SQL](https://mikro-orm.io/docs/usage-with-sql) | [Configuration](https://mikro-orm.io/docs/configuration) | [v7 Release Blog](https://mikro-orm.io/blog/mikro-orm-7-released) | [Deployment Docs](https://mikro-orm.io/docs/deployment) | [GitHub](https://github.com/mikro-orm/mikro-orm) | [npm](https://www.npmjs.com/package/mikro-orm)

---

## 1. Supported Databases

MikroORM supports the following databases, each via a separate driver package:

| Database | Package | Notes |
| --- | --- | --- |
| PostgreSQL | `@mikro-orm/postgresql` | Also covers CockroachDB (wire-compatible) |
| MySQL | `@mikro-orm/mysql` |  |
| MariaDB | `@mikro-orm/mariadb` |  |
| SQLite | `@mikro-orm/sqlite` | Uses `better-sqlite3` |
| libSQL / Turso | `@mikro-orm/libsql` | Edge-compatible SQLite fork |
| better-sqlite | `@mikro-orm/better-sqlite` | Alternative SQLite driver |
| MS SQL Server | `@mikro-orm/mssql` |  |
| Oracle DB | `@mikro-orm/oracledb` | New in recent releases, powered by `oracledb` |
| MongoDB | `@mikro-orm/mongodb` |  |
| node:sqlite | (built-in) | Node.js 22+ built-in SQLite; zero native deps |

Installation pattern (example for PostgreSQL):

```bash
bun add @mikro-orm/core @mikro-orm/postgresql
# or for SQLite
bun add @mikro-orm/core @mikro-orm/sqlite better-sqlite3
```

If using `@mikro-orm/cli`, `@mikro-orm/migrations`, or `@mikro-orm/entity-generator`, install `@mikro-orm/core` explicitly alongside them.

---

## 2. Edge / Serverless Support

**Short answer: Limited and not recommended for true edge runtimes.**

### Cloudflare Workers

- Most of `@mikro-orm/core` can technically run in a Worker environment, but it is **not recommended**.
- The historical blocker was the Knex layer — bundlers could not effectively tree-shake it because of CommonJS dynamic requires.
- Bundle size was \~4–5 MB unminified, 1–2 MB minified — too heavy for Workers' 1 MB compressed script limit.
- Cold start overhead from the Knex initialization added **300–600 ms** per invocation.
- MikroORM v7 removed Knex entirely (see Section 5), which significantly improves this situation, but official edge support is still not a stated goal.

### new Function / eval Restriction

- Some runtimes (Cloudflare Workers, Vercel Edge) **prohibit** `new Function` **/** `eval`.
- MikroORM uses `new Function` at runtime to JIT-compile optimized per-entity hydration and comparison functions.
- This is a hard blocker for those environments unless a pre-compilation step is used.

### Cloudflare D1

- There is community discussion about supporting Cloudflare D1 (SQLite over HTTP) via the `@mikro-orm/libsql` driver, but no official D1 driver exists yet.

### Vercel / AWS Lambda (traditional serverless, not edge)

- Works with standard Node.js runtimes on Lambda or Vercel Serverless Functions (not Edge Functions).
- Cold start concerns exist but are less severe than on true edge runtimes.

### Recommended Alternatives for Edge

- Use **Drizzle ORM** (\~7 KB bundle, zero cold start overhead) for Cloudflare Workers / Vercel Edge.
- MikroORM is better suited for long-running Node.js services or container-based deployments.

---

## 3. Bun Compatibility

**Status: Works as a package manager and runtime for standard use cases;** `bun:sqlite` **not officially supported.**

### Package Manager

- All MikroORM packages are installable via `bun add`.

### Runtime (bun run / bun server)

- MikroORM runs on Bun for standard server applications (e.g., Elysia.js + MikroORM + libSQL examples exist in the official mikro-orm-examples repo).
- There is no known blocking incompatibility for typical Node.js-compatible usage on Bun.

### bun:sqlite

- Bun ships its own built-in SQLite API (`bun:sqlite`), which is incompatible with `@mikro-orm/sqlite` (which uses `better-sqlite3`).
- There is an open community discussion ([#5700](https://github.com/mikro-orm/mikro-orm/discussions/5700)) requesting a `bun:sqlite` driver, but no official driver has shipped as of the research date.
- The `@mikro-orm/libsql` driver may work as an alternative since libSQL is SQLite-compatible and works in Bun.

### MikroORM v7 + Bun

- v7's native ESM output and zero-dependency `@mikro-orm/core` improve Bun compatibility since Bun handles ESM natively.

---

## 4. Migration Tooling

MikroORM has a mature, integrated migration system.

### Packages

| Package | Purpose |
| --- | --- |
| `@mikro-orm/migrations` | SQL migrations (for SQL drivers) |
| `@mikro-orm/migrations-mongodb` | Migrations for MongoDB |
| `@mikro-orm/entity-generator` | Reverse-engineer entities from an existing DB schema |
| `@mikro-orm/cli` | CLI commands for migration management |

### Key Features

- **Auto-diff migrations**: generates migration files by diffing the current schema against entities.
- **Transactional**: each migration runs inside a transaction by default; all migrations wrapped in a master transaction (rollback on failure).
- **Snapshot-based**: stores a schema snapshot to enable accurate diffs between migration runs.
- **CLI commands**: `migration:create`, `migration:up`, `migration:down`, `migration:list`, `migration:pending`, `migration:fresh`.
- **umzug removed**: recent versions removed the `umzug` dependency, improving bundler support and reducing package weight.
- **Read-only filesystem support**: snapshot writes on `migration:up` can be skipped (for environments like Lambda where the filesystem is read-only); snapshot file is also deleted on `migration:down`.

### Configuration Example

```ts
MikroORM.init({
  migrations: {
    path: './migrations',
    transactional: true,
    allOrNothing: true,
    snapshot: true,
  },
})
```

---

## 5. Bundle Size / Performance

### MikroORM v5 and Earlier (Knex-based)

- `@mikro-orm/core` had many runtime dependencies: `knex`, `dotenv`, `esprima`, `reflect-metadata`, `dataloader`, `globby`, etc.
- Total bundle: \~4–5 MB unminified, \~1–2 MB minified.
- Cold start penalty in serverless: **300–600 ms** from Knex initialization.

### MikroORM v6

- Began reducing dependencies; introduced ESM output.
- Still carried some of the Knex legacy.

### MikroORM v7 ("Unchained") — Current Major Version

- **Zero runtime dependencies** in `@mikro-orm/core` — dropped `knex`, `dotenv`, `esprima`, `reflect-metadata`, `dataloader`, `globby`, and all others.
- **Native ESM** package (no CJS dual-publish complexity).
- **No hard coupling to Node.js** — opens the door for Bun, Deno, and edge-adjacent runtimes.
- Bundle size and cold start times improved significantly, though exact post-v7 numbers are not publicly benchmarked yet.
- Still larger than lightweight alternatives (Drizzle \~7 KB) due to the full Data Mapper / Unit of Work / Identity Map pattern implementation.

### Comparison Context (from community analysis)

- Drizzle ORM: \~7 KB bundle, zero cold start — preferred for edge.
- Prisma: heavy due to query engine binary.
- MikroORM v7: medium weight, best suited for Node.js/Bun long-running services.

---

## 6. Latest Version and Recent Changes

### Current Versions (as of 2026-03-24)

- **v7.x** — current major version on npm (`mikro-orm@7.0.4` observed on npm; active development).
- **v6.5.x** — latest v6 release (v6.5.0 released 2025-08-27), still receiving maintenance patches.

### v7 Highlights (Major Release)

- Removed Knex entirely — zero core dependencies.
- Native ESM output.
- Removed `reflect-metadata` requirement (uses its own metadata storage).
- Added Oracle DB support (`@mikro-orm/oracledb`).
- Added `node:sqlite` support (Node.js 22+ built-in — zero native dependencies for SQLite).
- Removed `umzug` from migrations package.
- Snapshot writes skippable on `migration:up` for read-only filesystem support.
- Snapshot deleted on `migration:down`.

### Recent Additions (2025)

- `@mikro-orm/oracledb` package (Oracle Database support).
- Node.js 22 `node:sqlite` built-in module support.
- Improved bundler tree-shaking due to ESM-first architecture.

---

## Summary Assessment

| Dimension | Rating | Notes |
| --- | --- | --- |
| DB breadth | Excellent | 9+ databases including Oracle, libSQL, node:sqlite |
| Edge/Serverless | Poor–Fair | Not recommended for Cloudflare Workers / Vercel Edge due to `new Function` and bundle size; fine on traditional serverless (Lambda) |
| Bun support | Good | Works on Bun runtime; no `bun:sqlite` driver yet |
| Migration tooling | Excellent | Auto-diff, transactional, snapshot-based, CLI included |
| Bundle size (v7) | Fair–Good | Zero deps in core, but still heavier than Drizzle for edge use cases |
| Production maturity | Excellent | Active project, v7 is a significant modernization |
