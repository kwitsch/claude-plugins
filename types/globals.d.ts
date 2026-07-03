// types/globals.d.ts — minimal Node.js global declarations.
// No @types/node installed; only globals actually used in plugins/**/*.mjs
// and test/**/*.mjs are declared here. Extend when new Node globals are introduced.

declare var process: {
  env: Record<string, string | undefined>;
  stdin: {
    on(event: "data", listener: (chunk: Buffer) => void): any;
    on(event: "end", listener: () => void): any;
    on(event: string, listener: (...args: any[]) => void): any;
  };
  stdout: { write(data: string): boolean };
  stderr: { write(data: string): boolean };
  exit(code?: number): never;
  execPath: string;
};

declare var console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
};

declare function setTimeout(fn: (...args: any[]) => void, ms?: number): any;
declare function clearTimeout(id: any): void;

declare class AbortController {
  readonly signal: { aborted: boolean };
  abort(): void;
}

declare class URL {
  constructor(url: string, base?: string | URL);
  readonly href: string;
  readonly pathname: string;
  readonly host: string;
  [key: string]: any;
}

declare class Buffer {
  static byteLength(str: string, encoding?: string): number;
  static alloc(size: number): Buffer;
  toString(encoding?: string): string;
  subarray(start?: number, end?: number): Buffer;
  length: number;
  [index: number]: number;
}

// Wildcard ambient declaration: types every `import { x } from 'node:*'` as `any`,
// resolving TS2307 "Cannot find module 'node:path'" etc. without @types/node.
declare module 'node:*';

interface ImportMeta {
  url: string;
}
