import { z } from "zod";

export const EnvSchema = z.object({
	NANOSTORES_MCP_ROOTS: z.string().optional(),
	NANOSTORES_MCP_ROOT: z.string().optional(),
	WORKSPACE_FOLDER: z.string().optional(),
	WORKSPACE_FOLDER_PATHS: z.string().optional(),
	// Logger bridge configuration
	NANOSTORES_MCP_LOGGER_ENABLED: z
		.string()
		.optional()
		.transform(val => val === "true" || val === "1"),
	NANOSTORES_MCP_LOGGER_PORT: z
		.string()
		.optional()
		.default("3999")
		.transform(val => Number.parseInt(val, 10))
		.pipe(z.number().int().min(0).max(65535)),
	NANOSTORES_MCP_LOGGER_HOST: z
		.string()
		.optional()
		.default("127.0.0.1")
		.refine(
			host => ["127.0.0.1", "localhost", "::1"].includes(host),
			{
				message:
					"NANOSTORES_MCP_LOGGER_HOST must be a loopback address (127.0.0.1, localhost, ::1). " +
					"Binding to 0.0.0.0 or other non-loopback addresses is not allowed for security reasons.",
			},
		),
	// Docs configuration
	NANOSTORES_DOCS_ROOT: z.string().optional(),
	NANOSTORES_DOCS_PATTERNS: z
		.string()
		.optional()
		.transform(val => (val ? val.split(",").map(p => p.trim()) : undefined)),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export const envConfig: EnvConfig = EnvSchema.parse(process.env);
