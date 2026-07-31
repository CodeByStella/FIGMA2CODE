/**
 * Run: pnpm test:layout
 */
import { inferSemanticLayout } from "../inferSemanticLayout";
import { adaptRestJsonToAltNodes } from "../../altNodes/adaptRestJson";

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ok  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL ${msg}`);
  }
}

function frame(
  id: string,
  w: number,
  h: number,
  children: any[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name: id,
    type: "FRAME",
    visible: true,
    width: w,
    height: h,
    x: 0,
    y: 0,
    absoluteBoundingBox: { x: 0, y: 0, width: w, height: h },
    layoutMode: "NONE",
    children,
    ...extra,
  };
}

function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  type = "RECTANGLE",
) {
  return {
    id,
    name: id,
    type,
    visible: true,
    x,
    y,
    width: w,
    height: h,
    absoluteBoundingBox: { x, y, width: w, height: h },
  };
}

function runInfer(root: any, thresholdPx = 4) {
  // Skip adapt for synthetic trees that already have local x/y/w/h
  const cloned = structuredClone(root);
  return inferSemanticLayout([cloned], {
    enabled: true,
    thresholdPx,
  })[0];
}

console.log("inferSemanticLayout tests");

{
  console.log("\n1) three same-Y boxes → HORIZONTAL flex + gap");
  const root = frame("p", 340, 60, [
    box("a", 10, 10, 80, 40),
    box("b", 110, 10, 80, 40),
    box("c", 210, 10, 80, 40),
  ]);
  const out = runInfer(root);
  assert(out.layoutMode === "HORIZONTAL", "layoutMode HORIZONTAL");
  assert(out.itemSpacing === 20, `itemSpacing 20 (got ${out.itemSpacing})`);
  assert(out.paddingLeft === 10, `paddingLeft 10 (got ${out.paddingLeft})`);
  assert(out.paddingTop === 10, `paddingTop 10 (got ${out.paddingTop})`);
  assert(
    out.counterAxisAlignItems === "MIN",
    `counterAxis MIN (got ${out.counterAxisAlignItems})`,
  );
  assert(
    out.children.map((c: any) => c.id).join(",") === "a,b,c",
    "children ordered a,b,c",
  );
}

{
  console.log("\n2) centerY within 3px → still row at threshold 4");
  const root = frame("p", 300, 50, [
    box("a", 0, 5, 60, 30),
    box("b", 80, 8, 60, 30), // cy differs by 3
    box("c", 160, 5, 60, 30),
  ]);
  const out = runInfer(root, 4);
  assert(out.layoutMode === "HORIZONTAL", "centerY slop → HORIZONTAL");
}

{
  console.log("\n3) threshold boundary: 5px center drift fails at T=4");
  const root = frame("p", 300, 60, [
    box("a", 0, 0, 60, 30),
    box("b", 80, 10, 60, 30), // tops differ by 10 — not a shared edge/center within 4
    box("c", 160, 0, 60, 30),
  ]);
  const out = runInfer(root, 4);
  assert(
    out.layoutMode === "NONE" || out.layoutMode === "HORIZONTAL",
    `freeform or inferred (got ${out.layoutMode})`,
  );
  // With 10px top spread, sharedCrossAlign should fail → NONE
  assert(out.layoutMode === "NONE", "large misalignment stays NONE");
}

{
  console.log("\n4) overlapping icon on button → absolute decoration");
  const root = frame("p", 200, 48, [
    box("btn", 0, 0, 200, 48),
    box("icon", 12, 12, 24, 24, "VECTOR"),
  ]);
  const out = runInfer(root, 4);
  const icon = out.children.find((c: any) => c.id === "icon");
  const btn = out.children.find((c: any) => c.id === "btn");
  // With only 1 flow child after decoration, inference should not force flex
  // OR flex with absolute icon
  if (out.layoutMode === "HORIZONTAL" || out.layoutMode === "VERTICAL") {
    assert(icon?.layoutPositioning === "ABSOLUTE", "icon marked ABSOLUTE");
  } else {
    // Not enough flow siblings — stays NONE (acceptable)
    assert(out.layoutMode === "NONE", "single flow child → no stack");
    assert(btn && icon, "both children present");
  }
}

{
  console.log("\n5) vertical column same X");
  const root = frame("p", 100, 200, [
    box("a", 10, 10, 80, 40),
    box("b", 10, 60, 80, 40),
    box("c", 10, 110, 80, 40),
  ]);
  const out = runInfer(root);
  assert(out.layoutMode === "VERTICAL", "layoutMode VERTICAL");
  assert(out.itemSpacing === 10, `itemSpacing 10 (got ${out.itemSpacing})`);
}

{
  console.log("\n6) existing Auto Layout skipped");
  const root = frame(
    "p",
    200,
    40,
    [box("a", 0, 0, 40, 40), box("b", 50, 0, 40, 40)],
    {
      layoutMode: "HORIZONTAL",
      itemSpacing: 99,
      paddingLeft: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
    },
  );
  const out = runInfer(root);
  assert(out.layoutMode === "HORIZONTAL", "kept HORIZONTAL");
  assert(out.itemSpacing === 99, "did not overwrite itemSpacing");
}

{
  console.log("\n7) fidelity revert: chaotic positions stay NONE");
  const root = frame("p", 400, 400, [
    box("a", 10, 10, 50, 50),
    box("b", 200, 180, 50, 50),
    box("c", 50, 300, 50, 50),
  ]);
  const out = runInfer(root, 4);
  assert(out.layoutMode === "NONE", "chaotic layout not forced to flex");
}

{
  console.log("\n8) adaptRestJson + infer on nested absolute frame");
  const raw = {
    id: "1:1",
    name: "Root",
    type: "FRAME",
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 80 },
    children: [
      {
        id: "1:2",
        name: "A",
        type: "RECTANGLE",
        visible: true,
        absoluteBoundingBox: { x: 20, y: 20, width: 60, height: 40 },
      },
      {
        id: "1:3",
        name: "B",
        type: "RECTANGLE",
        visible: true,
        absoluteBoundingBox: { x: 100, y: 20, width: 60, height: 40 },
      },
      {
        id: "1:4",
        name: "C",
        type: "RECTANGLE",
        visible: true,
        absoluteBoundingBox: { x: 180, y: 20, width: 60, height: 40 },
      },
    ],
  };
  const adapted = adaptRestJsonToAltNodes(raw as any);
  const out = inferSemanticLayout(adapted, { thresholdPx: 4 })[0];
  assert(out.layoutMode === "HORIZONTAL", "adapted tree → HORIZONTAL");
}

{
  console.log("\n9) page sections: preserve group + vertical stack by Y");
  const raw = {
    id: "page",
    name: "Page",
    type: "FRAME",
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 2000 },
    children: [
      {
        id: "hero",
        name: "HeroGroup",
        type: "GROUP",
        visible: true,
        absoluteBoundingBox: { x: 100, y: -50, width: 1000, height: 800 },
        children: [
          {
            id: "hero-child",
            name: "dot",
            type: "RECTANGLE",
            visible: true,
            absoluteBoundingBox: { x: 100, y: -50, width: 40, height: 40 },
          },
        ],
      },
      {
        id: "nav",
        name: "Nav",
        type: "FRAME",
        visible: true,
        absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 80 },
        children: [],
      },
      {
        id: "s1",
        name: "Section1",
        type: "FRAME",
        visible: true,
        absoluteBoundingBox: { x: 0, y: 900, width: 1440, height: 400 },
        children: [],
      },
      {
        id: "s2",
        name: "Section2",
        type: "FRAME",
        visible: true,
        absoluteBoundingBox: { x: 0, y: 1400, width: 1440, height: 400 },
        children: [],
      },
    ],
  };
  const adapted = adaptRestJsonToAltNodes(raw as any);
  assert(
    adapted[0].children.length === 4,
    "GROUP preserved (4 kids, not flattened)",
  );
  const out = inferSemanticLayout(adapted, { thresholdPx: 4 })[0];
  assert(
    out.layoutMode === "VERTICAL",
    `page VERTICAL (got ${out.layoutMode})`,
  );
  assert(
    out.children[0]?.name === "HeroGroup" ||
      out.children[0]?.layoutPositioning === "ABSOLUTE",
    "hero early in DOM / absolute decoration",
  );
  const names = out.children.map((c: any) => c.name);
  const navIdx = names.indexOf("Nav");
  const s1Idx = names.indexOf("Section1");
  const s2Idx = names.indexOf("Section2");
  assert(
    navIdx >= 0 && s1Idx > navIdx && s2Idx > s1Idx,
    "sections ordered Nav → S1 → S2",
  );
  assert(out.paddingTop > 0, `overflow paddingTop (got ${out.paddingTop})`);
}

{
  console.log("\n10) GROUP collage stays freeform (no flex inference)");
  const raw = {
    id: "collage",
    name: "Group 40",
    type: "GROUP",
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 550, height: 600 },
    children: [
      {
        id: "a",
        name: "CardA",
        type: "GROUP",
        visible: true,
        absoluteBoundingBox: { x: 0, y: 120, width: 300, height: 360 },
        children: [],
      },
      {
        id: "b",
        name: "CardB",
        type: "GROUP",
        visible: true,
        absoluteBoundingBox: { x: 350, y: 0, width: 200, height: 600 },
        children: [],
      },
    ],
  };
  const adapted = adaptRestJsonToAltNodes(raw as any);
  const out = inferSemanticLayout(adapted, { thresholdPx: 4 })[0];
  assert(
    out.layoutMode === "NONE",
    `GROUP layoutMode stays NONE (got ${out.layoutMode})`,
  );
  assert(out.children.length === 2, "both collage groups kept");
  const [a, b] = out.children;
  assert(
    Math.abs(a.x - 0) < 1 && Math.abs(a.y - 120) < 1,
    `CardA at 0,120 (got ${a.x},${a.y})`,
  );
  assert(
    Math.abs(b.x - 350) < 1 && Math.abs(b.y - 0) < 1,
    `CardB at 350,0 (got ${b.x},${b.y})`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
