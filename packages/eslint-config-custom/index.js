const next = require("eslint-config-next");
const prettier = require("eslint-config-prettier");
const turboFlat = require("eslint-config-turbo/flat");
const turbo = turboFlat.default ?? turboFlat;

module.exports = [
  {
    ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**"],
  },
  ...next,
  ...(Array.isArray(turbo) ? turbo : [turbo]),
  prettier,
  {
    settings: {
      react: {
        version: "19.2.6",
      },
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];
