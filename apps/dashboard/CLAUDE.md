# Dashboard — Claude Code Instructions

## Design System

See [Dashboard Design System Decision](../../.please/docs/decisions/dashboard-design-system.md) for the full rationale.

| Category | Choice | Package |
|----------|--------|---------|
| Style    | Nova   | — |
| Base     | Zinc   | — |
| Theme    | Blue   | — |
| Font     | Inter  | Google Fonts |
| Icons    | Lucide | `lucide-vue-next` |

## Stack

- **Framework:** Vue 3 + TypeScript
- **UI:** [shadcn-vue](https://www.shadcn-vue.com/) v4 (Reka UI primitives)
- **Styling:** Tailwind CSS v4 (oklch tokens)
- **Routing:** vue-router v5
- **State:** `@vueuse/core` composables
- **Build:** Vite v8
- **Dark Mode:** `useColorMode` from `@vueuse/core` with `.dark` class strategy
