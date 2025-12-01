import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default tseslint.config(
	{
		ignores: ["dist/**", "node_modules/**"],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		linterOptions: {
			reportUnusedDisableDirectives: false,
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
			"@typescript-eslint/explicit-function-return-type": "error",
		},
	},
	{
		files: ["src/**/*.ts"],
		ignores: ["**/*.test.ts"],
		rules: {
			"no-console": "error",
		},
	},
	eslintConfigPrettier,
);
