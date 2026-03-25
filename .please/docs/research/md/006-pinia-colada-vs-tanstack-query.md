---
id: 006
title: "Pinia Colada vs TanStack Query for Vue"
url: ""
date: 2026-03-25
summary: "Comprehensive comparison of Pinia Colada (@pinia/colada) and TanStack Query (@tanstack/vue-query) for Vue 3 / Nuxt 4 projects, covering caching, SSR, devtools, TypeScript, oRPC integration, and ecosystem maturity."
tags: [vue, nuxt, caching, pinia-colada, tanstack-query, data-fetching]
---

# Pinia Colada vs TanStack Query for Vue

## 1. What is Pinia Colada?

**Pinia Colada** (`@pinia/colada`) is a smart data-fetching layer built on top of Pinia, the official Vue state-management library. It was created by **Eduardo San Martin Morote** (GitHub: `posva`), the author and maintainer of both Pinia and Vue Router. This lineage gives the library deep integration with the Vue core ecosystem.

- **Current stable version:** 1.0.0 (reached stable in early 2026)
- **Package name:** `@pinia/colada`
- **Nuxt module:** `@pinia/colada-nuxt`
- **Philosophy:** "Approachable, flexible, powerful, progressively adoptable" — mirroring Pinia's own design goals. The library intentionally targets Vue's reactivity system and avoids React-specific optimizations that have no place in a Vue-native library.
- **Dependency footprint:** ~2 kB baseline (minified + gzipped), zero runtime dependencies beyond Pinia itself.
- **GitHub:** https://github.com/posva/pinia-colada (~2.1k stars, 71 forks, 73 contributors as of Q1 2026)
- **npm:** https://www.npmjs.com/package/@pinia/colada

Eduardo has presented Pinia Colada at Vue Nation 2025 and Nuxt Nation 2024, describing the goal as giving Vue developers a first-class async state layer that "just feels like Vue."

---

## 2. What is TanStack Query for Vue?

**TanStack Query** (`@tanstack/vue-query`) is the Vue binding for TanStack Query (formerly React Query), one of the most widely adopted server-state libraries across all JS frameworks.

- **Current stable version:** v5 (latest ~5.95.x, last published hours ago as of 2026-03-25)
- **Package name:** `@tanstack/vue-query`
- **Devtools package:** `@tanstack/vue-query-devtools`
- **Philosophy:** Framework-agnostic server-state management. The core library (`@tanstack/query-core`) is shared across React, Vue, Solid, Svelte, and Angular adapters, meaning Vue-specific niceties are an adapter on top of the battle-tested React Query core.
- **Maturity:** The React Query core is extremely mature (5+ years), with the Vue adapter available since v4. TanStack Query v5 is the current major version.
- **GitHub (monorepo):** https://github.com/TanStack/query (~48.9k stars)
- **npm weekly downloads (`@tanstack/vue-query`):** ~339,000/week
- **npm weekly downloads (`@tanstack/react-query`):** ~12.3 million/week (illustrates the much larger React-driven community)

---

## 3. Feature Comparison

### 3.1 Caching Strategy (Stale-While-Revalidate)

Both libraries implement a **stale-while-revalidate (SWR)** caching model:

| Feature | Pinia Colada | TanStack Query (Vue) |
|---|---|---|
| `staleTime` | Yes (`staleTime` option, default `0`) | Yes (`staleTime` option, default `0`) |
| `gcTime` (garbage collection) | Yes (`gcTime` option) | Yes (`gcTime`, default 5 min) |
| `refetchOnMount` | Yes (`true` \| `false` \| `'always'`) | Yes (`true` \| `false` \| `'always'`) |
| `refetchOnWindowFocus` | Yes | Yes |
| Request deduplication | Yes (automatic) | Yes (automatic) |
| Background refetching | Yes | Yes |
| `placeholderData` (keep previous) | Yes | Yes |

**Key difference:** Pinia Colada exposes two refetch primitives — `refresh()` (respects staleTime, reuses in-flight requests) and `refetch()` (forces a new network request). TanStack Query exposes `refetch()` with a `cancelRefetch` parameter for similar control.

### 3.2 SSR / Nuxt Integration

**Pinia Colada** has first-class SSR support and ships its own official Nuxt module:

```bash
npx nuxi module add @pinia/colada-nuxt
```

- Does **not** require `await` at the component level for SSR — `useQuery` uses `onServerPrefetch` internally, so queries run and await automatically on the server.
- The Nuxt module handles serialization and hydration of query state from server to client.
- Includes Nuxt 4 compatibility notes and SSR-specific error serialization documentation.
- Listed on the official Nuxt modules page: https://nuxt.com/modules/pinia-colada

**TanStack Query** SSR support requires more manual configuration:

- There is no official TanStack-maintained Nuxt module. Community options include:
  - `@hebilicious/vue-query-nuxt` — auto-installs and configures with 0 config, very lightweight
  - `@peterbud/nuxt-query` — includes Nuxt DevTools integration
- Hydration is handled via `dehydrate()` / `HydrationBoundary` (ported from React Query's pattern).
- Official TanStack docs provide a Nuxt 3 example but no production-ready module.
- There have been reported Nuxt 3 SSR issues with `enabled` option and `suspense` mode (GitHub discussion #6419).

**Verdict for Nuxt:** Pinia Colada has a clear advantage with its official, first-party Nuxt module and zero-boilerplate SSR behavior.

### 3.3 Devtools

| | Pinia Colada | TanStack Query (Vue) |
|---|---|---|
| Package | `@pinia/colada-devtools` | `@tanstack/vue-query-devtools` |
| Approach | Standalone floating component added to app template | Standalone floating component (`<VueQueryDevtools />`) |
| Vue DevTools plugin | Bundled with Pinia Colada (via Pinia plugin integration) | Separate, community-level integration |
| Production exclusion | Stripped in production builds | Only included when `NODE_ENV === 'development'` |
| Nuxt DevTools | Via Nuxt module | Via `@peterbud/nuxt-query` community module |

Both provide query inspection, state visualization, and manual refetch/invalidation controls through a floating UI. TanStack's devtools are more mature and polished (given the larger React ecosystem that drives their development). Pinia Colada's devtools are actively improving but still early.

### 3.4 TypeScript Support

Both libraries are **fully TypeScript-native** with no `@types/` packages needed.

**Pinia Colada:**
- `defineQueryOptions()` enables reusable, fully typed query definitions
- Query cache access is type-safe: `queryCache.getQueryData(key)` returns the correct type when using `defineQueryOptions`
- Status narrowing via the `state` object groups `status`, `data`, and `error` so TypeScript can narrow types correctly
- `MaybeRefOrGetter` type for reactive query keys (keys cannot contain raw `Ref` or `ComputedRef` — use `toValue()` instead)

**TanStack Query:**
- Equally strong TypeScript support across all adapters
- `queryOptions()` helper (introduced in v5) mirrors Pinia Colada's `defineQueryOptions()`
- Full inference of `data`, `error`, and `status` from generic parameters
- v5 removed the need for explicit type annotations in most cases via improved inference

Both are roughly equivalent on TypeScript DX. TanStack Query v5's improvements have closed the gap with Pinia Colada's design.

### 3.5 Bundle Size

| Package | Minified | Min + Gzip (approx.) |
|---|---|---|
| `@pinia/colada` | ~10–12 kB | ~4–5 kB |
| `@tanstack/vue-query` | ~35–40 kB | ~12–14 kB |
| `@tanstack/query-core` (shared) | included above | included above |

Note: Pinia Colada requires Pinia as a peer dependency (~5 kB min+gzip), but most Vue apps already include Pinia. TanStack Query includes its own standalone query core and has no Pinia dependency.

Pinia Colada is significantly smaller when Pinia is already a project dependency. For a Vue app without Pinia, TanStack Query can be used without adopting a separate state manager.

### 3.6 Mutation Handling

Both use `useMutation()` with similar APIs:

| Feature | Pinia Colada | TanStack Query |
|---|---|---|
| `mutate()` / `mutateAsync()` | Yes | Yes |
| `onMutate` (optimistic) | Yes | Yes |
| `onSuccess`, `onError`, `onSettled` | Via `PiniaColadaQueryHooksPlugin` (global) or per-mutation | Per-mutation and globally on `QueryClient` |
| `isPending`, `isError`, `isSuccess` | Yes | Yes |
| Mutation state reset | Yes | Yes (`reset()`) |

**Key difference:** In Pinia Colada, the global `onSuccess`, `onError`, and `onSettled` hooks were moved out of the base `PiniaPlugin` into a separate `PiniaColadaQueryHooksPlugin` — this must be explicitly registered. TanStack Query exposes these globally via `MutationCache` callbacks on the `QueryClient`.

### 3.7 Optimistic Updates

Both support optimistic updates via the `onMutate` callback pattern:

1. In `onMutate`: save the previous cache value and apply the optimistic update via `queryCache.setQueryData()`
2. In `onError`: rollback using the saved value
3. In `onSettled`: invalidate the query to refetch fresh data

The API and flow are nearly identical between the two libraries. Pinia Colada uses `useQueryCache()` to access the cache; TanStack uses `useQueryClient()`.

### 3.8 Infinite Queries / Pagination

**Pinia Colada:**
- `useInfiniteQuery()` is available and stable as of v1.0
- The API changed significantly in a recent 1.x release: the `merge` option was removed, and `data` now contains an object with `pages` and `pageParams` arrays (aligning with TanStack's model)
- Cursor-based and page-based pagination are both supported
- Regular `useQuery()` with a page in the key also works for simple paginated fetches

**TanStack Query:**
- `useInfiniteQuery()` is mature and battle-tested
- Supports `getNextPageParam`, `getPreviousPageParam`, `hasNextPage`, `hasPreviousPage`
- Also supports bidirectional infinite queries

**Verdict:** TanStack Query has more mature and feature-rich infinite query support. Pinia Colada's `useInfiniteQuery` reached parity in v1.0 but has less community documentation.

### 3.9 Polling / Refetch Intervals

**Pinia Colada** handles polling via a dedicated plugin rather than a built-in option:

```bash
npm install @pinia/colada-plugin-auto-refetch
```

The `autoRefetch` option accepts:
- `true` — reuse `staleTime` as the interval
- `number` — custom interval in milliseconds
- `function` — conditional logic based on query state

**TanStack Query** includes polling as a first-class built-in option:

```ts
useQuery({ queryKey: ['todos'], queryFn: fetchTodos, refetchInterval: 5000 })
```

`refetchIntervalInBackground` controls whether polling continues when the tab is hidden.

**Verdict:** TanStack Query's first-class `refetchInterval` is simpler and requires no additional plugin. Pinia Colada's plugin approach keeps the core lean but adds install friction.

### 3.10 Query Invalidation

Both support tag/key-based cache invalidation:

**Pinia Colada:**
```ts
const queryCache = useQueryCache()
queryCache.invalidateQueries({ key: ['todos'] }) // partial key match
```

**TanStack Query:**
```ts
const queryClient = useQueryClient()
queryClient.invalidateQueries({ queryKey: ['todos'] }) // partial key match
```

The APIs are essentially identical in semantics. Both support hierarchical key matching where `['todos']` invalidates all queries whose key starts with `'todos'`.

---

## 4. Pinia Integration: Native vs. Standalone

**Pinia Colada** is architecturally Pinia-native. The query cache is stored as a Pinia store, meaning:
- Query state is automatically visible in Vue DevTools under the Pinia panel
- You can access query state from within other Pinia stores via `useQueryCache()`
- No separate client/provider setup — it works with the existing Pinia instance
- Setup: `app.use(PiniaColada)` (one line after `app.use(pinia)`)

**TanStack Query** is standalone and independent of Pinia:
- Requires wrapping the app with `VueQueryPlugin` and creating a `QueryClient`
- Query state is isolated from Pinia — cannot be read from Pinia stores without manual bridging
- For apps using Pinia for other state, TanStack Query introduces a second state management layer
- The TanStack docs explicitly address this: "Does TanStack Query replace Pinia?" — the answer is no, they serve different purposes, but the dual-layer can feel redundant

**Verdict:** For Vue/Nuxt apps already using Pinia, Pinia Colada's native integration provides a more cohesive developer experience. For apps not using Pinia, TanStack Query avoids forcing the Pinia adoption.

---

## 5. oRPC Integration

oRPC (Typesafe APIs Made Simple) supports both libraries as first-class integrations:

### `@orpc/vue-colada` (Pinia Colada)

```ts
import { createPiniaColada } from '@orpc/vue-colada'
const orpc = createPiniaColada({ client: orpcClient })

// Usage
const { data } = useQuery(orpc.planet.find.queryOptions({ id: 1 }))
const mutation = useMutation(orpc.planet.create.mutationOptions())
queryCache.invalidateQueries({ key: orpc.planet.list.key() })
```

### `@orpc/vue-query` (TanStack Query)

```ts
import { createTanstackQuery } from '@orpc/vue-query'
const orpc = createTanstackQuery({ client: orpcClient })

// Usage
const { data } = useQuery(orpc.planet.find.queryOptions({ id: 1 }))
const { data: pages } = useInfiniteQuery(orpc.planet.list.infiniteOptions({ ... }))
const mutation = useMutation(orpc.planet.create.mutationOptions())
queryClient.invalidateQueries({ queryKey: orpc.planet.list.key() })
```

**Key oRPC differences:**

| Feature | `@orpc/vue-colada` | `@orpc/vue-query` |
|---|---|---|
| `useInfiniteQuery` support | Yes (as of v1) | Yes (mature) |
| Cache invalidation utility | `queryCache.invalidateQueries` | `queryClient.invalidateQueries` |
| `queryOptions()` helper | `defineQueryOptions` pattern | `queryOptions()` |
| Type safety | Full inference | Full inference |

Both integrations are officially maintained by the oRPC project (`unnoq/orpc`) and provide equivalent type-safe ergonomics. The choice between them follows whichever query library is already in the project.

---

## 6. Community & Ecosystem

| Metric | Pinia Colada | TanStack Query (Vue) |
|---|---|---|
| GitHub stars | ~2.1k (posva/pinia-colada) | ~48.9k (TanStack/query, all adapters) |
| npm weekly downloads | ~15–20k (est.) | ~339k |
| Stable since | 2026 (v1.0) | 2022 (v4), v5 in 2023 |
| Maintainer | Eduardo San Martin Morote (Vue core team) | Tanner Linsley + TanStack team |
| Vue-specific focus | 100% | Partial (adapter over React core) |
| Community tutorials | Growing (Vue School, Vue Mastery) | Large (React ecosystem knowledge transfers) |
| Third-party plugins | Early-stage | Extensive (React-side matures faster) |
| Migration guide | Provides guide from TanStack → Pinia Colada | N/A |

TanStack Query is vastly more popular due to React ecosystem adoption. However, `@tanstack/vue-query` downloads (~339k/week) are already substantial for a Vue library, reflecting strong adoption.

Pinia Colada is newer (reached v1.0 stable in early 2026) but is developed by the person who maintains Pinia and Vue Router — providing strong long-term maintenance confidence within the Vue ecosystem.

---

## 7. Nuxt Module Support

| | Pinia Colada | TanStack Query |
|---|---|---|
| Official Nuxt module | `@pinia/colada-nuxt` (official, first-party) | None (no TanStack-owned module) |
| Community module(s) | N/A | `@hebilicious/vue-query-nuxt`, `@peterbud/nuxt-query` |
| Nuxt modules directory | Yes: https://nuxt.com/modules/pinia-colada | Yes: https://nuxt.com/modules/nuxt-query |
| Zero-config SSR | Yes | Requires manual QueryClient setup |
| Auto-imports | Via `@pinia/colada-nuxt` | Via community modules |
| Nuxt DevTools integration | Via Nuxt module | Via `@peterbud/nuxt-query` |

Pinia Colada's official Nuxt module is a clear advantage for Nuxt 4 projects. The community TanStack modules are functional but are not maintained by TanStack itself.

---

## 8. Summary and Recommendation

### Choose Pinia Colada when:
- Building a **Nuxt 4** project (first-class official module)
- Already using **Pinia** for state management (native integration, single devtools pane)
- **Bundle size** is a priority (significantly smaller)
- You want **Vue-native** ergonomics and official Vue ecosystem support
- Working with **oRPC** (both integrations are equivalent, but Pinia Colada is more idiomatic in a Vue-first stack)
- You prefer a **single maintainer with Vue core team alignment**

### Choose TanStack Query when:
- Your team has **existing TanStack Query expertise** (from React projects)
- You need **mature infinite query** capabilities with extensive documentation
- You need **first-class polling** without additional plugins
- You are building a Vue app **without Pinia** and don't want to add it
- You need the **largest possible community** and ecosystem of third-party integrations
- You value **battle-tested stability** (5+ years of React Query heritage)

### For new Vue 3 / Nuxt 4 greenfield projects in 2026:
Pinia Colada is the more idiomatic choice. It has reached v1.0 stable, has official Nuxt support, is maintained by a Vue core team member, and is significantly smaller. TanStack Query remains the safer bet if your team already knows it or if you need features Pinia Colada lacks (mature polling plugin, larger community, more battle-tested edge cases).

---

## Sources

- [Pinia Colada official docs](https://pinia-colada.esm.dev/)
- [Pinia Colada GitHub](https://github.com/posva/pinia-colada)
- [Pinia Colada — Why?](https://pinia-colada.esm.dev/why.html)
- [Pinia Colada — Nuxt integration](https://pinia-colada.esm.dev/nuxt.html)
- [Pinia Colada — Migration from TanStack Vue Query](https://pinia-colada.esm.dev/cookbook/migration-tvq.html)
- [@pinia/colada on npm](https://www.npmjs.com/package/@pinia/colada)
- [@pinia/colada-nuxt on npm](https://www.npmjs.com/package/@pinia/colada-nuxt)
- [@pinia/colada-devtools on npm](https://www.npmjs.com/package/@pinia/colada-devtools)
- [@pinia/colada-plugin-auto-refetch on npm](https://www.npmjs.com/package/@pinia/colada-plugin-auto-refetch)
- [TanStack Query Vue overview](https://tanstack.com/query/v5/docs/framework/vue/overview)
- [TanStack Query GitHub](https://github.com/TanStack/query)
- [@tanstack/vue-query on npm](https://www.npmjs.com/package/@tanstack/vue-query)
- [@tanstack/vue-query-devtools on npm](https://www.npmjs.com/package/@tanstack/vue-query-devtools)
- [Pinia Colada Nuxt module listing](https://nuxt.com/modules/pinia-colada)
- [nuxt-query module listing](https://nuxt.com/modules/nuxt-query)
- [vue-query-nuxt module listing](https://nuxt.com/modules/vue-query)
- [oRPC Pinia Colada integration docs](https://orpc.dev/docs/integrations/pinia-colada)
- [oRPC TanStack Query Vue integration docs](https://orpc.dev/docs/integrations/tanstack-query-old/vue)
- [@orpc/vue-colada on npm](https://www.npmjs.com/package/@orpc/vue-colada)
- [@orpc/vue-query on npm](https://www.npmjs.com/package/@orpc/vue-query)
- [Smarter Data Fetching with Pinia Colada — Vue School](https://vueschool.io/articles/vuejs-tutorials/smarter-data-fetching-with-pinia-colada/)
- [Streamlining Data Fetching in Nuxt with Pinia Colada — Vue School](https://vueschool.io/articles/news/streamlining-data-fetching-in-nuxt-with-pinia-colada-insights-from-eduardo-s-m-morotes-nuxt-nation-2024-talk/)
- [Pinia Colada talk slides 2025](https://2025-talk-pinia-colada.netlify.app/)
- [Pinia News Roundup — Mastering Pinia](https://masteringpinia.com/blog/pinia-news-roundup-exciting-updates-from-eduardo)
