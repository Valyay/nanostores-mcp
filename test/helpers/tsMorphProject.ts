import path from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { JsxEmit } from "typescript";

export interface TsMorphProjectResult {
	project: Project;
	absRoot: string;
	sourceFiles: Map<string, SourceFile>;
}

export function createTsMorphProject(
	files: Record<string, string>,
	absRoot: string = "/project",
): TsMorphProjectResult {
	const project = new Project({
		useInMemoryFileSystem: true,
		skipAddingFilesFromTsConfig: true,
		compilerOptions: {
			allowJs: true,
			jsx: JsxEmit.Preserve,
		},
	});

	const sourceFiles = new Map<string, SourceFile>();

	for (const [relativePath, contents] of Object.entries(files)) {
		const filePath = path.join(absRoot, relativePath);
		const sourceFile = project.createSourceFile(filePath, contents, { overwrite: true });
		sourceFiles.set(relativePath, sourceFile);
	}

	return { project, absRoot, sourceFiles };
}

export function createSourceFile(
	code: string,
	relativePath: string = "file.ts",
	absRoot: string = "/project",
): { project: Project; absRoot: string; sourceFile: SourceFile } {
	const { project, sourceFiles } = createTsMorphProject({ [relativePath]: code }, absRoot);
	const sourceFile = sourceFiles.get(relativePath);
	if (!sourceFile) {
		throw new Error(`Source file not found for ${relativePath}`);
	}
	return { project, absRoot, sourceFile };
}
