---
id: 005
title: "oRPC - Typesafe APIs Made Simple"
url: "https://orpc.dev/"
date: 2026-03-25
summary: "oRPC is a TypeScript RPC library that combines end-to-end type safety with first-class OpenAPI generation, bridging the gap between tRPC-style DX and contract-first API design. Version 1.0 shipped in late 2025 with stable production-ready APIs."
tags: [typescript, rpc, openapi, api, tanstack-query, trpc-comparison]
---

# oRPC - Typesafe APIs Made Simple

## What is oRPC?

oRPC is a TypeScript library for building APIs that are simultaneously **end-to-end type-safe** (like tRPC) and **OpenAPI-compliant** (like ts-rest). Its philosophy is "powerful simplicity": define endpoints almost as easily as writing plain functions, and automatically gain type safety, OpenAPI spec generation, contract-first workflow support, and Server Action compatibility.

Version 1.0 was released in late 2025, marking stable, production-ready public APIs. The project is MIT-licensed and maintained full-time by its creator.

GitHub: https://github.com/unnoq/orpc

---

## 1. Core Features and Philosophy

**Philosophy: Powerful Simplicity**

The creator built oRPC after frustrations with tRPC (no native OpenAPI on Edge), ts-rest (missing middleware and native type support), and trpc-openapi (deprecated). The goal is a single library that does not force you to choose between type safety and standards compliance.

**Highlights:**

| Feature | Detail |
|---------|--------|
| End-to-end type safety | Inputs, outputs, and errors are all typed from server to client |
| First-class OpenAPI | Built-in, not a plugin — generates full OpenAPI 3.x specs from your router |
| Contract-first (optional) | Define the API contract (`@orpc/contract`) independently before implementing |
| Standard Schema support | Works with Zod, Valibot, ArkType, and any Standard Schema-compliant validator |
| Native types | `Date`, `File`, `Blob`, `BigInt`, `URL` serialized correctly over the wire |
| SSE & streaming | Full type-safe server-sent events and streaming responses |
| Server Actions | Compatible with Next.js and TanStack Start React Server Actions |
| Lazy routing | Deferred procedure loading to improve cold-start times on serverless |
| Middleware / interceptors | Composable, typed middleware chain (auth, rate-limit, telemetry, retry) |
| OpenTelemetry | First-class `@orpc/otel` package for observability |
| Multi-runtime | Node.js, Bun, Deno, Cloudflare Workers, and other edge runtimes |

**Core API shape:**

```ts
import { os } from '@orpc/server'
import * as z from 'zod'

export const createPlanet = os
  .$context<{ headers: IncomingHttpHeaders }>()
  .use(authMiddleware)              // composable typed middleware
  .route({ method: 'POST', path: '/planets' })
  .input(z.object({ name: z.string() }))
  .errors({ QUOTA_EXCEEDED: { data: z.object({ limit: z.number() }) } })
  .handler(async ({ input, context }) => {
    return db.planet.create(input)
  })
  .actionable()   // React Server Action compatible
  .callable()     // plain function compatible
```

OpenAPI spec generation is one additional step:

```ts
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'

const spec = await new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()]
}).generate(router, { info: { title: 'My API', version: '1.0.0' } })
```

---

## 2. How it Compares to tRPC

| Dimension | tRPC | oRPC |
|-----------|------|------|
| Type safety | End-to-end (server inferred) | End-to-end (server inferred) |
| OpenAPI support | Via deprecated plugin (trpc-openapi) | Built-in, first-class |
| Edge runtime OpenAPI | Broken / deprecated | Works natively |
| Frontend query libraries | Primarily React Query | TanStack Query (React, Vue, Solid, Svelte, Angular), SWR, Pinia Colada |
| Contract-first workflow | Not supported | Optional via `@orpc/contract` |
| Server Actions | Limited | Full compatibility |
| Native types (Date, File) | Limited | Full support |
| Bundle size | ~65.5 kB | ~32.3 kB (2x smaller) |
| Runtime throughput (benchmark) | ~104k req/20s | ~295k req/20s (2.8x faster) |
| TypeScript check speed | baseline (9.3s) | 1.6x faster (5.9s) |
| RAM usage | ~268 MB | ~103 MB (2.6x less) |
| Ecosystem maturity | Large, well-established | Growing, stable since v1 (late 2025) |

**Key takeaway:** oRPC gives tRPC-style DX with substantially better performance, smaller bundle, and without the OpenAPI trade-off. The main risk is a smaller ecosystem and community.

---

## 3. TypeScript Support

oRPC is TypeScript-native:

- **Full inference**: Input/output types flow from server handler to client call site with no code generation step.
- **Type-safe errors**: Errors defined on procedures are typed on the client (`ORPCError` with discriminated union).
- **Standard Schema**: Compatible with Zod v3/v4, Valibot, ArkType — not locked to one validator.
- **Strict generics**: Contract and implementation types are separately tracked; `@orpc/contract` types can be used independently of the server package.
- **No codegen required**: Unlike REST + OpenAPI, type safety is structural and live — changing a handler type updates the client immediately.
- **TypeScript check performance**: 1.6x faster than tRPC due to more efficient type structures.

Packages:
- `@orpc/contract` — define typed API contract
- `@orpc/server` — implement handlers, router
- `@orpc/client` — consume with full inference
- `@orpc/openapi` — generate spec (does not break TS types)

---

## 4. Caching / TanStack Query Integration

oRPC has a dedicated `@orpc/tanstack-query` package (also available as `@orpc/react-query`, `@orpc/vue-query`, etc.).

**Setup:**

```ts
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { orpc } from './client'

const utils = createTanstackQueryUtils(orpc)
```

**Usage in React:**

```tsx
// useQuery — fully typed input/output
const { data } = useQuery(utils.planet.list.queryOptions({ limit: 10 }))

// useMutation with cache invalidation
const mutation = useMutation({
  ...utils.planet.create.mutationOptions(),
  onSuccess: () => queryClient.invalidateQueries(utils.planet.list.queryKey())
})

// Prefetch on server (SSR/RSC)
await queryClient.prefetchQuery(utils.planet.list.queryOptions({ limit: 10 }))
```

**Framework support via TanStack Query:**
- React (`@orpc/react-query`)
- Vue (`@orpc/vue-query`)
- Solid (`@orpc/solid-query`)
- Svelte (`@orpc/svelte-query`)
- Angular (`@orpc/angular-query`)

**Other integrations:**
- SWR — `@orpc/experimental-react-swr`
- Pinia Colada (Vue) — `@orpc/vue-colada`
- NestJS — `@orpc/nest`
- Hey API (OpenAPI client gen) — `@orpc/hey-api`

All query keys, options, and cache invalidation helpers are type-safe — no string-based keys.

---

## 5. oRPC vs GraphQL

### When to Choose oRPC

| Scenario | Reason |
|----------|--------|
| TypeScript-only monorepo (fullstack) | Zero-overhead type sharing, no codegen step |
| Need OpenAPI + type safety together | oRPC generates both; GraphQL requires separate REST bridge |
| Small–medium API surface | Simpler setup, no schema language to learn |
| Serverless / edge deployment | Lightweight, lazy routing, wide runtime support |
| React Server Actions + RPC | Built-in `.actionable()` compatibility |
| Team wants REST-compatible HTTP endpoints | `route()` decorator maps procedures to REST paths |
| Need SSE / streaming | First-class typed support |

### When to Choose GraphQL

| Scenario | Reason |
|----------|--------|
| Complex, deeply nested data with selective fetching | GraphQL's selection sets eliminate over-fetching at field level |
| Public or third-party API | Language-agnostic, wide tooling ecosystem (Apollo, Relay, codegen) |
| Multiple consumers with different data needs | Clients self-select fields; avoids N endpoint proliferation |
| Existing GraphQL infrastructure | Schema federation, subscriptions via existing tooling |
| Cross-language backends | GraphQL is runtime-agnostic; oRPC requires TypeScript on the server |
| Real-time subscriptions with complex filtering | GraphQL subscriptions + filter directives are more expressive |

### Summary Comparison

| Dimension | oRPC | GraphQL |
|-----------|------|---------|
| Type safety mechanism | TypeScript inference (live) | Codegen from schema |
| Query flexibility | Fixed procedure outputs | Client-driven field selection |
| Over-fetching | Possible (returns full objects) | Eliminated by design |
| API language | TypeScript | GraphQL SDL (language-agnostic) |
| Third-party consumers | Via generated OpenAPI spec | Native (self-documenting schema) |
| Learning curve | Low (TypeScript functions) | Medium (SDL, resolvers, directives) |
| Bundle size | Small (~32 kB) | Larger (Apollo Client ~30–100 kB+) |
| Streaming / SSE | First-class | Subscriptions (WebSocket-based) |
| OpenAPI generation | Built-in | Not applicable |

**Bottom line:** oRPC is the better choice when your team is TypeScript-first and you want tRPC-level DX without losing OpenAPI compatibility. GraphQL wins for complex, public-facing, or cross-language APIs where flexible field selection and a language-agnostic contract matter most.

---

## Sources

- [oRPC Official Site](https://orpc.dev/)
- [oRPC v1 Announcement](https://orpc.dev/blog/v1-announcement)
- [GitHub: unnoq/orpc](https://github.com/unnoq/orpc)
- [tRPC vs oRPC - LogRocket Blog](https://blog.logrocket.com/trpc-vs-orpc-type-safe-rpc/)
- [oRPC Releases Version 1.0 - InfoQ](https://www.infoq.com/news/2025/12/orpc-v1-typesafe/)
- [TanStack Query Integration - oRPC Docs](https://orpc.dev/docs/integrations/tanstack-query)
- [Typesafe APIs Made Simple with oRPC - Zuplo](https://zuplo.com/blog/typesafe-apis-made-simple-with-orpc)
- [ORPC 1.0 - Hacker News Discussion](https://news.ycombinator.com/item?id=43695365)
