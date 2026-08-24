# Developer Guide

This repo is a **Figma plugin**, not a website with a server.

Figma loads two local files from disk (see `manifest.json`):

- `dist/code.js` — runs inside Figma’s plugin sandbox (can read the document)
- `dist/index.html` — UI iframe shown in the plugin panel

There is **no URL** Figma calls for conversion. Everything runs inside Figma after those files are built.

Conversion details: [Logic](./logic.md).

---

## Mental model (read this first)

| Name in the repo | What it actually is                           | Has a URL?            |
| ---------------- | --------------------------------------------- | --------------------- |
| `src/plugin.ts`  | Figma main thread. Bundled **into** `code.js` | **No.** Not a server. |
| `src/convert/`   | Conversion: Figma nodes → HTML + CSS          | **No.**               |
| `src/ui/`        | React panel. Bundled **into** `index.html`    | **No.**               |

```text
You edit source  →  build/watch writes dist/*
                      ↓
Figma Desktop imports manifest.json  →  loads dist/code.js + dist/index.html
                      ↓
User selects layers  →  code.js exports ZIP assets + converts
                      ↓
postMessage  →  UI shows code + Download ZIP (no HTML preview)
```

Figma never “requests” a server. Conversion code in `src/` is compiled into the plugin binary.

---

## Do I need `pnpm dev` + Figma Desktop?

**To test the real plugin (selection → real code): yes, both.**

1. Keep a build/watch running so root `dist/` updates.
2. Import the plugin once in **Figma Desktop**.
3. Run the development plugin from Figma’s Plugins menu.

| What you want                     | What to run  | Open where                          |
| --------------------------------- | ------------ | ----------------------------------- |
| Real conversion from a Figma file | `pnpm dev`   | **Figma Desktop** (imported plugin) |
| One-off production build          | `pnpm build` | Copy root `dist/` to publish        |

Recommended for day-to-day plugin work:

```bash
pnpm install
pnpm dev    # watches and rebuilds root dist/
```

---

## Import plugin in Figma (once)

**Must be the Figma Desktop app** (Windows/Mac installer). The **browser** tab at figma.com cannot load a local `manifest.json`.

### Exact clicks

1. Build or watch so these exist:
   - `dist/code.js`
   - `dist/index.html`
2. Open **Figma Desktop** and open **any design file** (not just the home/file browser — a canvas file).
3. Top-left: click the **Figma logo** / **☰ menu** (not the right-side Resources panel).
4. Go to **Plugins → Development**.
5. Click **Import plugin from manifest…**  
   (newer wording: **Import new plugin from manifest…**)
6. In the file picker, open this repo’s **root**:
   `…/FigmaToCode/manifest.json`  
   Do **not** pick a file under `dist/` for local import.
7. Run it: same menu → **Plugins → Development →** your plugin name  
   (listed as something like **Figma to Code**).

Alternate ways to open Development plugins later:

- Right panel **Resources** (or **Plugins**) → open the panel → switch filter / section to **Development**
- Quick actions: `Ctrl + /` (Windows) or `Cmd + /` (Mac), type the plugin name

### If you cannot find “Development”

| Check                                   | Fix                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| Using Chrome/Edge figma.com             | Install/open [Figma Desktop](https://www.figma.com/downloads/)                          |
| Still on Home / drafts list             | Open or create a **Design file** first                                                  |
| Looking in Community / “Browse plugins” | That’s published plugins only — use the **top-left Figma menu → Plugins → Development** |
| No “Import … manifest”                  | Update Figma Desktop; you must be logged in                                             |
| Import worked but run fails             | Run `pnpm build` (or watch) so `dist/` exists, then re-run the plugin                   |

You only re-import if the manifest path changes or Figma “forgets” the link. Day-to-day coding does not need re-import.

---

## Runtime debug console

Yes. There are **two** consoles (main thread ≠ UI).

### 1. Main thread (`code.js` / `src/plugin.ts`)

Logs from `console.log` in `src/plugin.ts` and conversion code (benchmarks, settings).

1. Figma Desktop, design file open
2. Top-left menu → **Plugins → Development → Open Console…**  
   (shortcut often **Ctrl+Alt+I** on Windows / **⌥⌘I** on Mac)
3. Use the **Console** tab in that window

Optional: **Plugins → Development → Use Developer VM** — better for breakpoints / `debugger;`.

This repo already logs a lot there (`[DEBUG]`, `[benchmark]`, …). Re-run the plugin after rebuilds to see new output.

**Wrong place:** F12 on the Figma app shows Figma’s own logs, not your plugin sandbox.

### 2. UI iframe (`index.html` / `src/ui`)

Logs from React UI code.

1. Run the plugin so the panel is open
2. **Right-click inside the plugin panel** → **Inspect** / **Inspect Element**
3. DevTools → **Console**

### Tips

- `src/plugin.ts`, `src/convert/`, `src/export/` → main console
- `src/ui/` → UI Inspect console
- After `dist` rebuilds, **re-run** the plugin or you still see old code/logs

---

## When I change code, does it auto-build and reload in Figma?

### Auto-build to `dist`?

**Yes**, while `pnpm dev` is running:

- Main thread: esbuild `--watch` → updates `dist/code.js`
- UI: Vite build `--watch` → updates `dist/index.html`

If watch is **not** running, `dist` stays stale until you run `pnpm build` (or start watch again).

### Auto-reload inside Figma?

**No reliable hot reload.** Figma keeps the old plugin instance in memory.

After `dist` updates you typically:

1. Close the plugin window, then run the development plugin again, **or**
2. Use Figma’s “Re-run” / reopen from **Plugins → Development**.

UI-only tweaks sometimes pick up after re-opening the plugin; main-thread (`src/plugin.ts` / conversion) changes almost always need a full re-run.

---

## Develop — commands

| Command                     | Effect                                 |
| --------------------------- | -------------------------------------- |
| `pnpm install`              | Install deps; runs Husky `prepare`     |
| `pnpm dev`                  | Watch → rebuild root `dist/` for Figma |
| `pnpm build`                | Production compile into root `dist/`   |
| `pnpm lint` / `pnpm format` | Lint / format                          |

### Where to edit

| If you change…                       | Folder                        | Then in Figma…                      |
| ------------------------------------ | ----------------------------- | ----------------------------------- |
| Conversion logic                     | `src/convert/`, `src/export/` | Wait for watch → **re-run plugin**  |
| Plugin UI                            | `src/ui/`                     | Wait for watch → **re-open plugin** |
| Settings / selection / codegen entry | `src/plugin.ts`               | Wait for watch → **re-run plugin**  |

---

## Deploy

Still not a web deploy. You publish **built files** Figma hosts as a plugin.

```bash
pnpm build
```

`pnpm build` writes `dist/code.js` and `dist/index.html`.

Local Figma Desktop import uses the repo-root `manifest.json` (`dist/code.js`, `dist/index.html`).

Validate in Figma Desktop with the Development import, then publish a new version on [Figma Community](https://www.figma.com/community) for plugin id `842128343887142055`.

---

## Features by directory

```text
FigmaToCode/
├── manifest.json              # Local Figma import (points at dist/)
├── dist/                      # OUTPUT: code.js, index.html
├── src/
│   ├── plugin.ts              # Figma main entry
│   ├── ui/                    # Plugin panel
│   ├── convert/               # Nodes + HTML + CSS
│   ├── export/                # ZIP assets
│   └── types/                 # Settings, messages, node types
└── docs/
    ├── logic.md
    └── user-guide.md
```

### `src/` (plugin logic — not a server)

| Path             | Role                                               |
| ---------------- | -------------------------------------------------- |
| `plugin.ts`      | Figma modes, settings storage, selection listeners |
| `convert/run.ts` | Preview HTML on selection; stream ZIP on download  |
| `convert/`       | Nodes, layout, HTML + CSS emitter                  |
| `export/`        | ZIP assets, cache, flags                           |
| `types/`         | Settings, messages, plugin vs REST node types      |
| `ui/`            | Panel: code, ZIP download, colors                  |
| `messaging.ts`   | `figma.ui.postMessage` helpers                     |

---

## Short FAQ

**Q: Is conversion a service Figma hits over HTTP?**  
A: No. It’s source in `src/` bundled into `code.js`. `manifest.json` even sets `networkAccess.allowedDomains: ["none"]`.

**Q: Watch is running but Figma still shows old behavior?**  
A: Confirm `dist` timestamps updated, then **close and re-run** the development plugin.

**Q: Where is the HTML preview?**  
A: Removed. The panel shows generated code and **Download ZIP** so large frames stay usable.

**Q: Does every run create a ZIP?**  
A: No. Selection changes generate HTML + CSS only (a short snippet in the panel). **Download ZIP** exports assets and streams files to the browser. Dev Mode **codegen** generates code only (no ZIP).
