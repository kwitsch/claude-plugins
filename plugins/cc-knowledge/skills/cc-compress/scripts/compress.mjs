#!/usr/bin/env node
import{execFileSync as e}from"node:child_process";import{createHash as t}from"node:crypto";import{existsSync as n,mkdirSync as r,readFileSync as i,statSync as a,unlinkSync as o,writeFileSync as s}from"node:fs";import{basename as c,dirname as l,extname as u,resolve as d,sep as f}from"node:path";const p=/^(---\r?\n.*?\r?\n---\r?\n)(.*)$/s,m=/^\s*(`{3,}|~{3,})[^\n]*\n(.*)\n\1\s*$/s;function h(e){let t=e.match(p);return t?{frontmatter:t[1],body:t[2]}:{frontmatter:``,body:e}}function g(e){let t=e.match(m);return t?t[2]:e}const _=/^(\.env(\..+)?|\.netrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|authorized_keys|known_hosts|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc|gpg))$/i,v=new Set([`.ssh`,`.aws`,`.gnupg`,`.kube`,`.docker`]),y=[`secret`,`credential`,`password`,`passwd`,`apikey`,`accesskey`,`token`,`privatekey`];function b(e){let t=c(e);if(_.test(t)||e.split(f).map(e=>e.toLowerCase()).some(e=>v.has(e)))return!0;let n=t.toLowerCase().replace(/[_\-\s.]/g,``);return y.some(e=>n.includes(e))}function x(e){return!c(e).toLowerCase().endsWith(`.original.md`)&&u(e).toLowerCase()===`.md`}function S(t){let n=l(t);try{e(`git`,[`-C`,n,`ls-files`,`--error-unmatch`,`--`,t],{stdio:`ignore`})}catch{return!1}let r;try{r=e(`git`,[`-C`,n,`status`,`--porcelain`,`--`,t],{encoding:`utf8`})}catch{return!1}return r.trim()===``}function C(e,n){let r=l(e),i=c(r),a=t(`sha256`).update(r).digest(`hex`).slice(0,8),o=c(e,u(e));return d(n,`${i}-${a}`,`${o}.original.md`)}function w(t){return g(e(`claude`,[`--print`,`--model`,`sonnet`],{input:t,encoding:`utf8`,maxBuffer:10485760,timeout:12e4}).trim())}function T(e){return`Compress this markdown into caveman format.

STRICT RULES:
- Do NOT modify anything inside \`\`\` code blocks
- Do NOT modify anything inside inline backticks
- Preserve ALL URLs exactly
- Preserve ALL headings exactly
- Preserve file paths and commands
- Return ONLY the compressed markdown body — do NOT wrap the entire output in a \`\`\`markdown fence or any other fence. Inner code blocks from the original stay as-is; do not add a new outer fence around the whole file.

Only compress natural language.

TEXT:
${e}
`}function E(e,t,n){return`You are fixing a caveman-compressed markdown file. Specific validation errors were found.

CRITICAL RULES:
- DO NOT recompress or rephrase the file
- ONLY fix the listed errors — leave everything else exactly as-is
- The ORIGINAL is provided as reference only (to restore missing content)
- Preserve caveman style in all untouched sections

ERRORS TO FIX:
${n.map(e=>`- ${e}`).join(`
`)}

HOW TO FIX:
- Missing URL: find it in ORIGINAL, restore it exactly where it belongs in COMPRESSED
- Code block mismatch: find the exact code block in ORIGINAL, restore it in COMPRESSED
- Heading mismatch: restore the exact heading text from ORIGINAL into COMPRESSED
- Do not touch any section not mentioned in the errors

ORIGINAL (reference only):
${e}

COMPRESSED (fix this):
${t}

Return ONLY the fixed compressed file. No explanation.
`}const D=/https?:\/\/[^\s)]+(?<![.,;:!?)"'\]])/g,O=/^(\s{0,3})(`{3,}|~{3,})(.*)$/,k=/^(#{1,6})\s+(.*)/gm,A=/^\s*[-*+]\s+/gm,j=/(?:\.\/|\.\.\/|\/|[A-Za-z]:\\)[\w\-/\\.]+|[\w\-.]+[/\\][\w\-/\\.]+/g;function M(e){return[...e.matchAll(k)].map(e=>[e[1],e[2].trim()])}function N(e){let t=[],n=e.split(`
`),r=0;for(;r<n.length;){let e=n[r].match(O);if(!e){r++;continue}let i=e[2][0],a=e[2].length,o=[n[r]];r++;let s=!1;for(;r<n.length;){let e=n[r].match(O);if(e&&e[2][0]===i&&e[2].length>=a&&e[3].trim()===``){o.push(n[r]),s=!0,r++;break}o.push(n[r]),r++}s&&t.push(o.join(`
`))}return t}function P(e){return new Set(e.match(D)??[])}function F(e){return new Set(e.match(j)??[])}function I(e){return[...e.matchAll(A)].length}function L(e,t){let n=e;for(let e of t)n=n.split(e).join(``);return[...n.matchAll(/`([^`]+)`/g)].map(e=>e[1])}function R(e,t){return e.length===t.length&&e.every((e,n)=>e[0]===t[n][0]&&e[1]===t[n][1])}function z(e,t){return e.length===t.length&&e.every((e,n)=>e===t[n])}function B(e,t){let n=[],r=[],i=M(e),a=M(t);i.length!==a.length&&n.push(`Heading count mismatch: ${i.length} vs ${a.length}`),R(i,a)||r.push(`Heading text/order changed`);let o=N(e),s=N(t);z(o,s)||n.push(`Code blocks not preserved exactly`);let c=P(e),l=P(t);if(c.size!==l.size||[...c].some(e=>!l.has(e))){let e=[...c].filter(e=>!l.has(e)),t=[...l].filter(e=>!c.has(e));n.push(`URL mismatch: lost=${JSON.stringify(e)}, added=${JSON.stringify(t)}`)}let u=F(e),d=F(t);if(u.size!==d.size||[...u].some(e=>!d.has(e))){let e=[...u].filter(e=>!d.has(e)),t=[...d].filter(e=>!u.has(e));r.push(`Path mismatch: lost=${JSON.stringify(e)}, added=${JSON.stringify(t)}`)}let f=I(e),p=I(t);f>0&&Math.abs(f-p)/f>.15&&r.push(`Bullet count changed too much: ${f} -> ${p}`);let m=L(e,o),h=L(t,s),g=new Map;for(let e of m)g.set(e,(g.get(e)??0)+1);let _=new Map;for(let e of h)_.set(e,(_.get(e)??0)+1);if(!(g.size===_.size&&[...g.entries()].every(([e,t])=>_.get(e)===t))){let e=[];for(let[t,n]of g.entries()){let r=_.get(t);r===void 0?e.push(t):r<n&&e.push(`${t} (lost ${n-r} of ${n} occurrences)`)}let t=[..._.keys()].filter(e=>!g.has(e));e.length&&n.push(`Inline code lost: ${JSON.stringify(e)}`),t.length&&r.push(`Inline code added: ${JSON.stringify(t)}`)}return{isValid:n.length===0,errors:n,warnings:r}}function V(e,t,c){e=d(e);let u;try{u=a(e)}catch{return console.log(`File not found: ${e}`),1}if(!u.isFile())return console.log(`File not found: ${e}`),1;if(u.size>5e5)return console.log(`File too large to compress safely (max 500KB): ${e}`),1;if(b(e))return console.log(`Refusing to compress ${e}: filename looks sensitive (credentials, keys, secrets, or known private paths). Compression sends file contents to the Anthropic API. Rename the file if this is a false positive.`),1;if(!x(e))return console.log(`Skipping: not a markdown file`),0;if(!c&&!S(e))return console.log(`Not git-recoverable: ${e} is untracked or has uncommitted changes.`),console.log(`The session-temp backup would be the only rollback path if compression proceeds.`),console.log(`Re-run with --confirmed to proceed anyway.`),3;console.log(`Processing: ${e}`);let f=i(e,`utf8`);if(!f.trim())return console.log(`Refusing to compress: file is empty or whitespace-only.`),1;let p=C(e,t);if(n(p))return console.log(`Backup file already exists: ${p}`),console.log(`The original backup may contain important content.`),console.log(`Aborting to prevent data loss. Remove or rename the backup file to proceed.`),1;let{frontmatter:m,body:g}=h(f);if(m&&console.log(`Detected YAML frontmatter (${m.length} chars) — preserving verbatim`),!g.trim())return console.log(`Refusing to compress: body is empty after frontmatter removal.`),1;console.log(`Compressing with claude --print...`);let _;try{_=w(T(g))}catch(e){let t=e;return t.code===`ENOENT`?console.log(`claude CLI not found on PATH. Original file is untouched.`):console.log(`claude --print failed: ${t.stderr||t.message}`),1}if(!_||!_.trim())return console.log(`Compression aborted: claude returned an empty response.`),console.log(`Original file is untouched (no backup created).`),1;if(_.trim()===g.trim())return console.log(`Compression aborted: output is identical to input.`),console.log(`Original file is untouched (no backup created).`),1;let v=m+_,y=1,D=B(f,v);for(console.log(`Validation attempt ${y}`);!D.isValid&&y<2;){console.log(`Validation failed:`);for(let e of D.errors)console.log(`   - ${e}`);console.log(`Fixing with claude --print...`);let e;try{e=w(E(f,v,D.errors))}catch(e){let t=e;return console.log(`claude --print failed during fix: ${t.stderr||t.message}`),console.log(`Original file is untouched (no backup created).`),2}v=m+h(e).body,y++,console.log(`Validation attempt ${y}`),D=B(f,v)}if(!D.isValid){console.log(`Validation failed:`);for(let e of D.errors)console.log(`   - ${e}`);return console.log(`Failed after retries — original untouched (no backup created)`),2}if(console.log(`Validation passed`),D.warnings.length){console.log(`Warnings (non-blocking):`);for(let e of D.warnings)console.log(`   - ${e}`)}let O=f.endsWith(`
`)&&!v.endsWith(`
`)?v+`
`:v;r(l(p),{recursive:!0});try{s(p,f,{flag:`wx`})}catch(e){if(e.code===`EEXIST`)return console.log(`Backup file already exists: ${p}`),console.log(`Another compression of this file may be running concurrently.`),console.log(`Aborting to prevent data loss.`),1;throw e}if(i(p,`utf8`)!==f){console.log(`Backup write verification failed: ${p}`),console.log(`In-memory original differs from on-disk backup. Aborting before touching the input file.`);try{o(p)}catch{}return 1}return s(e,O),console.log(`Compressed: ${e}`),console.log(`Original:   ${p}`),0}function H(){let e=process.argv.slice(2),t=e.includes(`--confirmed`),[n,r]=e.filter(e=>e!==`--confirmed`);n&&r||(console.log(`Usage: compress.mjs <filepath> <backup-root-dir> [--confirmed]`),process.exit(1));try{process.exit(V(n,r,t))}catch(e){console.log(`Error: ${e.message}`),process.exit(1)}}H();
