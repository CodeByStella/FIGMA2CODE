export const variableToColorName = async (id: string) => {
  return (
    (await figma.variables.getVariableByIdAsync(id))?.name
      .replaceAll("/", "-")
      .replaceAll(" ", "-") || id.toLowerCase().replaceAll(":", "-")
  );
};
