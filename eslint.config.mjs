import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default [
	{
		ignores: ["dist/**", "node_modules/**"],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		linterOptions: {
			reportUnusedDisableDirectives: false,
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
			"@typescript-eslint/explicit-function-return-type": "error",
			"@typescript-eslint/no-misused-promises": "error",
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
];
