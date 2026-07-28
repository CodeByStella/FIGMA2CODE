# Logic

How Figma to Code turns a Figma selection into framework-specific source. This document describes the runtime pipeline, packages, and messaging — not setup steps (see [Developer Guide](./user-guide.md)).

---

## High-level architecture

The monorepo splits **Figma sandbox logic**, **shared UI**, and **plugin assembly**.

```mermaid
flowchart TB
  subgraph Figma["Figma host"]
    Canvas["Canvas selection / document"]
    Sandbox["Plugin main thread<br/>apps/plugin/plugin-src"]
    UI["Plugin iframe UI<br/>apps/plugin/ui-src + packages/plugin-ui"]
  end

  subgraph Packages["Shared packages"]
    Backend["packages/backend<br/>conversion + codegen"]
    Types["packages/types<br/>PluginSettings, messages"]
  end

  Canvas --> Sandbox
  Sandbox --> Backend
  Backend --> Types
  UI --> Types
  Sandbox <-->|"postMessage"| UI
```

| Package / app            | Role                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `apps/plugin/plugin-src` | Entry: settings, selection listeners, codegen mode, calls `run()` |
| `packages/backend`       | Node conversion, layout helpers, per-framework emitters           |
| `packages/plugin-ui`     | Framework tabs, preview, code panel, preferences                  |
| `packages/types`         | Shared `PluginSettings` and message contracts                     |
| `apps/debug`             | Next.js host to exercise the UI without Figma                     |

---

## Plugin modes

Figma launches the plugin in different modes (`figma.mode`).

```mermaid
flowchart LR
  Start["figma.mode"] --> Default["default / inspect"]
  Start --> Codegen["codegen"]

  Default --> Standard["standardMode()"]
  Standard --> ShowUI["showUI + init settings"]
  Standard --> Listen["selectionchange / documentchange"]
  Standard --> SafeRun["safeRun(settings)"]

  Codegen --> CG["codegenMode()"]
  CG --> OnGen["figma.codegen.on('generate')"]
  OnGen --> NodesJSON["nodesToJSON"]
  OnGen --> Emit["framework Main()"]
```

- **default / inspect** — visible panel; live conversion on selection and setting changes.
- **codegen** — Dev Mode languages from `manifest.json`; returns `CodegenResult[]` (code + extras).

---

## End-to-end conversion pipeline

Core orchestration lives in `packages/backend/src/code.ts` (`run`).

```mermaid
flowchart TD
  A["run(settings)"] --> B{"selection empty?"}
  B -->|yes| Empty["postEmptyMessage"]
  B -->|no| C["countNodes(selection)"]
  C --> D{"nodeCount > 4000?"}
  D -->|yes| Err["postError: selection too large"]
  D -->|no| E{"nodeCount > 1200?"}
  E -->|yes| SkipUI["skipHeavyUI = true<br/>warn: preview/colors off"]
  E -->|no| FullUI["skipHeavyUI = false"]
  SkipUI --> F
  FullUI --> F

  F{"useOldPluginVersion2025?"}
  F -->|yes| Old["oldConvertNodesToAltNodes"]
  F -->|no| New["nodesToJSON(selection, settings)"]
  Old --> G
  New --> G

  G{"converted empty?"}
  G -->|yes| Empty
  G -->|no| H["convertToCode(nodes, settings)"]
  H --> I{"skipHeavyUI?"}
  I -->|no| J["generateHTMLPreview<br/>retrieve colors & gradients"]
  I -->|yes| K["empty preview / colors"]
  J --> L["postConversionComplete"]
  K --> L
```

### Size guards

| Threshold | Constant                 | Effect                                    |
| --------- | ------------------------ | ----------------------------------------- |
| 1200      | `MAX_NODE_COUNT_PREVIEW` | Skip HTML preview + color/gradient panels |
| 4000      | `MAX_NODE_COUNT_HARD`    | Abort conversion                          |

`safeRun` in the plugin entry serializes runs (`isLoading`) so temporary visibility toggles during image export do not recurse via `documentchange`.

---

## Node conversion (`nodesToJSON`)

Modern path: `packages/backend/src/altNodes/jsonNodeConversion.ts`.

```mermaid
flowchart TD
  Sel["SceneNode[] selection"] --> Exp["exportAsync JSON_REST_V1"]
  Exp --> Doc["REST document tree"]
  Doc --> Fix["GROUP → FRAME<br/>normalize rotation"]
  Fix --> Pair["processNodePair(json, figmaNode, settings)"]
  Pair --> Enrich["Enrich with live API data"]
  Enrich --> Out["Alt / processed Node[]"]

  subgraph EnrichDetail["Per-node enrichment"]
    V["Visibility / layout geometry"]
    C["Color variables → names"]
    T["Styled text segments"]
    I["Icon detection / flatten hints"]
    P["Parent refs for layout"]
  end

  Pair --> EnrichDetail
```

Why two sources?

1. **JSON_REST_V1** — stable serializable tree (fills, layout props, hierarchy).
2. **Live `SceneNode`** — async APIs (`getStyledTextSegments`, variables, export) that REST alone does not fully cover.

Groups are treated as frames; child rotations are adjusted so layout math stays consistent. An older path (`oldConvertNodesToAltNodes`) remains behind `useOldPluginVersion2025` for regression comparison.

---

## Framework dispatch

`convertToCode` routes by `settings.framework`:

```mermaid
flowchart LR
  In["processed Node[] + PluginSettings"] --> Switch{"framework"}
  Switch -->|Tailwind| TW["tailwindMain"]
  Switch -->|Flutter| FL["flutterMain"]
  Switch -->|SwiftUI| SW["swiftuiMain"]
  Switch -->|Compose| CO["composeMain"]
  Switch -->|HTML / default| HT["htmlMain → .html"]
  TW --> Code["code string"]
  FL --> Code
  SW --> Code
  CO --> Code
  HT --> Code
```

Each `*Main` walks the tree and uses builder modules for:

- Auto layout → flex / stack / row-column
- Size, padding, border radius
- Fills, strokes, effects, blend
- Text (typography segments)
- Optional image Base64 / SVG embed

HTML also drives the **preview** (`generateHTMLPreview`) independently of the selected framework’s code string.

---

## Messaging contract

UI and main thread talk over `postMessage`. Types live in `packages/types`.

```mermaid
sequenceDiagram
  participant UI as Plugin UI
  participant Main as Plugin main
  participant Backend as backend.run

  UI->>Main: ui-ready
  Main->>Main: load clientStorage settings
  Main->>UI: pluginSettingsChanged
  Main->>Backend: run(settings)
  Backend->>UI: code | empty | error

  Note over Main: selectionchange / documentchange
  Main->>Backend: safeRun(settings)

  UI->>Main: pluginSettingWillChange(key, value)
  Main->>Main: persist clientStorage
  Main->>Backend: safeRun(updated settings)
```

| Direction | `type`                    | Meaning                              |
| --------- | ------------------------- | ------------------------------------ |
| UI → Main | `ui-ready`                | Handshake; init once                 |
| UI → Main | `pluginSettingWillChange` | Preference update                    |
| UI → Main | `get-selection-json`      | Debug dump of REST + conversion      |
| Main → UI | `pluginSettingsChanged`   | Full settings push                   |
| Main → UI | `code`                    | Conversion result (`ConversionData`) |
| Main → UI | `empty`                   | No selection / nothing convertible   |
| Main → UI | `error`                   | Fatal user-facing error              |

---

## Settings model

`PluginSettings` merges framework-specific fields. Defaults are set in `apps/plugin/plugin-src/code.ts` and persisted in `figma.clientStorage` under `userPluginSettings`.

```mermaid
classDiagram
  class PluginSettings {
    framework
    showLayerNames
    useColorVariables
    embedImages
    embedVectors
    useOldPluginVersion2025
    responsiveRoot
    htmlGenerationMode
    tailwindGenerationMode
    flutterGenerationMode
    swiftUIGenerationMode
    composeGenerationMode
    useTailwind4
    roundTailwindValues
    roundTailwindColors
    customTailwindPrefix
    baseFontSize
    thresholdPercent
  }
  PluginSettings --> HTMLSettings
  PluginSettings --> TailwindSettings
  PluginSettings --> FlutterSettings
  PluginSettings --> SwiftUISettings
  PluginSettings --> ComposeSettings
```

Preference toggles in the UI are filtered by `includedLanguages` in `codegenPreferenceOptions.ts`, so only options relevant to the active framework appear.

---

## Monorepo data flow (build)

```mermaid
flowchart LR
  BE["packages/backend"] --> PS["apps/plugin/plugin-src"]
  UI["packages/plugin-ui"] --> US["apps/plugin/ui-src"]
  PS --> DistJS["dist/code.js"]
  US --> DistHTML["dist/index.html"]
  DistJS --> Manifest["manifest.json"]
  DistHTML --> Manifest
  Manifest --> Figma["Figma loads plugin"]
```

Turborepo + esbuild/Vite assemble the plugin; Figma only loads the built `apps/plugin/dist` artifacts referenced by `manifest.json`.

---

## Hard cases (design decisions)

```mermaid
flowchart TD
  Layout["Mixed absolute + auto-layout"] --> Decide["Infer parent-child & z-order"]
  Decide --> CodeLayout["Emit absolute offsets or flex as appropriate"]

  Vars["Bound color variables"] --> MapName["Map id → CSS/Tailwind/Flutter name"]
  MapName --> PreferVar["Prefer variable tokens when useColorVariables"]

  FX["Gradients / effects"] --> PerFW["Per-framework builders"]
  PerFW --> Warn["addWarning if unsupported"]

  Vec["Vectors / images"] --> Opt{"embedVectors / embedImages?"}
  Opt -->|yes| Inline["SVG / Base64 inline"]
  Opt -->|no| Rect["Rectangle / placeholder approximation"]
```

Warnings are accumulated in a module-level set (`commonConversionWarnings`) and returned with the conversion payload so the UI can surface them without failing the whole run.

---

## Key source map

| Concern                | Location                                                  |
| ---------------------- | --------------------------------------------------------- |
| Plugin entry & modes   | `apps/plugin/plugin-src/code.ts`                          |
| Orchestration `run`    | `packages/backend/src/code.ts`                            |
| JSON → processed nodes | `packages/backend/src/altNodes/jsonNodeConversion.ts`     |
| Framework switch       | `packages/backend/src/common/retrieveUI/convertToCode.ts` |
| HTML / preview         | `packages/backend/src/html/htmlMain.ts`                   |
| Tailwind               | `packages/backend/src/tailwind/tailwindMain.ts`           |
| Flutter                | `packages/backend/src/flutter/flutterMain.ts`             |
| SwiftUI                | `packages/backend/src/swiftui/swiftuiMain.ts`             |
| Compose                | `packages/backend/src/compose/composeMain.ts`             |
| Backend → UI messages  | `packages/backend/src/messaging.ts`                       |
| Shared UI              | `packages/plugin-ui/src/PluginUI.tsx`                     |
| Preference definitions | `packages/plugin-ui/src/codegenPreferenceOptions.ts`      |
| Types                  | `packages/types/src/types.ts`                             |
