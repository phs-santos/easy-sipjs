import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist/", "examples/", "node_modules/"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            // `catch (_) {}` around best-effort cleanup is deliberate throughout the library.
            "no-empty": ["error", { allowEmptyCatch: true }],
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^(_|e)$",
            }],
        },
    },
    {
        // Fakes of SIP stack objects are loosely typed on purpose.
        files: ["test/**"],
        rules: { "@typescript-eslint/no-explicit-any": "off" },
    },
);
