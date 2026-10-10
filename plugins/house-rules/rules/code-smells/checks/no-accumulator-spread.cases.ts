import type { RuleCases } from '../../../src/engine/types.js';

const MESSAGE =
  "[no-accumulator-spread] Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.";
const finding = (line: number) => ({ line, message: MESSAGE });

// Spreads inside a nested function are skipped: only the reduce callback's own body counts.
export const cases: RuleCases = {
  valid: [
    { why: "items.reduce((acc, x) => ({ ...x, k: 1 }), {});", code: "items.reduce((acc, x) => ({ ...x, k: 1 }), {});\n" },
    { why: "const copy = { ...acc, k: 1 };", code: "const copy = { ...acc, k: 1 };\n" },
    { why: "function f(acc) { return [...acc, 1]; }", code: "function f(acc) { return [...acc, 1]; }\n" },
    { why: "items.reduce((acc, x) => { const snap = (acc) => [...acc, x]; acc.push(x); return acc; }, []);", code: "items.reduce((acc, x) => { const snap = (acc) => [...acc, x]; acc.push(x); return acc; }, []);\n" },
    { why: "items.reduce((acc, x) => { { const acc = []; use([...acc]); } return acc; }, []);", code: "items.reduce((acc, x) => { { const acc = []; use([...acc]); } return acc; }, []);\n" },
    { why: "items.reduce((acc, x) => { acc.push(x); return acc; }, []);", code: "items.reduce((acc, x) => { acc.push(x); return acc; }, []);\n" },
    { why: "items.reduce((acc, x) => Object.assign(acc, x), {});", code: "items.reduce((acc, x) => Object.assign(acc, x), {});\n" },
    { why: "items.map((acc, x) => ({ ...acc, k: x }));", code: "items.map((acc, x) => ({ ...acc, k: x }));\n" },
    { why: "items.reduce((acc, x) => { const later = () => ({ ...acc }); return acc; }, {});", code: "items.reduce((acc, x) => { const later = () => ({ ...acc }); return acc; }, {});\n" },
    { why: "items.reduce((acc, x) => { use(...acc); return acc; }, []);", code: "items.reduce((acc, x) => { use(...acc); return acc; }, []);\n" },
    { why: 'unchanged base line is not flagged', base: "items.reduce((acc, x) => [...acc, x], []);\n", code: "items.reduce((acc, x) => [...acc, x], []);\nconst b = 1;\n" },
  ],
  invalid: [
    { why: "items.reduce((acc, x) => ({...acc, [x.id]: x}), {});", code: "items.reduce((acc, x) => ({...acc, [x.id]: x}), {});\n", findings: [finding(1)] },
    { why: "items.reduce((acc, x) => [...acc, x], []);", code: "items.reduce((acc, x) => [...acc, x], []);\n", findings: [finding(1)] },
    { why: "items.reduce((acc, x) => { return {...acc, k: x}; }, {});", code: "items.reduce((acc, x) => { return {...acc, k: x}; }, {});\n", findings: [finding(1)] },
    { why: "items.reduce(function (acc, x) { return [...acc, x]; }, []);", code: "items.reduce(function (acc, x) { return [...acc, x]; }, []);\n", findings: [finding(1)] },
    { why: "items.reduceRight((acc, x) => [...acc, x], []);", code: "items.reduceRight((acc, x) => [...acc, x], []);\n", findings: [finding(1)] },
    { why: "items?.reduce((acc, x) => ({ ...acc, k: x }), {});", code: "items?.reduce((acc, x) => ({ ...acc, k: x }), {});\n", findings: [finding(1)] },
    { why: "items.reduce((acc, x) => ({ ...(acc as State), k: x }), {});", code: "items.reduce((acc, x) => ({ ...(acc as State), k: x }), {});\n", findings: [finding(1)] },
    { why: 'fires on a .js file', filename: 'util.js', code: "items.reduce((acc, x) => [...acc, x], []);\n", findings: [finding(1)] },
  ],
};
