import type { AST } from "svelte/compiler";
import { ScriptKind } from "typescript";

export interface SfcScriptResult {
	code: string;
	scriptKind: ScriptKind;
	hasScript: boolean;
}

const NO_SCRIPT: SfcScriptResult = { code: "", scriptKind: ScriptKind.JS, hasScript: false };

type VueParser = typeof import("@vue/compiler-sfc").parse;
type SvelteParser = typeof import("svelte/compiler").parse;

let vueParser: VueParser | false | undefined;
let svelteParser: SvelteParser | false | undefined;

async function getVueParser(): Promise<VueParser | undefined> {
	if (vueParser === false) return undefined;
	if (vueParser) return vueParser;
	try {
		const mod = await import("@vue/compiler-sfc");
		vueParser = mod.parse;
		return vueParser;
	} catch {
		vueParser = false;
		return undefined;
	}
}

async function getSvelteParser(): Promise<SvelteParser | undefined> {
	if (svelteParser === false) return undefined;
	if (svelteParser) return svelteParser;
	try {
		const mod = await import("svelte/compiler");
		svelteParser = mod.parse;
		return svelteParser;
	} catch {
		svelteParser = false;
		return undefined;
	}
}

type ScriptKindInput = ScriptKind | undefined;

function inferScriptKind(lang?: string | null): ScriptKind {
	if (!lang) return ScriptKind.JS;
	const normalized = lang.toLowerCase();
	if (normalized === "ts") return ScriptKind.TS;
	if (normalized === "tsx") return ScriptKind.TSX;
	if (normalized === "jsx") return ScriptKind.JSX;
	return ScriptKind.JS;
}

function promoteScriptKind(current: ScriptKind, next: ScriptKindInput): ScriptKind {
	if (!next) return current;
	const rank = (kind: ScriptKind): number => {
		switch (kind) {
			case ScriptKind.TSX:
				return 3;
			case ScriptKind.TS:
				return 2;
			case ScriptKind.JSX:
				return 1;
			default:
				return 0;
		}
	};

	return rank(next) > rank(current) ? next : current;
}

function formatParseError(errors: unknown[]): Error {
	const first = errors[0];
	if (first instanceof Error) {
		return first;
	}
	const message =
		typeof first === "string" ? first : "Failed to parse single-file component script.";
	return new Error(message);
}

export async function extractScriptsFromVueSfc(
	contents: string,
	filePath: string,
): Promise<SfcScriptResult> {
	const parse = await getVueParser();
	if (!parse) return NO_SCRIPT;

	const { descriptor, errors } = parse(contents, { filename: filePath });
	if (errors.length > 0) {
		throw formatParseError(errors);
	}

	const hasScript = Boolean(descriptor.script || descriptor.scriptSetup);
	let scriptKind = ScriptKind.JS;

	scriptKind = promoteScriptKind(scriptKind, inferScriptKind(descriptor.script?.lang));
	scriptKind = promoteScriptKind(scriptKind, inferScriptKind(descriptor.scriptSetup?.lang));

	if (!hasScript) {
		return { code: "", scriptKind, hasScript: false };
	}

	// Collect raw script blocks. We intentionally use raw content rather than
	// compileScript() because the compiler wraps <script setup> code inside a
	// setup() function, which breaks subscriber container detection (the
	// scanner needs top-level useStore() calls to infer the component name
	// from the file).
	const parts: string[] = [];
	if (descriptor.script) {
		parts.push(descriptor.script.content);
	}
	if (descriptor.scriptSetup) {
		parts.push(descriptor.scriptSetup.content);
	}

	return {
		code: parts.join("\n"),
		scriptKind,
		hasScript: true,
	};
}

type Range = { start: number; end: number };

function getLangFromAttributes(attrs?: AST.Attribute[] | null): string | undefined {
	if (!attrs) return undefined;
	const attr = attrs.find(entry => entry.name === "lang");
	if (!attr) {
		return undefined;
	}

	const { value } = attr;
	if (!Array.isArray(value) || value.length === 0) {
		return undefined;
	}

	const first = value[0];
	if (first && "data" in first && typeof first.data === "string") {
		return first.data;
	}

	return undefined;
}

function getContentRange(block: AST.Script): Range | undefined {
	const content = block.content as unknown;
	if (
		content &&
		typeof (content as Range).start === "number" &&
		typeof (content as Range).end === "number"
	) {
		return content as Range;
	}

	return undefined;
}

export async function extractScriptsFromSvelteSfc(
	contents: string,
	filePath: string,
): Promise<SfcScriptResult> {
	const parse = await getSvelteParser();
	if (!parse) return NO_SCRIPT;

	const ast = parse(contents, { filename: filePath, modern: true });

	const scripts: Array<{ start: number; code: string; lang?: string }> = [];
	let scriptKind = ScriptKind.JS;

	const addScript = (block: AST.Script | null): void => {
		if (!block) return;
		const lang = getLangFromAttributes(block.attributes);
		scriptKind = promoteScriptKind(scriptKind, inferScriptKind(lang));

		const range = getContentRange(block);
		const start = range?.start ?? block.start;
		const code = range ? contents.slice(range.start, range.end) : "";

		scripts.push({ start, code: code.trim().length > 0 ? code : "", lang });
	};

	addScript(ast.module);
	addScript(ast.instance);

	const hasScript = Boolean(ast.module || ast.instance);

	const ordered = scripts.sort((a, b) => a.start - b.start).map(entry => entry.code);

	return {
		code: ordered.join("\n"),
		scriptKind,
		hasScript,
	};
}
