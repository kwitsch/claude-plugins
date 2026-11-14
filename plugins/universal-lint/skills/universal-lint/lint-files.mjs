#!/usr/bin/env node
import{readFileSync as e,realpathSync as t}from"node:fs";import{isAbsolute as n,join as r,relative as i,resolve as a,sep as o}from"node:path";import{lintFilesHandler as s}from"../../hooks/lint-file.mjs";const c=process.argv[2];c||(console.error(`usage: lint-files.mjs <listfile>`),process.exit(2));let l=process.cwd();try{let e=process.env.PWD;e&&n(e)&&t(e)===l&&(l=e)}catch{}const u=e(c,`utf8`).split(`
`).map(e=>e.replace(/\r$/,``)).filter(e=>e.trim().length>0),d=process.cwd();function f(e){let t=a(l,e),s=i(d,t);return l!==d&&s!==`..`&&!s.startsWith(`..`+o)&&!n(s)?r(l,s):t}let p;try{p=await s(l,u.map(f))}catch{p=[]}p.length===0?console.log(`universal-lint: no findings.`):(console.log(p.join(`

`)),console.log(`\nuniversal-lint: ${p.length} block(s) with findings.`)),process.exit(0);
