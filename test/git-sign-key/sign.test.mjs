// Ports every case of the former bats suite for sign-commits.sh / check-sign-key.sh
// to the pure plugins/git-sign-key/hooks/sign.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MISSING_KEY_WARNING, UNUSABLE_KEY_WARNING, keyPath, probeArgv, rewriteCommand, rewriteNote, sessionWarning, signFlags } from "../../plugins/git-sign-key/hooks/sign.mjs";

const HOME = "/tmp/home";
const KEY = keyPath(HOME);
const FLAGS = signFlags(KEY);
/** @param {string} cmd */
const rw = (cmd) => rewriteCommand(cmd, KEY);
/** @param {string} s @param {string} sub */
const count = (s, sub) => s.split(sub).length - 1;
/** @param {string} s */
const parses = (s) => spawnSync("bash", ["-n"], { input: s }).status === 0;

test("keyPath appends .claude/sign.key; unset HOME gives the root path", () => {
  assert.equal(KEY, "/tmp/home/.claude/sign.key");
  assert.equal(keyPath(undefined), "/.claude/sign.key");
});

test("rewrites git commit", () => {
  const out = rw('git commit -m "Fix bug"');
  assert.match(out, /gpg\.format=ssh/);
  assert.ok(out.includes(`user.signingkey='${KEY}'`));
  assert.match(out, /commit\.gpgsign=true/);
  assert.ok(out.includes('commit -m "Fix bug"'));
});

test("rtk-wrapped git commit is signed (rtk is a transparent wrapper)", () => {
  assert.equal(rw("rtk git commit -m x"), `rtk git ${FLAGS} commit -m x`);
  assert.equal(rw("cd a && rtk git commit -m x"), `cd a && rtk git ${FLAGS} commit -m x`);
  assert.equal(rw("rtk git status"), "rtk git status");
  assert.equal(rw("echo rtk git commit"), "echo rtk git commit");
});

test("non-commit command untouched", () => {
  assert.equal(rw("ls -la"), "ls -la");
});

test("commit whose message mentions the key path is still signed", () => {
  const out = rw(`git commit -m 'update ${KEY} docs'`);
  assert.match(out, /gpg\.format=ssh/);
  assert.ok(out.includes(`update ${KEY} docs`));
});

test("non-commit git subcommand starting with 'commit' is untouched", () => {
  assert.equal(rw("git commit-tree -p HEAD"), "git commit-tree -p HEAD");
});

test("bare 'git commit' at end of string is rewritten exactly", () => {
  assert.equal(rw("cd /repo && git commit"), `cd /repo && git ${FLAGS} commit`);
});

test("ampersand in $HOME stays literal in the injected key path", () => {
  const key = keyPath("/tmp/a&b");
  const out = rewriteCommand("git commit -m x", key);
  assert.ok(out.includes("user.signingkey='/tmp/a&b/.claude/sign.key'"));
  assert.ok(!out.includes("git commitb"));
});

test("injects signing config exactly once when the message contains 'git commit'", () => {
  const out = rw('git commit -m "fix the git commit flow"');
  assert.equal(count(out, "user.signingkey="), 1);
  assert.ok(out.includes("fix the git commit flow"));
});

test("rewritten command is valid shell", () => {
  const out = rw('git commit -m "Fix bug"');
  assert.match(out, /gpg\.format=ssh/);
  assert.ok(parses(out));
});

test("heredoc commit message is signed and preserved", () => {
  const out = rw("git commit -m \"$(cat <<'EOF'\nAdd feature\n\nBody line.\nEOF\n)\"");
  assert.match(out, /gpg\.format=ssh/);
  assert.ok(out.includes("Add feature"));
  assert.ok(out.includes("Body line."));
});

test("rewrite injects gpg.ssh.program=ssh-keygen to bypass a custom signer", () => {
  assert.match(rw("git commit -m x"), /gpg\.ssh\.program=ssh-keygen/);
});

test("both commits in a compound command are signed", () => {
  const out = rw("git commit -m a && git commit -m b");
  assert.equal(count(out, "user.signingkey="), 2);
  assert.ok(out.includes("commit -m a"));
  assert.ok(out.includes("commit -m b"));
});

test("git -C <path> commit is signed", () => {
  const out = rw("git -C /repo commit -m x");
  assert.match(out, /gpg\.ssh\.program=ssh-keygen/);
  assert.ok(out.includes("-C /repo commit -m x"));
  assert.ok(parses(out));
});

test("git --no-pager commit is signed", () => {
  const out = rw("git --no-pager commit -m x");
  assert.match(out, /gpg\.format=ssh/);
  assert.ok(out.includes("--no-pager commit -m x"));
});

test("commit followed by a semicolon is signed", () => {
  const out = rw("git commit; echo done");
  assert.match(out, /gpg\.format=ssh/);
  assert.ok(out.includes("commit; echo done"));
});

test("commit followed by a newline is signed", () => {
  const out = rw("git commit\necho hi");
  assert.match(out, /gpg\.format=ssh/);
  assert.ok(out.includes("echo hi"));
});

test("quoted 'git commit' in an earlier argument is not mistaken for the real commit", () => {
  const out = rw('echo "git commit now" && git commit -m x');
  assert.equal(count(out, "user.signingkey="), 1);
  assert.ok(out.includes('echo "git commit now"'));
  assert.ok(out.includes("commit -m x"));
});

test("already-wired command is left untouched (idempotent)", () => {
  const wired = `git ${FLAGS} commit -m x`;
  assert.equal(rw(wired), wired);
});

test("a separator inside the commit message does not corrupt the message", () => {
  const out = rw('git commit -m "fix; git commit later"');
  assert.equal(count(out, "user.signingkey="), 1);
  assert.ok(out.includes('-m "fix; git commit later"'));
});

test("parenthesised 'git commit' inside the message does not corrupt the message", () => {
  const out = rw('git commit -m "see (git commit) here"');
  assert.equal(count(out, "user.signingkey="), 1);
  assert.ok(out.includes("see (git commit) here"));
});

test("separator + 'git commit' inside a quoted argument is left untouched", () => {
  const out = rw('echo "x; git commit" && git commit -m x');
  assert.equal(count(out, "user.signingkey="), 1);
  assert.ok(out.includes('echo "x; git commit"'));
  assert.ok(out.includes("commit -m x"));
});

test("real 'git commit' inside $(...) substitution is still signed", () => {
  const out = rw("out=$(git commit -m x)");
  assert.match(out, /gpg\.format=ssh/);
  assert.ok(out.includes("commit -m x)"));
});

test("real 'git commit' inside backticks is signed", () => {
  assert.match(rw("out=`git commit`"), /gpg\.format=ssh/);
});

test("a user-pinned gpg.ssh.program alone does not suppress key injection", () => {
  assert.match(rw("git -c gpg.ssh.program=ssh-keygen commit -m x"), /user\.signingkey=/);
});

test("degenerate 'git -- commit' is not treated as a commit invocation", () => {
  assert.equal(rw("git -- commit"), "git -- commit");
});

test("env-var assignment prefix before git commit is still signed", () => {
  const out = rw('GIT_COMMITTER_DATE="2020-01-01 00:00:00" git commit -m x');
  assert.match(out, /gpg\.format=ssh/);
  assert.ok(out.includes("commit -m x"));
});

test("assignment-looking token as a command argument is not a commit position", () => {
  assert.equal(rw("make FOO=bar"), "make FOO=bar");
});

test("rewriteNote names the key file", () => {
  assert.ok(rewriteNote(KEY).startsWith(`git-sign-key: routed commit signing through ${KEY} `));
});

// SessionStart: sessionWarning over a real ssh-keygen probe (probeArgv) of a temp key.
const hasKeygen = spawnSync("ssh-keygen", ["-?"]).error === undefined;
/** @param {(key: string) => void} make @returns {string | null} */
function warnFor(make) {
  const dir = mkdtempSync(join(tmpdir(), "gsk-"));
  try {
    const key = keyPath(dir);
    spawnSync("mkdir", ["-p", join(dir, ".claude")]);
    make(key);
    const [cmd, ...args] = probeArgv(key);
    const r = spawnSync(cmd, args, { input: "", encoding: "utf8" });
    return sessionWarning(true, r.error ? null : r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** @param {string} key @param {string} pw */
const genKey = (key, pw) => spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", pw, "-C", "test", "-f", key]);

test("SessionStart warns when the key is missing, with the setup steps", () => {
  const w = sessionWarning(false, null);
  assert.equal(w, MISSING_KEY_WARNING);
  assert.ok(w?.includes("sign.key") && w.includes("ssh-keygen"));
});

test("SessionStart is silent for a dummy (invalid-format) key", () => {
  assert.equal(
    warnFor((key) => {
      writeFileSync(key, "dummy-private-key\n");
      chmodSync(key, 0o600);
    }),
    null,
  );
});

test("SessionStart is silent when ssh-keygen cannot run", () => {
  assert.equal(sessionWarning(true, null), null);
});

test("SessionStart warns when the key is passphrase-encrypted", { skip: !hasKeygen }, () => {
  const w = warnFor((key) => genKey(key, "secret-pw"));
  assert.equal(w, UNUSABLE_KEY_WARNING);
  assert.ok(w?.includes("encrypted"));
});

test("SessionStart is silent for a valid unencrypted key", { skip: !hasKeygen }, () => {
  assert.equal(
    warnFor((key) => genKey(key, "")),
    null,
  );
});

test("SessionStart warns when an encrypted key also has loose permissions", { skip: !hasKeygen }, () => {
  const w = warnFor((key) => {
    genKey(key, "secret-pw");
    chmodSync(key, 0o644); // ssh-keygen reports 'bad permissions' before the decrypt step
  });
  assert.equal(w, UNUSABLE_KEY_WARNING);
});
