// Indent nested HTML emitted by generate.ts (adapted from sindresorhus/indent-string).
export const indentString = (str: string, indentLevel: number = 2): string => {
  const regex = /^(?!\s*$)/gm;
  return str.replace(regex, " ".repeat(indentLevel));
};

export const indentStringFlutter = (
  str: string,
  indentLevel: number = 2,
): string => {
  const regex = /^(?!\s*$)/gm;
  return str.replace(regex, " ".repeat(indentLevel));
};
