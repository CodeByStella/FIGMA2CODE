<!-- <p align="center"><img src="assets/icon_256.png" alt="Figma to Code" height="128px"></p> -->

[![Figma to Code](assets/git_preview.png)](https://www.figma.com/community/plugin/842128343887142055)

# Figma to Code

<p align="center">
<a href="https://github.com/bernaferrari/FigmaToCode/actions/"><img src="https://github.com/bernaferrari/FigmaToCode/workflows/CI/badge.svg"/></a>
<a href="https://codecov.io/gh/bernaferrari/FigmaToCode"><img src="https://codecov.io/gh/bernaferrari/FigmaToCode/branch/master/graph/badge.svg" /></a>
<a href="http://twitter.com/bernaferrari">
<img src="https://img.shields.io/badge/Twitter-@bernaferrari-brightgreen.svg?style=flat" alt="Twitter"/></a>
</p><p align="center">
<a href="https://www.figma.com/community/plugin/842128343887142055"><img src="assets/badge.png" height="60"/></a>
</p>

Converts Figma selections into `HTML`, `React (JSX)`, `Svelte`, `styled-components`, `Tailwind`, `Flutter`, and `SwiftUI`, and downloads a **ZIP** of the frame JSON plus all assets for offline accuracy.

## How it works

1. **Export assets** — Collect framed PNGs (IMAGE fills) and baked SVGs (vectors/shapes/icons). No node-count hard limit; progress is shown in the panel.
2. **ZIP package** — `figma_raw.json` + `assets_map.json` + `assets/*` (**Download ZIP** in the UI).
3. **AltNode conversion** — Auto Layout → flex; freeform → absolute. Asset bytes are reused for embeds (no second export). Effects baked into assets skip duplicate CSS `box-shadow`.
4. **Code panel** — Framework code with images/vectors embedded by default. **No HTML preview** so large frames stay usable.

Docs:

- [docs/logic.md](docs/logic.md) — pipeline, ZIP accuracy rules, messaging
- [docs/user-guide.md](docs/user-guide.md) — build, import into Figma Desktop, debug consoles

## Hard cases

Converting visual designs to code inevitably encounters complex edge cases. Here are some challenges the plugin handles:

1. **Complex Layouts**: When working with mixed positioning (absolute + auto-layout), the plugin has to make intelligent decisions about how to structure the resulting code. It detects parent-child relationships and z-index ordering to produce the most accurate representation.

2. **Color Variables**: The plugin detects and processes color variables, allowing for theme-consistent output.

3. **Gradients and Effects**: Different frameworks handle gradients and effects in unique ways, requiring specialized conversion logic.

![Conversion Workflow](assets/examples.png)

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

- `apps/plugin` — Plugin assembled from `backend` + `plugin-ui`:
  - `plugin-src` — loads `backend`, compiles to `dist/code.js`
  - `ui-src` — loads `plugin-ui`, compiles to `dist/index.html`
- `apps/debug` — Next.js mock of the panel at `http://localhost:3000` (no real Figma conversion)

### Development Workflow

The project uses [Turborepo](https://turborepo.com/) for managing the monorepo, and each package is compiled using [esbuild](https://esbuild.github.io/) for fast development cycles. Only modified files are recompiled when changes are made, making the development process more efficient.

#### Running the Project

You have two main options for development:

1. **Root development mode** (includes debug UI):

   ```bash
   pnpm dev
   ```

   This runs the plugin in dev mode and also starts a Next.js server for the debug UI. You can access the debug UI at `http://localhost:3000`.

2. **Plugin-only development mode**:

   ```bash
   cd apps/plugin
   pnpm dev
   ```

   This focuses only on the plugin without the Next.js debug UI. Use this when you're making changes specifically to the plugin.

#### Where to Make Changes

Most of your development work will happen in these directories:

- `packages/backend` - For plugin backend
- `packages/plugin-ui` - For plugin UI
- `apps/plugin/` - The main plugin result that combines the backend and UI and is called by Figma.

You'll rarely need to modify files directly in the `apps/` directory, as they mostly contain build configuration.

#### Commands

`pnpm run ...`

- `dev` - runs the app in dev mode. This can be run in the Figma editor.
- `build` - builds the project for production
- `build:watch` - builds and watches for changes
- `lint` - runs ESLint
- `format` - formats with prettier (warning: may edit files!)

#### Debug mode

When running the `dev` task, you can open `http://localhost:3000` to see the debug version of the UI.

<img width="600" alt="Screenshot 2024-12-13 at 16 26 43" src="https://github.com/user-attachments/assets/427fb066-70e1-47bd-8718-51f7f4d83e35" />

## Issues

The Figma file for this README and icon is also open and welcome to changes! [Check it here.](https://www.figma.com/file/8buWpm6Mpq4yK9MhbkcdJB/Figma-to-Code)

I took decisions thinking about how it would benefit the majority of people, but I can (and probably will!) be wrong many times. Found a bug? Have an idea for an improvement? Feel free to [add an issue](../../issues) or email me. Pull requests are also more than welcome.
