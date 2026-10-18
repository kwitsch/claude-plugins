#!/usr/bin/env node
// Pure logic for the git-sign-key mods module (register.ts): the quote-aware
// `git commit` rewrite and the SessionStart warning texts. Zero-dep, no `$`.

/**
 * Path of the signing key under a home directory (`$HOME`, possibly unset).
 * @param {string | undefined} home
 * @returns {string}
 */
export const keyPath = (home) => `${home ?? ""}/.claude/sign.key`;

/**
 * The signing config injected right after the `git` token of each commit.
 * gpg.ssh.program=ssh-keygen forces the built-in signer, so a custom signer
 * (1Password op-ssh-sign, ...) never receives an on-disk key path it cannot read.
 * The path is single-quoted so spaces survive word-splitting.
 * @param {string} keyFile
 * @returns {string}
 */
export const signFlags = (keyFile) => `-c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c user.signingkey='${keyFile}' -c commit.gpgsign=true`;

/**
 * The additionalContext the model reads after a rewritten call.
 * @param {string} keyFile
 * @returns {string}
 */
export const rewriteNote = (keyFile) => `git-sign-key: routed commit signing through ${keyFile} (file-based SSH signing via ssh-keygen; ssh-agent and any custom gpg.ssh.program bypassed).`;

const CMD_START = new Set([";", "&", "|", "(", "{", "`", "\n"]);
const COMMIT_END = new Set([" ", "\t", "\n", ";", "&", "|", ")", "}", "`", "<", ">"]);
const TOKEN_END = new Set([" ", "\t", ";", "&", "|", "(", "{", "`", "\n", "<", ">"]);
const ASSIGN = /[A-Za-z_][A-Za-z0-9_]*=/y;

/**
 * Index just past the blanks (space/tab) starting at `j`.
 * @param {string} s
 * @param {number} j
 * @returns {number}
 */
function skipBlanks(s, j) {
  while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
  return j;
}

/**
 * Index just past the non-whitespace word starting at `j`.
 * @param {string} s
 * @param {number} j
 * @returns {number}
 */
function wordEnd(s, j) {
  while (j < s.length && s[j] !== " " && s[j] !== "\t" && s[j] !== "\n") j++;
  return j;
}

/**
 * Walks from just after a `git` token over global options (-C <path> / -c k=v
 * consume a value; --long[=v] does not) to the subcommand.
 * @param {string} s
 * @param {number} j
 * @param {string} marker our own signing-key flag, for idempotency
 * @returns {{ commit: boolean, already: boolean }}
 */
function commitInvocation(s, j, marker) {
  let already = false;
  const no = { commit: false, already };
  while (j < s.length) {
    j = skipBlanks(s, j);
    if (j >= s.length || s[j] === "\n") return no;
    if (s.startsWith("commit", j)) {
      const after = s[j + 6];
      return { commit: after === undefined || COMMIT_END.has(after), already };
    }
    if (s[j] !== "-") return no;
    let k = wordEnd(s, j);
    const tok = s.slice(j, k);
    // bare '-' / '--' are not global options that introduce a subcommand
    if (tok === "-" || tok === "--") return no;
    if (tok.includes(marker)) already = true;
    j = k;
    if (tok === "-c" || tok === "-C") {
      j = skipBlanks(s, j);
      k = wordEnd(s, j);
      if (s.slice(j, k).includes(marker)) already = true;
      j = k;
    }
  }
  return no;
}

/**
 * Index just past one quote-aware shell word starting at `i` (steps over a
 * `NAME=value` assignment prefix whose value may be quoted).
 * @param {string} s
 * @param {number} i
 * @returns {number}
 */
function skipToken(s, i) {
  /** @type {"none" | "single" | "double"} */
  let q = "none";
  let esc = false;
  for (; i < s.length; i++) {
    const c = s[i];
    if (q === "single") {
      if (c === "'") q = "none";
    } else if (q === "double") {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') q = "none";
    } else if (esc) esc = false;
    else if (c === "'") q = "single";
    else if (c === '"') q = "double";
    else if (c === "\\") esc = true;
    else if (TOKEN_END.has(c)) break;
  }
  return i;
}

/**
 * Inserts the signing flags after the `git` token of every commit invocation at
 * an UNQUOTED command position (quote/backslash state tracked, so a separator
 * inside a quoted argument is never a command position). A commit that already
 * carries our signing-key flag is left as is.
 * @param {string} command the Bash command
 * @param {string} keyFile absolute key path
 * @returns {string} the rewritten command (=== command when nothing changed)
 */
export function rewriteCommand(command, keyFile) {
  const s = command;
  const flags = signFlags(keyFile);
  const marker = `user.signingkey='${keyFile}'`;
  let out = "";
  let start = 0;
  /** @type {"none" | "single" | "double"} */
  let q = "none";
  let esc = false;
  let cmdPos = true;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (q === "single") {
      if (c === "'") q = "none";
      i++;
      continue;
    }
    if (q === "double") {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') q = "none";
      i++;
      continue;
    }
    if (esc) {
      esc = false;
      cmdPos = false;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "\\") {
      if (c === "'") q = "single";
      else if (c === '"') q = "double";
      else esc = true;
      cmdPos = false;
      i++;
      continue;
    }
    if (c === " " || c === "\t") {
      i++; // blanks keep cmdPos so `sep   git` matches
      continue;
    }
    if (CMD_START.has(c)) {
      cmdPos = true;
      i++;
      continue;
    }
    if (cmdPos) {
      // An env-var assignment prefix keeps the following word at a command position.
      ASSIGN.lastIndex = i;
      if (ASSIGN.test(s)) {
        i = skipToken(s, i);
        continue;
      }
      // rtk (linux-token-efficiency's proxy) is a transparent wrapper: `rtk git commit` is still a commit.
      if (s.startsWith("rtk", i) && (s[i + 3] === " " || s[i + 3] === "\t")) {
        i += 3;
        continue;
      }
      if (s.startsWith("git", i) && (s[i + 3] === " " || s[i + 3] === "\t")) {
        const inv = commitInvocation(s, i + 3, marker);
        if (inv.commit) {
          if (!inv.already) {
            out += `${s.slice(start, i + 3)} ${flags}`;
            start = i + 3;
          }
          i += 3;
          cmdPos = false;
          continue;
        }
      }
    }
    cmdPos = false;
    i++;
  }
  return out + s.slice(start);
}

export const MISSING_KEY_WARNING =
  "⚠️ git-sign-key: no signing key found at ~/.claude/sign.key. Git commits will NOT be rewritten for file-based SSH signing — " +
  "they fall back to your normal git/ssh-agent setup. Surface this to the user and explain how to enable it: " +
  '1) ssh-keygen -t ed25519 -C "your_email" -f ~/.claude/sign.key -N ""   2) chmod 600 ~/.claude/sign.key   ' +
  "3) add ~/.claude/sign.key.pub to your Git host as a SIGNING key (GitHub: Settings -> SSH and GPG keys -> New SSH key -> Key type: Signing Key). " +
  "See the git-sign-key plugin README for full setup and signature verification.";

export const UNUSABLE_KEY_WARNING =
  "⚠️ git-sign-key: ~/.claude/sign.key cannot be used for non-interactive signing — " +
  "it is either passphrase-encrypted or has unsafe file permissions. File-based SSH signing bypasses the ssh-agent, so every git commit will FAIL (the hook forces commit.gpgsign=true). " +
  'Make sure the key is unencrypted (ssh-keygen -p -f ~/.claude/sign.key -N "", understand the security tradeoff) ' +
  "and locked down (chmod 600 ~/.claude/sign.key). See the git-sign-key plugin README.";

/**
 * argv that probes whether the key signs non-interactively (empty passphrase).
 * @param {string} keyFile
 * @returns {string[]}
 */
export const probeArgv = (keyFile) => ["ssh-keygen", "-y", "-f", keyFile, "-P", ""];

/**
 * The SessionStart warning, or null when silent. Warns only on positive
 * ssh-keygen stderr signals, so a dummy/invalid key file stays silent.
 * @param {boolean} keyIsFile whether ~/.claude/sign.key is a regular file
 * @param {string | null} probeStderr ssh-keygen's stderr, null when it could not run
 * @returns {string | null}
 */
export function sessionWarning(keyIsFile, probeStderr) {
  if (!keyIsFile) return MISSING_KEY_WARNING;
  if (probeStderr !== null && /passphrase|decrypt|ermission|too open/.test(probeStderr)) return UNUSABLE_KEY_WARNING;
  return null;
}
