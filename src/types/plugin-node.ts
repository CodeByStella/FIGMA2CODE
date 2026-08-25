import "@figma/plugin-typings";

export type ParentNode = BaseNode & ChildrenMixin;

export type PluginAltNodeMetadata<T extends BaseNode> = {
  originalNode: T;
  canBeFlattened: boolean;
  svg?: string;
  base64?: string;
};

/** Live SceneNode enriched with flatten/embed metadata during conversion. */
export type PluginAltNode<T extends BaseNode> = T & PluginAltNodeMetadata<T>;

export type ExportableNode = SceneNode & ExportMixin & MinimalFillsMixin;

export type StyledTextSegmentSubset = Omit<
  StyledTextSegment,
  "listSpacing" | "paragraphIndent" | "paragraphSpacing" | "textStyleOverrides"
>;
