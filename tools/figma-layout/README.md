# Figma layout tools

Standalone package for inspecting Figma REST / `JSON_REST_V1` dumps and converting them to HTML — no Figma plugin, and **no imports from `packages/*`**.

All conversion logic lives under this folder (`lib/` + local `types/`).

## Setup

From the **repo root** (workspace includes `tools/*`):

```bash
pnpm install
```

Or from this directory:

```bash
cd tools/figma-layout
pnpm install
```

## Quick start

```bash
# 1. Put a dump here
#    tools/figma-layout/data/figma_raw.json

# 2. Layout-only JSON (optional)
pnpm layout:filter

# 3. HTML
pnpm layout:html
# → tools/figma-layout/data/from-figma.html
```

Same commands from inside this directory: `pnpm filter` / `pnpm html`.

---

## Layout

```text
tools/figma-layout/
├── filter-layout.js       # raw JSON → size/position-only JSON
├── layout-rects.html      # canvas viewer for absoluteBoundingBox rects
├── json-to-html.ts        # CLI: raw JSON → HTML
├── lib/                   # vendored offline HTML converter (self-contained)
│   ├── html/              # htmlMain, builders, htmlFromRestJson
│   ├── altNodes/          # adaptRestJson (+ helpers)
│   └── common/            # shared helpers used by HTML path
├── types/                 # local PluginSettings / AltNode types
├── package.json
├── tsconfig.json
├── README.md
└── data/                  # local dumps (*.json / *.html gitignored)
    ├── figma_raw.json
    ├── figma_layout.json
    └── from-figma.html
```

---

## 1. Put a Figma JSON dump in `data/`

Use REST-style JSON (same shape as plugin `exportAsync({ format: "JSON_REST_V1" }).document`).

Supported root shapes:

- A single node (`{ id, name, type, children, absoluteBoundingBox, … }`)
- `{ document: { … } }`
- `{ nodes: { "<id>": { document: { … } } } }` (HTML CLI uses the first entry)

---

## 2. Filter to layout-only JSON

Keeps `id`, `type`, children, and geometry / auto-layout fields. Drops fills, text, effects, etc.

```bash
# from repo root
pnpm layout:filter

# from this directory
pnpm filter

# custom paths (cwd does not matter; paths are resolved)
node filter-layout.js path/to/in.json path/to/out.json
```

Default: `data/figma_raw.json` → `data/figma_layout.json`.

---

## 3. View layout as rectangles

`layout-rects.html` fetches `./data/figma_layout.json` and draws every `absoluteBoundingBox`.

| Action | Behavior                                                       |
| ------ | -------------------------------------------------------------- |
| Hover  | Yellow highlight + tooltip (`type`, `id`, x/y, w×h)            |
| Click  | Copies `id` to clipboard; rect flashes red while mouse is down |

Serve this folder (`file://` cannot `fetch` JSON):

```bash
# from repo root
pnpm layout:serve

# from this directory
pnpm serve
```

Open: [http://localhost:8765/layout-rects.html](http://localhost:8765/layout-rects.html)

Refresh after editing `figma_layout.json` (fetch uses `cache: "no-store"`).

---

## 4. Generate HTML from raw JSON

```bash
# from repo root
pnpm layout:html

# from this directory
pnpm html

# custom in / out
pnpm html -- data/figma_raw.json data/from-figma.html
```

Default: `data/figma_raw.json` → `data/from-figma.html`.

Use **raw** JSON here (fills, text, effects). `figma_layout.json` is for the rect viewer only.

### End-to-end flow

```mermaid
flowchart TD
  A["Figma JSON dump"] --> B["CLI: read & normalize input"]
  B --> C["Prepare offline conversion"]
  C --> D["Rewrite tree for HTML builders"]
  D --> E["Walk layers → emit markup"]
  E --> F["Apply styles per layer"]
  F --> G["Wrap as full HTML page"]
  G --> H["Write from-figma.html"]
```

| Stage           | What it does                                                    | Code (if you need to dig in)                                   |
| --------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| CLI             | Reads the dump, picks the document root, writes the output file | `json-to-html.ts`                                              |
| Prepare offline | Stubs Figma globals; turns off image/vector/variable features   | `lib/html/htmlFromRestJson.ts`                                 |
| Rewrite tree    | Turns REST JSON into the in-memory shape the HTML path expects  | `lib/altNodes/adaptRestJson.ts`                                |
| Walk & emit     | Chooses a handler by layer type (frame, text, …)                | `lib/html/htmlMain.ts`                                         |
| Apply styles    | Position, size, fills, text, flex vs absolute                   | `htmlDefaultBuilder.ts`, `htmlTextBuilder.ts`, `builderImpl/*` |

### 1) Normalize the dump

Different exports nest the design differently. The CLI unwraps them to one root node:

```text
{ document: Node }                    → use document
{ nodes: { id: { document: Node } } } → use first document
Node                                  → use as-is
```

### 2) Prepare for offline conversion

```mermaid
flowchart LR
  A["Root node"] --> B["Stub Figma runtime APIs"]
  B --> C["Lock offline-safe settings"]
  C --> D["Rewrite tree"]
  D --> E{"Any layers left?"}
  E -->|no| F["Empty HTML page"]
  E -->|yes| G["Generate HTML"]
  G --> H["Add head, title, CSS, body"]
```

These stay **off** offline (need live Figma or REST image APIs): embed images, embed vectors/SVG, color variable names.

### 3) Rewrite the layer tree

Depth-first pass over a clone of the JSON so builders get stable geometry and defaults:

```mermaid
flowchart TD
  N["Each JSON layer"] --> V{"Visible and has id?"}
  V -->|no| X["Skip"]
  V -->|yes| T{"What kind of layer?"}
  T -->|Empty frame / instance / …| R["Treat as a plain rectangle"]
  T -->|Group| G["Lift children into the parent"]
  T -->|Text| S["Build text runs from style + characters"]
  T -->|Anything else| P["Fill in geometry & layout defaults"]
  R --> P
  S --> P
  P --> C["Compute size & position relative to parent"]
  C --> D["Fill missing auto-layout / sizing fields"]
  D --> Kids["Process children"]
  Kids --> Rel{"Absolute layout parent?"}
  Rel -->|yes| Abs["Mark as relative positioning context"]
  Rel -->|no| Keep["Keep Auto Layout as flex later"]
```

What this pass fixes up:

- **Rotation** — Figma radians → CSS degrees.
- **Groups** — children move up; the group shell often goes away.
- **Bounds** — child position becomes relative to the parent box.
- **Text** — one text run from `characters` + `style` (no live multi-span API).
- **Missing Auto Layout fields** — defaults so builders don’t crash (`layoutMode` → `"NONE"` when absent).
- **SVG flatten** — disabled offline (no export from Figma).

### 4) Walk layers and emit HTML

```mermaid
flowchart TD
  Roots["Rewritten layers"] --> W["For each visible layer"]
  W --> Type{"Layer type"}
  Type -->|Rectangle / ellipse| Cont["Box with styles"]
  Type -->|Group| Grp["Render children only"]
  Type -->|Frame / component / instance / …| Fr["Frame container"]
  Type -->|Text| Txt["Paragraph / spans"]
  Type -->|Line| Ln["Line element"]
  Type -->|Vector| Vec["Warning + empty box placeholder"]
  Type -->|Other| Warn["Unsupported — skip"]
  Fr --> AL{"Uses Figma Auto Layout?"}
  AL -->|yes| Flex["CSS flex row/column, gap, align"]
  AL -->|no| Abs["Relative parent + absolute children"]
  Flex --> Cont
  Abs --> Cont
  Cont --> B["Attach CSS: size, fill, border, …"]
  B --> Out["Output div / p (+ collected CSS)"]
```

**Frames**

- Auto Layout (`HORIZONTAL` / `VERTICAL`) → CSS flex (direction, gap, padding, alignment).
- No Auto Layout (`NONE`, or absolute children) → parent `position: relative`, children often `position: absolute` with `left` / `top`.

**Styles applied per layer**

- Position, size, opacity, blend, rotation.
- Fills → background or text color (solid + gradients).
- Stroke, corner radius, shadow, blur.
- Text → font, weight, line-height, letter-spacing, spans.

**Why output often looks “canvas-like”**

If the Figma file was drawn with absolute positions instead of Auto Layout, the converter mirrors that with absolute CSS. Flex / responsive HTML only appears where the source already uses Auto Layout (or after a separate layout-inference step).

### Offline limits (vs live plugin)

| Feature                                           | Offline CLI                                         |
| ------------------------------------------------- | --------------------------------------------------- |
| Frames, text, fills, auto-layout, absolute layout | Supported                                           |
| Embed vectors / SVG flatten                       | Off                                                 |
| Embed images (Base64 from Figma)                  | Off                                                 |
| Color variables → names                           | Off                                                 |
| Per-character text style runs                     | Approximated from whole-node `style` / `characters` |

---

## Scripts

| Where        | Command              | Runs                                   |
| ------------ | -------------------- | -------------------------------------- |
| This package | `pnpm filter`        | `node filter-layout.js`                |
| This package | `pnpm html`          | `tsx json-to-html.ts`                  |
| This package | `pnpm serve`         | static server on `:8765`               |
| Repo root    | `pnpm layout:filter` | `pnpm --dir tools/figma-layout filter` |
| Repo root    | `pnpm layout:html`   | `pnpm --dir tools/figma-layout html`   |
| Repo root    | `pnpm layout:serve`  | `pnpm --dir tools/figma-layout serve`  |
