# Figma to Code

[CI](https://github.com/CodeByStella/FIGMA2CODE/actions) · [Figma Community plugin](https://www.figma.com/community/plugin/842128343887142055)

Converts Figma selections into **HTML + CSS** and downloads a **ZIP** with `index.html` (design preview) plus frame JSON and assets.

## How it works

1. **Code preview** — On selection, convert to HTML + CSS (same document as ZIP `index.html`).
2. **Download ZIP** — On demand: framed PNGs + baked SVGs, `index.html`, `figma_raw.json`, `assets_map.json`, `assets/*`.
3. **AltNode conversion** — Auto Layout → flex; freeform → absolute. ZIP download reuses accuracy rules (effects baked, etc.).
4. **Code panel** — HTML + CSS with images/vectors as `assets/*` by default.

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

### Repository layout

```text
src/plugin.ts     Figma main thread → dist/code.js
src/ui/           Plugin panel → dist/index.html
src/convert/      Nodes + HTML + CSS conversion
src/export/       ZIP assets
```

### Development Workflow

#### Running the Project

```bash
pnpm dev
```

Watches source and rebuilds root `dist/` (`code.js`, `index.html`). Import root `manifest.json` in Figma Desktop, then re-run the plugin after each rebuild.

#### Where to Make Changes

Most work happens in `src/`: `plugin.ts` (Figma entry), `convert/` + `export/` (conversion), `ui/` (panel).

#### Commands

`pnpm run ...`

- `dev` - watch and rebuild root `dist/` for Figma
- `build` - production compile into root `dist/` (copy this folder to publish)
- `build:watch` - same as `dev`
- `lint` - runs ESLint
- `format` - formats with prettier (warning: may edit files!)

## Issues

The Figma file for this README and icon is also open and welcome to changes! [Check it here.](https://www.figma.com/file/8buWpm6Mpq4yK9MhbkcdJB/Figma-to-Code)

I took decisions thinking about how it would benefit the majority of people, but I can (and probably will!) be wrong many times. Found a bug? Have an idea for an improvement? Feel free to [add an issue](../../issues) or email me. Pull requests are also more than welcome.
