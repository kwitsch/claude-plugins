import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInvocation,
  REGISTRY,
} from "../../plugins/universal-format/mcp/server.mjs";

const shfmt = REGISTRY.shell.chain[0];
const gjf = REGISTRY.java.chain[0];
const clang = REGISTRY.java.chain[1];
const biome = REGISTRY.jsts.chain[1];
const ruff = REGISTRY.python.chain[0];
const black = REGISTRY.python.chain[1];

test("native/fixed tools always run bare regardless of editorconfig", () => {
  assert.deepEqual(
    buildInvocation(shfmt, { editorconfig: { indent_style: "tab" } }),
    { argv: ["-w"] },
  );
});

test("google-java-format: indent_size 4 -> --aosp", () => {
  assert.deepEqual(buildInvocation(gjf, { editorconfig: { indent_size: 4 } }), {
    argv: ["--aosp", "--replace"],
  });
});

test("google-java-format: indent_size 2 or no editorconfig -> bare", () => {
  assert.deepEqual(buildInvocation(gjf, { editorconfig: { indent_size: 2 } }), {
    argv: ["--replace"],
  });
  assert.deepEqual(buildInvocation(gjf, { editorconfig: null }), {
    argv: ["--replace"],
  });
});

test("google-java-format: hard conflicts skip (tab, odd indent, narrow columns)", () => {
  assert.deepEqual(
    buildInvocation(gjf, { editorconfig: { indent_style: "tab" } }),
    { skip: true },
  );
  assert.deepEqual(buildInvocation(gjf, { editorconfig: { indent_size: 3 } }), {
    skip: true,
  });
  assert.deepEqual(
    buildInvocation(gjf, { editorconfig: { indent_size: "tab" } }),
    { skip: true },
  );
  assert.deepEqual(
    buildInvocation(gjf, { editorconfig: { max_line_length: 80 } }),
    { skip: true },
  );
});

test("google-java-format: native config beats editorconfig -> bare", () => {
  assert.deepEqual(
    buildInvocation(gjf, {
      hasNativeConfig: true,
      editorconfig: { indent_style: "tab" },
    }),
    { argv: ["--replace"] },
  );
});

test("black: tab indent skips; max_line_length maps", () => {
  assert.deepEqual(
    buildInvocation(black, { editorconfig: { indent_style: "tab" } }),
    { skip: true },
  );
  assert.deepEqual(
    buildInvocation(black, { editorconfig: { max_line_length: 100 } }),
    { argv: ["--quiet", "--line-length", "100"] },
  );
});

test("ruff: editorconfig maps line length + indent style/width", () => {
  assert.deepEqual(
    buildInvocation(ruff, {
      editorconfig: {
        max_line_length: 88,
        indent_style: "space",
        indent_size: 4,
      },
    }),
    {
      argv: [
        "format",
        "--quiet",
        "--line-length",
        "88",
        "--config",
        "format.indent-style='space'",
        "--config",
        "format.indent-width=4",
      ],
    },
  );
});

test("biome: editorconfig maps indent + line ending + width", () => {
  assert.deepEqual(
    buildInvocation(biome, {
      editorconfig: {
        indent_style: "space",
        indent_size: 2,
        end_of_line: "lf",
        max_line_length: 100,
      },
    }),
    {
      argv: [
        "format",
        "--write",
        "--log-level=none",
        "--indent-style=space",
        "--indent-width=2",
        "--line-ending=lf",
        "--line-width=100",
      ],
    },
  );
});

test("clang-format: editorconfig builds an explicit Google-based style", () => {
  assert.deepEqual(
    buildInvocation(clang, {
      editorconfig: {
        indent_size: 2,
        indent_style: "space",
        max_line_length: 100,
      },
    }),
    {
      argv: [
        "-i",
        "--style={BasedOnStyle: Google, IndentWidth: 2, UseTab: Never, ColumnLimit: 100}",
      ],
    },
  );
});

test("clang-format: native config -> bare (fallback ignored when .clang-format present)", () => {
  assert.deepEqual(
    buildInvocation(clang, {
      hasNativeConfig: true,
      editorconfig: { indent_size: 2 },
    }),
    { argv: ["-i", "--style=file", "--fallback-style=Google"] },
  );
});
