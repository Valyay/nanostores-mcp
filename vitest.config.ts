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
				lines: 60,
				branches: 53,
				functions: 60,
			},
		},
	},
});
