# Figma plugin app

Assembles `packages/backend` + `packages/plugin-ui` into the repo-root `dist/` folder Figma loads:

- `dist/code.js` — main thread (conversion + ZIP export)
- `dist/index.html` — plugin panel UI
- `dist/manifest.json` — publish-ready copy (`main` / `ui` are `code.js` and `index.html`)

## Develop

From the repo root:

```bash
pnpm dev
```

Import root `manifest.json` in **Figma Desktop** → Plugins → Development. See [docs/user-guide.md](../../docs/user-guide.md).

## Publish

```bash
pnpm build
```

Copy the root `dist/` folder. It is self-contained.

## Docs

- [Logic / pipeline](../../docs/logic.md)
- [Developer guide](../../docs/user-guide.md)
- [Root README](../../README.md)
