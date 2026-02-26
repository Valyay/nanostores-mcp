import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.{ts,tsx}"],
		exclude: ["node_modules/**", "dist/**"],
		testTimeout: 30_000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/index.ts", "src/cli.ts"],
			thresholds: {
				lines: 54,
				branches: 48,
				functions: 54,
			},
		},
	},
});
