# Dashboard Design System Decisions

**Date:** 2026-03-17
**Status:** Decided
**Context:** Choosing shadcn-vue v4 design tokens for the `@pleaseai/dashboard` Vue.js SPA.

## Decision

| Category   | Choice          | Rationale                                                        |
|------------|-----------------|------------------------------------------------------------------|
| **Style**  | Nova            | Compact padding/margins suited for a data-dense monitoring dashboard |
| **Base**   | Zinc            | Cool gray with subtle blue-purple tint; standard for dev tools (VS Code, GitHub, Linear) |
| **Theme**  | Blue            | Professional, trustworthy; good chart gradient for status visualization |
| **Font**   | Inter           | Designed for UIs; excellent `tabular-nums` support for metric cards and tables |
| **Icons**  | Lucide          | shadcn-vue v4 default; 1,500+ icons, tree-shakeable via `lucide-vue-next` |

## Alternatives Considered

### Style
- **Vega** — classic shadcn look, but too spacious for a dashboard
- **Mira** — even more compact than Nova, could feel cramped
- **Maia** — soft/rounded, better for consumer apps than dev tools
- **Lyra** — boxy/sharp, better for mono-font-heavy UIs

### Base Color
- **Neutral** — pure achromatic gray; too flat, lacks personality
- **Stone** — warm/beige tint; feels more like a CMS than a dev tool
- **Gray** — stronger blue tint; could clash with Blue theme primary

### Theme
- **Violet** — modern (Linear/Raycast style), but less conventional for monitoring
- **Neutral (no accent)** — too plain for chart differentiation
- **Emerald/Green** — implies "success" semantically; conflicts with status badges

### Icons
- **Radix Icons** — legacy shadcn choice (v3), only ~300 icons, removed from v4 registry
- **@iconify/vue** — universal adapter, but adds indirection; shadcn-vue v4 imports directly
- **Hugeicons / Phosphor / Tabler / Remix** — supported by v4 registry but Lucide is the default

### Font
- **Geist Sans** — Vercel's default; good but Inter has wider adoption and better tabular numbers
- **JetBrains Mono** — monospace; good for code, not for dashboard body text

## shadcn-vue v4 Registry Reference

### Available Styles
`vega` | `nova` | `maia` | `lyra` | `mira`

### Available Base Colors
`neutral` | `stone` | `zinc` | `gray`

### Available Themes (accent colors)
`amber` | `blue` | `cyan` | `emerald` | `fuchsia` | `green` | `indigo` | `lime` | `orange` | `pink` | `purple` | `red` | `rose` | `sky` | `teal` | `violet` | `yellow`

### Available Icon Libraries
`lucide` | `hugeicons` | `phosphor` | `remixicon` | `tabler`

### Available Fonts
`Geist Sans` | `Inter` | `Noto Sans` | `Nunito Sans` | `Figtree` | `Roboto` | `Raleway` | `DM Sans` | `Public Sans` | `Outfit` | `JetBrains Mono`

## Implementation Notes

- All v4 themes use **oklch** color space (not HSL)
- Base colors define the full token set (background, foreground, card, border, muted, etc.)
- Accent themes only override `primary`, `primary-foreground`, `chart-*`, and `sidebar-primary`
- Dark mode uses `.dark` class on `<html>` with `useColorMode` from `@vueuse/core`
- FOUC prevention via inline `<script>` in `index.html` reading `vueuse-color-scheme` from localStorage
