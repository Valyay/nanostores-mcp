import { z } from "zod";

const EnvSchema = z.object({
	NANOSTORES_MCP_ROOTS: z.string().optional(),
	NANOSTORES_MCP_ROOT: z.string().optional(),
	WORKSPACE_FOLDER: z.string().optional(),
	WORKSPACE_FOLDER_PATHS: z.string().optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export const envConfig: EnvConfig = EnvSchema.parse(process.env);
