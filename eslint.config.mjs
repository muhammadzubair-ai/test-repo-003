import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Intentional boundary violation used only by the layer-boundary test.
    "src/web/__lint_fixtures__/**",
  ]),
  {
    files: ["src/web/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db", "@/db/*", "**/src/db", "**/src/db/*", "../db", "../db/*", "../../db", "../../db/*"],
              message: "web layer must not import from src/db",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
