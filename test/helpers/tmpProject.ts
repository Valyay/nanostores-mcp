import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function writeFile(rootDir: string, relativePath: string, contents: string): Promise<void> {
	const filePath = path.join(rootDir, relativePath);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, contents, "utf8");
}

export async function createTempProject(
	files: Record<string, string>,
	prefix: string = "nanostores-mcp-test-",
): Promise<{ rootDir: string; cleanup: () => Promise<void> }> {
	const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

	for (const [relativePath, contents] of Object.entries(files)) {
		await writeFile(rootDir, relativePath, contents);
	}

	return {
		rootDir,
		cleanup: async () => {
			await fs.rm(rootDir, { recursive: true, force: true });
		},
	};
}
