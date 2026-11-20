// Finds real Node global use in the text of a browser bundle. Used by test/build.test.ts.
//
// Known limit: this is a regular-expression check on text, not a parser. It cannot see a trick such as
// `const g = globalThis; g['pro' + 'cess']`. It guards against accidents, not against a determined workaround.
// A string such as "process.env" is flagged on purpose (the safer side). The method name `process(inputs)` of the
// Web Audio API is not flagged: the decision is made by the syntax around the word, not by a list of files.

const PATTERNS: RegExp[] = [
  // `process` as an object: process.env, process?.env, process["env"]. `.process` after a dot is a property, not the object.
  /(?<![.\w$])process\s*(?:\?\.|\.(?=[A-Za-z_$])|\[)/g,
  /\btypeof\s+process\b/g,
  /\b(?:globalThis|window|self)\s*\.\s*process\b/g,
  /\brequire\s*\(/g,
  /\b__dirname\b/g,
  /\b__filename\b/g,
  /\bmodule\.exports\b/g,
  /(?<![.\w$])exports\.\w+\s*=/g,
  /["']node:[^"']*["']/g,
  /["'](?:fs|path|zlib)["']\s*[;)]/g,
];

// import "x", import x from "x", export ... from "x", import("x"): returns the specifier.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
const BARE_NODE_MODULE = /^(?:fs|path|zlib)(?:\/|$)/;

export function findNodeGlobalUse(text: string): string[] {
  const hits: { at: number; snippet: string }[] = [];
  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern)) hits.push({ at: m.index ?? 0, snippet: m[0] });
  }
  for (const m of text.matchAll(SPECIFIER)) {
    if (BARE_NODE_MODULE.test(m[1])) hits.push({ at: m.index ?? 0, snippet: m[0] });
  }
  const seen = new Set<string>();
  return hits
    .sort((a, b) => a.at - b.at)
    .filter((h) => {
      const key = `${h.at}:${h.snippet}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((h) => h.snippet);
}
