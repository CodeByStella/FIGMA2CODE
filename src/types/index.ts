/**
 * Shared TypeScript contracts for the plugin main thread, UI iframe, and
 * convert pipeline (settings, messages, node shapes, layout, colors).
 */
import "@figma/plugin-typings";

export * from "./settings";
export * from "./messages";
export * from "./plugin-node";
export * from "./layout";
export * from "./color";
export type { RestAltNode } from "./rest-node";
