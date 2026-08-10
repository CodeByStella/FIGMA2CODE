# Figma plugin app

Assembles `packages/backend` + `packages/plugin-ui` into the files Figma loads:

- `dist/code.js` — main thread (conversion + ZIP export)
- `dist/index.html` — plugin panel UI

## Develop

From this folder:

```bash
pnpm dev
```

Or from the repo root: `pnpm dev` (also starts the debug UI on `:3000`).

Import root `manifest.json` in **Figma Desktop** → Plugins → Development. See [docs/user-guide.md](../../docs/user-guide.md).

## Docs

- [Logic / pipeline](../../docs/logic.md)
- [Developer guide](../../docs/user-guide.md)
- [Root README](../../README.md)
