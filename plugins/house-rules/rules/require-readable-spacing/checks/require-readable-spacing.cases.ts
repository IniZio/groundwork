import type { RuleCases } from '../../../src/engine/types.js';
import { MESSAGE } from './require-readable-spacing.js';

const message = `[require-readable-spacing] ${MESSAGE}`;
const at = (...lines: number[]) => lines.map((line) => ({ line, message }));

export const cases: RuleCases = {
  valid: [
    { why: 'imports then blank line before export', code: "import { a } from 'a';\nimport { b } from 'b';\n\nexport const c = a + b;" },
    { why: 'const run then blank line before return', code: "function f() {\nconst a = 1;\nconst b = 2;\n\nreturn a + b;\n}" },
    { why: 'single-statement function body', code: "function f() { return 1; }" },
    { why: 'overload signatures adjacent', code: "function f(a: string): string;\nfunction f(a: number): number;\nfunction f(a: string | number) { return a; }" },
    { why: 'exported overload signatures adjacent', code: "export function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: string | number) { return a; }" },
    { why: 'Effect.gen const run then blank before return', code: "const f = Effect.gen(function* () {\nconst a = yield* A;\nconst b = yield* B;\n\nreturn a + b;\n});" },
    { why: 'doc comment after blank line', code: "export type A = string;\n\n/** B documentation. */\nexport type B = number;" },
    { why: 'single-line if/else block', code: "function f() { if (ok) { go(); } else { stop(); } }" },
    { why: 'leading comment only before sole return', code: "function f() {\n// return docs\nreturn 1;\n}" },
    { why: 'multiple blank lines accepted', code: "const a = 1;\n\n\nconst b = 2;" },
    { why: 'switch case fallthrough single line', code: "switch (x) { case 1: case 2: go(); break; default: stop(); }" },
  ],
  invalid: [
    { why: 'adjacent consts', code: "const a = 1;\nconst b = 2;", findings: at(2) },
    { why: 'doc comment attached to next export without blank', code: "export const a = 1;\n/** B docs. */\nexport type B = number;", findings: at(3) },
    { why: 'trailing comment then leading comment', code: "const a = 1; // trailing\n// leading\nconst b = 2;", findings: at(3) },
    { why: 'two statements on one line', code: "const a = 1; const b = 2;", findings: at(1) },
    { why: 'import directly followed by const', code: "import { a } from 'a';\nconst b = a;", findings: at(2) },
    { why: 'const then return in function', code: "function f() {\nconst a = 1;\nreturn a;\n}", findings: at(3) },
    { why: 'const then if without braces', code: "function f() {\nconst a = 1;\nif (a) go();\n}", findings: at(3) },
    { why: 'block statement then expression', code: "function f() {\nif (ok) { go(); }\nstop();\n}", findings: at(3) },
    { why: 'Effect.gen with two violations', code: "const f = Effect.gen(function* () {\nconst a = yield* A;\nconst b = yield* B;\nconst dispatch = Effect.fn('dispatch')(function* () {\nyield* a;\n});\nreturn dispatch;\n});", findings: at(4, 7) },
    { why: 'interface then class', code: "export interface A {}\nexport class B {}", findings: at(2) },
    { why: 'leading semicolon ASI statement', code: "const a = 1\n;[1].forEach(f)", findings: at(2) },
    { why: 'expression then while', code: "function f() {\nfoo();\nwhile (ok) go();\n}", findings: at(3) },
  ],
};
