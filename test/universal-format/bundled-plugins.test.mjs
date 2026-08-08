import { test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatInProcess } from "../../plugins/universal-format/mcp/server.mjs";

// The three third-party prettier plugins bundled into the artifact (java, php, shell) plus the
// four core-parser languages the routing gap opened up (less, html, vue, graphql). Imports the
// BUILT bundle, so this also proves the two committed .wasm sidecars load from their committed
// location. formatInProcess infers the parser from the filepath, so these cases need no EXT_MAP
// entry.

/** @param {string} prefix @returns {string} */
function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

const CASES = [
  ["a.sh", "shell", "echo  hi", "echo hi\n"],
  ["a.bash", "shell", "echo  hi", "echo hi\n"],
  ["A.java", "java", "class A {  }", "class A {}\n"],
  ["a.php", "php", '<?php  echo "hi";', '<?php echo "hi";\n'],
  ["a.less", "less", "@c:  red;\n.a{color:@c}\n", "@c: red;\n.a {\n  color: @c;\n}\n"],
  ["a.html", "html", "<div>   <p>hi</p>   </div>", "<div><p>hi</p></div>\n"],
  ["a.htm", "html", "<div>   <p>hi</p>   </div>", "<div><p>hi</p></div>\n"],
  ["a.vue", "vue", "<template><p>hi</p></template>\n\n<script setup>\nlet x=1\n</script>", "<template><p>hi</p></template>\n\n<script setup>\nlet x = 1;\n</script>\n"],
  ["a.graphql", "graphql", "query   Q {  a }", "query Q {\n  a\n}\n"],
  ["a.gql", "graphql", "query   Q {  a }", "query Q {\n  a\n}\n"],
];

test("formatInProcess formats every bundled-plugin and newly-routed language", async () => {
  const cwd = tmp("uf-bundled-");
  for (const [file, lang, src, expected] of CASES) {
    const out = await formatInProcess(src, path.join(cwd, file), cwd, lang);
    assert.equal(out, expected, `${file} must be formatted by the bundled prettier`);
    assert.notEqual(out, src, `${file} must actually change`);
  }
});

// The fail-open precondition: the handlers swallow whatever format() throws, so what matters is
// that a plugin that cannot parse its input THROWS rather than returning mangled output.
test("a bundled plugin that cannot parse its input throws (the fail-open precondition)", async () => {
  const cwd = tmp("uf-bundled-bad-");
  await assert.rejects(() => formatInProcess("if [ ; then\n", path.join(cwd, "bad.sh"), cwd, "shell"));
  await assert.rejects(() => formatInProcess("class {{{\n", path.join(cwd, "bad.java"), cwd, "java"));
  await assert.rejects(() => formatInProcess("<?php class {{{\n", path.join(cwd, "bad.php"), cwd, "php"));
});

// Cheap structural tripwire for the one thing standing between a missing sidecar and a dead MCP
// server: prettier-plugin-java starts Parser.init() in a module-scope IIFE at import time.
test("importing the bundle arms the unhandledRejection guard", () => {
  // `node --test` installs an unhandledRejection listener of its own (verified: count is already 1
  // in a test file that imports nothing), so a bare count check would pass vacuously and never
  // catch the guard being dropped. Identify OUR listener by the stderr note it writes instead.
  const armed = process.listeners("unhandledRejection").filter((/** @type {unknown} */ fn) => String(fn).includes("[universal-format]"));
  assert.equal(armed.length, 1, "prettier.ts must arm exactly one process-level unhandledRejection handler");
});
