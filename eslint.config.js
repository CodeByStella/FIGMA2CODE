const next = require("eslint-config-next");
const prettier = require("eslint-config-prettier");

module.exports = [
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  ...next,
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
