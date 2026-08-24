# Figma to Code

[CI](https://github.com/CodeByStella/FIGMA2CODE/actions) · [Figma Community plugin](https://www.figma.com/community/plugin/842128343887142055)

Converts Figma selections into `HTML`, `React (JSX)`, `Svelte`, `styled-components`, `Tailwind`, `Flutter`, and `SwiftUI`, and downloads a **ZIP** with `index.html` (design preview) plus frame JSON and assets.

## How it works

1. **Code preview** — On selection, convert to framework code (no ZIP export yet).
2. **Download ZIP** — On demand: framed PNGs + baked SVGs, `index.html`, `figma_raw.json`, `assets_map.json`, `assets/*`.
3. **AltNode conversion** — Auto Layout → flex; freeform → absolute. ZIP download reuses accuracy rules (effects baked, etc.).
4. **Code panel** — Framework code with images/vectors embedded by default. **No HTML preview** so large frames stay usable.

Docs:

- [docs/logic.md](docs/logic.md) — pipeline, ZIP accuracy rules, messaging
- [docs/user-guide.md](docs/user-guide.md) — build, import into Figma Desktop, debug consoles

## Hard cases

Converting visual designs to code inevitably encounters complex edge cases. Here are some challenges the plugin handles:

1. **Complex Layouts**: When working with mixed positioning (absolute + auto-layout), the plugin has to make intelligent decisions about how to structure the resulting code. It detects parent-child relationships and z-index ordering to produce the most accurate representation.

2. **Color Variables**: The plugin detects and processes color variables, allowing for theme-consistent output.

3. **Gradients and Effects**: Different frameworks handle gradients and effects in unique ways, requiring specialized conversion logic.

**Tip**: Instead of selecting the whole page, you can also select individual items. This can be useful for both debugging and componentization. For example: you can use the plugin to generate the code of a single element and then replicate it using a for-loop.

## How to build the project

### Package Manager

The project is configured for [pnpm](https://pnpm.io/). To install, see the [installation notes for pnpm](https://pnpm.io/installation).

### Monorepo

The plugin is organized as a monorepo. There are several packages:

- `packages/backend` — Figma API → ZIP assets + AltNode conversion + framework codegen (`src/export/`, `src/altNodes/`, `src/html|tailwind|…`)
- `packages/plugin-ui` — Shared React panel (code, Download ZIP, preferences)
- `packages/types` — Shared settings and message types
- `packages/eslint-config-custom` — ESLint config
- `packages/tsconfig` — Shared TSConfig files

- `apps/plugin` — Plugin assembled from `backend` + `plugin-ui` into root `dist/`
- `apps/debug` — Optional Next.js mock of the panel (`pnpm dev:debug`)

### Development Workflow

The project uses [Turborepo](https://turborepo.com/) for managing the monorepo, and each package is compiled using [esbuild](https://esbuild.github.io/) for fast development cycles. Only modified files are recompiled when changes are made, making the development process more efficient.

#### Running the Project

```bash
pnpm dev
```

Watches source and rebuilds root `dist/` (`code.js`, `index.html`, `manifest.json`). Import root `manifest.json` in Figma Desktop, then re-run the plugin after each rebuild.

Optional mock panel (no Figma conversion):

```bash
pnpm dev:debug
```

#### Where to Make Changes

Most of your development work will happen in these directories:

- `packages/backend` - For plugin backend
- `packages/plugin-ui` - For plugin UI
- `apps/plugin/` - The main plugin result that combines the backend and UI and is called by Figma.

You'll rarely need to modify files directly in the `apps/` directory, as they mostly contain build configuration.

#### Commands

`pnpm run ...`

- `dev` - watch and rebuild root `dist/` for Figma
- `build` - production compile into root `dist/` (copy this folder to publish)
- `build:watch` - same as `dev`
- `dev:debug` - Next.js mock UI at `http://localhost:3000`
- `lint` - runs ESLint
- `format` - formats with prettier (warning: may edit files!)

## Issues

The Figma file for this README and icon is also open and welcome to changes! [Check it here.](https://www.figma.com/file/8buWpm6Mpq4yK9MhbkcdJB/Figma-to-Code)

I took decisions thinking about how it would benefit the majority of people, but I can (and probably will!) be wrong many times. Found a bug? Have an idea for an improvement? Feel free to [add an issue](../../issues) or email me. Pull requests are also more than welcome.
