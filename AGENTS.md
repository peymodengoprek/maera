# Project Instructions — Maera

- **Architecture:** Declarative IoT dashboard framework (`1 file .maera = 1 dashboard`)[cite: 5, 6].
- **Monorepo:** npm workspaces (`@maera/core`, `@maera/ui`, `@maera/cli`)[cite: 3]. Build order MUST be `core` -> `ui` -> `cli` (`npm run build`).
- **Core (`@maera/core`):** Pure TypeScript, zero DOM dependencies (`window`/`document`)[cite: 5, 6]. Custom line-number tracker in `packages/core/src/lines.ts`[cite: 3, 5].
- **Conditions (`state:` & `steps:`):** Supported only on `status`, `gauge`, and `stat`. Cannot be combined on the same widget. `at` is inclusive (`value >= at`), order-independent, and one step without `at` acts as fallback.
- **UI (`@maera/ui`):** DOM/SVG renderer with 12-column grid and theme customization via `--m-*` CSS variables[cite: 5].
- **Verification Gate:** Always run `npm run build`, `npm test`, `npm run typecheck`, and `npm run check:example` before committing.