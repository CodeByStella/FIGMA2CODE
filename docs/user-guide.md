# User Guide

Figma to Code converts selected Figma layers into production-ready code for **HTML**, **React (JSX)**, **Svelte**, **styled-components**, **Tailwind**, **Flutter**, and **SwiftUI**.

Plugin page: [Figma Community](https://www.figma.com/community/plugin/842128343887142055)

---

## Install & open

1. Open a Figma file (Design or Dev Mode).
2. Go to **Resources → Plugins** (or **Plugins** in the menu).
3. Search for **Figma to Code** and run it.
4. The plugin panel opens (~450×700). Select one or more layers on the canvas.

Conversion runs automatically when you:

- Change the selection
- Change a preference in the plugin UI
- Edit the document (while the plugin is open)

---

## Quick start

1. Select a **frame** or a small group of layers (prefer focused selections over whole pages).
2. Pick a framework tab: **HTML**, **Tailwind**, **Flutter**, or **SwiftUI**.
3. Choose a generation **Mode** under the code panel (e.g. HTML vs React JSX).
4. Review the live preview, warnings, and generated code.
5. Click **Copy** to paste the code into your project.

**Tip:** Generate one component at a time, then wrap it in a loop or map in your app. That is usually cleaner than converting an entire page at once.

---

## Plugin UI overview

| Area               | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| Framework tabs     | Switch output language (HTML / Tailwind / Flutter / SwiftUI) |
| About (ℹ)          | Plugin info and legacy conversion toggle                     |
| Preview            | HTML preview of the selection (desktop / mobile / precision) |
| Warnings           | Unsupported or lossy conversions                             |
| Code panel         | Generated code + framework-specific preferences              |
| Colors / Gradients | Extracted palette; click a value to copy                     |

If nothing is selected, an empty state asks you to select layers.

---

## Framework modes

### HTML

| Mode              | Output                                        |
| ----------------- | --------------------------------------------- |
| HTML              | Plain HTML + CSS (inline or collected styles) |
| React (JSX)       | JSX markup                                    |
| Svelte            | Svelte component markup                       |
| styled-components | React + styled-components                     |

Useful preferences:

- **Layer names** — include Figma layer names in class names
- **Color Variables** — prefer Figma variables over raw hex
- **Embed Images** — Base64-embed image fills (can be slow)
- **Embed Vectors** — convert vectors to inline SVG (can be slow)

### Tailwind

| Mode        | Output                              |
| ----------- | ----------------------------------- |
| HTML        | HTML with Tailwind classes          |
| React (JSX) | JSX with Tailwind classes           |
| Twig        | Twig template with Tailwind classes |

Useful preferences:

- **Tailwind 4** — Tailwind v4 syntax
- **Round values** — snap sizes to the nearest Tailwind scale (~15% threshold)
- **Round colors** — snap colors to the nearest Tailwind palette
- **Color Variables** — emit variable-based class names when possible
- **Embed Vectors** — inline SVG for vector shapes
- Custom prefix / font settings (when available in the UI)

### Flutter

| Mode     | Output                |
| -------- | --------------------- |
| Full App | Runnable app scaffold |
| Widget   | Stateless widget      |
| Snippet  | Widget tree fragment  |

### SwiftUI

| Mode    | Output                   |
| ------- | ------------------------ |
| Preview | View with preview helper |
| Struct  | `View` struct            |
| Snippet | View body fragment       |

### Jetpack Compose

Compose generation exists in the backend (`Compose` framework). It is not currently exposed as a primary UI tab; prefer HTML / Tailwind / Flutter / SwiftUI from the plugin panel unless you are developing Compose support.

---

## Dev Mode / Codegen

In **Dev Mode**, Figma to Code also works as a **codegen** plugin. Inspect a node and pick a language from the codegen panel:

- HTML, React (JSX), Svelte, Styled Components
- Tailwind, Tailwind (JSX)
- Flutter, SwiftUI

Codegen returns the main code block plus related extras (e.g. text styles, Tailwind colors) when available.

---

## Selection & size limits

| Limit            | Behavior                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| **> 1200 nodes** | Large selection: HTML preview and color/gradient panels are skipped to save memory; code still generates |
| **> 4000 nodes** | Hard stop: conversion is rejected — select a smaller frame                                               |

Prefer selecting a single component or section rather than the whole page.

---

## Best practices

1. **Use Auto Layout** — maps cleanly to Flexbox / Flutter Row-Column / SwiftUI stacks.
2. **Name layers** — clearer class names and easier debugging when “Layer names” is on.
3. **Use color variables** — keeps themes consistent across HTML / Tailwind / Flutter.
4. **Convert small pieces** — buttons, cards, headers; compose them in code.
5. **Check warnings** — they flag vectors, effects, or layouts that need manual follow-up.
6. **Avoid huge image embeds** — Embed Images / Vectors can freeze Figma on large selections.

---

## Known limitations

These are incomplete or partial today:

- Vectors (optional embed for HTML / Tailwind)
- Images (optional Base64 embed for HTML)
- Line / Star / Polygon nodes
- Mixed absolute + auto-layout trees may need manual cleanup
- Gradients and effects differ by framework and may be approximated

---

## Local development (contributors)

Requires [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm dev                 # plugin + debug UI at http://localhost:3000
# or
cd apps/plugin && pnpm dev   # plugin only
```

In Figma: **Plugins → Development → Import plugin from manifest…** and select this repo’s `manifest.json`.

| Command       | Description                             |
| ------------- | --------------------------------------- |
| `pnpm dev`    | Watch mode (plugin + debug Next.js app) |
| `pnpm build`  | Production build                        |
| `pnpm lint`   | ESLint                                  |
| `pnpm format` | Prettier                                |

Main packages:

- `packages/backend` — Figma API → intermediate nodes → code
- `packages/plugin-ui` — shared React UI
- `apps/plugin` — Figma plugin entry (`code.js` + `index.html`)
- `apps/debug` — Next.js debug shell for the UI

For conversion internals and diagrams, see [Logic](./logic.md).
