#!/usr/bin/env node
import{readFileSync as e}from"node:fs";import{resolve as t}from"node:path";import{lintFileHandler as n}from"../../hooks/lint-file.mjs";const r=process.argv[2];r||(console.error(`usage: lint-files.mjs <listfile>`),process.exit(2));const i=process.cwd(),a=e(r,`utf8`).split(`
`).map(e=>e.trim()).filter(e=>e.length>0);function o(e){return{session_id:`universal-lint-skill`,transcript_path:`/dev/null`,cwd:i,permission_mode:`default`,hook_event_name:`PostToolUse`,tool_name:`Write`,tool_input:{file_path:e},tool_response:{success:!0}}}const s=[];for(let e of a){let r=t(i,e);try{let e=n(o(r)).hookSpecificOutput?.additionalContext;typeof e==`string`&&e.length>0&&s.push(e)}catch{}}s.length===0?console.log(`universal-lint: no findings.`):(console.log(s.join(`

`)),console.log(`\nuniversal-lint: ${s.length} file(s) with findings.`)),process.exit(0);
