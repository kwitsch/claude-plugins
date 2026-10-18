import { expect, mock, test, type TestBody } from "claude-code/testing";

type On = Parameters<TestBody>[1];
type Run = { exitCode: number; stdout: string; stderr: string };

// "Täglich grüßt der Bär" in Windows-1252, and the same text in UTF-8, as base64.
const LEGACY = btoa("T\xe4glich gr\xfc\xdft der B\xe4r\n");
const UTF8 = btoa("T\xc3\xa4glich gr\xc3\xbc\xc3\x9ft\n");

// Stands for the engine's file system: `files` maps an absolute path to its base64 content.
function stubFiles(on: On, files: Record<string, string>): void {
  on("session.cwd", async () => ({ value: "/w" }));
  mock.env(on, { HOME: "/home/u" });
  on("fs.stat", async (_$, e) => {
    // A resolving stat (the worktree refresh's git dirs) lands where it points: no links here.
    if (e.resolve) return { value: { kind: "dir" as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } };
    const b64 = files[e.path];
    if (b64 === undefined) return { deny: `ENOENT ${e.path}` };
    return { value: { kind: "file" as const, size: atob(b64).length, mtimeMs: 0, isLink: false } };
  });
  on("fs.read", async (_$, e) => {
    const b64 = files[e.path];
    return b64 === undefined ? { deny: `ENOENT ${e.path}` } : { value: { base64: b64 } };
  });
}

// The tool itself, beneath the plugin: records that it ran.
function stubTool(on: On, result: unknown = "ran"): { ran: number } {
  const st = { ran: 0 };
  on("tool.call", async () => {
    st.ran += 1;
    return { result };
  });
  return st;
}

test("Read of a Windows-1252 file is denied with the iconv hint; the tool never runs", async ($, on) => {
  stubFiles(on, { "/w/legacy.txt": LEGACY });
  const tool = stubTool(on);
  const r = await $.tool.call({ tool: "Read", file_path: "/w/legacy.txt" });
  expect(r.deny).toContain("encoding-guard: /w/legacy.txt (ISO-8859-1/Windows-1252 (legacy single-byte)) is not UTF-8.");
  expect(r.deny).toContain("iconv -f WINDOWS-1252 -t UTF-8 '/w/legacy.txt'");
  expect(tool.ran).toBe(0);
});

test("Read of a UTF-8 file and of a missing file pass to the tool", async ($, on) => {
  stubFiles(on, { "/w/utf8.txt": UTF8 });
  const tool = stubTool(on);
  expect((await $.tool.call({ tool: "Read", file_path: "/w/utf8.txt" })).result).toBe("ran");
  expect((await $.tool.call({ tool: "Write", file_path: "/w/new.txt", content: "x" })).result).toBe("ran");
  expect(tool.ran).toBe(2);
});

test("Bash resolves a relative content-tool argument against the session cwd", async ($, on) => {
  stubFiles(on, { "/w/legacy.txt": LEGACY });
  const tool = stubTool(on);
  expect((await $.tool.call({ tool: "Bash", command: "cat legacy.txt | grep x" })).deny).toContain("/w/legacy.txt");
  expect((await $.tool.call({ tool: "Bash", command: "iconv -f WINDOWS-1252 -t UTF-8 legacy.txt" })).result).toBe("ran");
  expect(tool.ran).toBe(1);
});
