/** Resolve bound variable id to a CSS custom-property name segment. */
export const variableToColorName = async (id: string) => {
  return (
    (await figma.variables.getVariableByIdAsync(id))?.name
      .replaceAll("/", "-")
      .replaceAll(" ", "-") || id.toLowerCase().replaceAll(":", "-")
  );
};
