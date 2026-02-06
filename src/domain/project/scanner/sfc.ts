import { parse as parseVue, compileScript } from "@vue/compiler-sfc";
import { parse as parseSvelte } from "svelte/compiler";
import type { AST } from "svelte/compiler";
import { ScriptKind } from "typescript";

export interface SfcScriptResult {
	code: string;
	scriptKind: ScriptKind;
	hasScript: boolean;
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

export function extractScriptsFromVueSfc(contents: string, filePath: string): SfcScriptResult {
	const { descriptor, errors } = parseVue(contents, { filename: filePath });
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

	if (descriptor.scriptSetup) {
		try {
			const compiled = compileScript(descriptor, { id: filePath });
			return {
				code: compiled.content ?? "",
				scriptKind,
				hasScript: true,
			};
		} catch {
			const fallback = descriptor.scriptSetup.content ?? "";
			return {
				code: fallback,
				scriptKind,
				hasScript: true,
			};
		}
	}

	return {
		code: descriptor.script?.content ?? "",
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

export function extractScriptsFromSvelteSfc(contents: string, filePath: string): SfcScriptResult {
	const ast = parseSvelte(contents, { filename: filePath, modern: true });

	const scripts: Array<{ start: number; code: string; lang?: string }> = [];
	let scriptKind = ScriptKind.JS;

	const addScript = (block: AST.Script | null) => {
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
