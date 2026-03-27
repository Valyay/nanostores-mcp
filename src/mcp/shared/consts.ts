import { TOOLS } from "../uris.js";

export function storeNotFoundMessage(key: string, rootPath: string): string {
	return (
		`Store not found.\n\n` +
		`Requested: ${key}\n` +
		`Root: ${rootPath}\n\n` +
		`Possible actions:\n` +
		`- Run ${TOOLS.scanProject} first to index the project.\n` +
		`- If the store was recently added, run ${TOOLS.clearCache} then ${TOOLS.scanProject}.\n` +
		`- Check the store name/id for typos.`
	);
}

export const DOCS_DISABLED_MESSAGE = `Nanostores documentation was not found automatically.

The server looks for the \`nanostores\` package in your project's node_modules.
Make sure nanostores is installed:

  npm install nanostores

Or set the docs root explicitly:

  NANOSTORES_DOCS_ROOT=/path/to/nanostores/docs
`;
