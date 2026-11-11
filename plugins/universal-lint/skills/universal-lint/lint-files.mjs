#!/usr/bin/env node
import{readFileSync as e}from"node:fs";import{resolve as t}from"node:path";import{lintFilesHandler as n}from"../../hooks/lint-file.mjs";const r=process.argv[2];r||(console.error(`usage: lint-files.mjs <listfile>`),process.exit(2));const i=process.cwd(),a=e(r,`utf8`).split(`
`).map(e=>e.trim()).filter(e=>e.length>0);let o;try{o=await n(i,a.map(e=>t(i,e)))}catch{o=[]}o.length===0?console.log(`universal-lint: no findings.`):(console.log(o.join(`

`)),console.log(`\nuniversal-lint: ${o.length} block(s) with findings.`)),process.exit(0);
