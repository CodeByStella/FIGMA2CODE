import { type Node } from "./figma-rest";

/** REST JSON_REST_V1 node after nodesToJSON enrichment. */
export type RestAltNode = Node & {
  styledTextSegments: Array<
    Pick<StyledTextSegment, any | "characters" | "start" | "end">
  >;
  cumulativeRotation: number;
  uniqueName: string;
  canBeFlattened: boolean;
  isRelative: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
};
