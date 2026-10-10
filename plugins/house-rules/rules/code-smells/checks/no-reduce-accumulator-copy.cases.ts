import type { RuleCases } from '../../../src/engine/types.js';

const MESSAGE =
  '[no-reduce-accumulator-copy] Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.';
const finding = (line: number) => ({ line, message: MESSAGE });

// Upstream scope-manager cases are ported on the CST (name lookup per enclosing scope). Spread forms are valid: owned by a separate accumulating-spread rule.
export const cases: RuleCases = {
  valid: [
    { why: "items.reduce((acc, item) => { acc.push(item); return acc; }, []);", code: "items.reduce((acc, item) => { acc.push(item); return acc; }, []);\n" },
    { why: "items.reduce((acc, item) => Object.assign(acc, item), {});", code: "items.reduce((acc, item) => Object.assign(acc, item), {});\n" },
    { why: "items.reduce((acc, item) => Object.assign(acc, acc, item), {});", code: "items.reduce((acc, item) => Object.assign(acc, acc, item), {});\n" },
    { why: "items.reduce((acc, item) => { acc[item.id] = { ...item }; return acc; }, {});", code: "items.reduce((acc, item) => { acc[item.id] = { ...item }; return acc; }, {});\n" },
    { why: "items.reduce((acc, item) => { acc.push(Object.assign({}, item)); return acc; }, []);", code: "items.reduce((acc, item) => { acc.push(Object.assign({}, item)); return acc; }, []);\n" },
    { why: "items.reduce((acc, item) => { acc.push(item.slice()); return acc; }, []);", code: "items.reduce((acc, item) => { acc.push(item.slice()); return acc; }, []);\n" },
    { why: "items.reduce((acc, item) => acc.concat(item), '');", code: "items.reduce((acc, item) => acc.concat(item), '');\n" },
    { why: "items.reduce((acc, item) => acc.concat(item), customCollection);", code: "items.reduce((acc, item) => acc.concat(item), customCollection);\n" },
    { why: "function copy(acc) { return Object.assign({}, acc); }", code: "function copy(acc) { return Object.assign({}, acc); }\n" },
    { why: "items.map((acc, item) => Object.assign({}, acc));", code: "items.map((acc, item) => Object.assign({}, acc));\n" },
    { why: "items.reduce((acc, item) => { function copy(acc) { return Object.assign({}, acc); } return acc; }, {});", code: "items.reduce((acc, item) => { function copy(acc) { return Object.assign({}, acc); } return acc; }, {});\n" },
    { why: "items.reduce((acc, item) => { const snapshot = () => Object.assign({}, acc); return acc; }, {});", code: "items.reduce((acc, item) => { const snapshot = () => Object.assign({}, acc); return acc; }, {});\n" },
    { why: "items.reduce((acc, item) => { { const acc = {}; Object.assign({}, acc); } return acc; }, {});", code: "items.reduce((acc, item) => { { const acc = {}; Object.assign({}, acc); } return acc; }, {});\n" },
    { why: "const Object = custom; items.reduce((acc, item) => Object.assign({}, acc), {});", code: "const Object = custom; items.reduce((acc, item) => Object.assign({}, acc), {});\n" },
    { why: "function run(Object) { return items.reduce((acc, item) => Object.assign({}, acc), {}); }", code: "function run(Object) { return items.reduce((acc, item) => Object.assign({}, acc), {}); }\n" },
    { why: "const Array = custom; items.reduce((acc, item) => Array.from(acc), []);", code: "const Array = custom; items.reduce((acc, item) => Array.from(acc), []);\n" },
    { why: "items.reduce((acc, item) => { let alias = acc; alias = item; return Object.assign({}, alias); }, {});", code: "items.reduce((acc, item) => { let alias = acc; alias = item; return Object.assign({}, alias); }, {});\n" },
    { why: "items.reduce((acc, item) => [...acc, item], []);", code: "items.reduce((acc, item) => [...acc, item], []);\n" },
    { why: "items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});", code: "items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});\n" },
    { why: 'unchanged base line is not flagged', base: "items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});\n", code: "items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});\nconst b = 1;\n" },
    { why: "let initial = []; initial = x; items.reduce((acc, i) => acc.concat(i), initial);", code: "let initial = []; initial = x;\nitems.reduce((acc, i) => acc.concat(i), initial);\n" },
  ],
  invalid: [
    { why: "items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});", code: "items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});\n", findings: [finding(1)] },
    { why: "items.reduceRight((acc, item) => Object.assign({}, acc, item), {});", code: "items.reduceRight((acc, item) => Object.assign({}, acc, item), {});\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item, index, array) => Object.assign({}, acc, item), {});", code: "items.reduce((acc, item, index, array) => Object.assign({}, acc, item), {});\n", findings: [finding(1)] },
    { why: "items.reduce(acc => Object.assign({}, acc), {});", code: "items.reduce(acc => Object.assign({}, acc), {});\n", findings: [finding(1)] },
    { why: "items.reduce(function (acc, item) { return Object.assign({}, item, acc); }, {});", code: "items.reduce(function (acc, item) { return Object.assign({}, item, acc); }, {});\n", findings: [finding(1)] },
    { why: "items['reduce'](((acc, item) => Object['assign']({}, acc, item)), {});", code: "items['reduce'](((acc, item) => Object['assign']({}, acc, item)), {});\n", findings: [finding(1)] },
    { why: "items.reduce((acc = {}, item) => Object.assign({}, acc, item), {});", code: "items.reduce((acc = {}, item) => Object.assign({}, acc, item), {});\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => { const alias = acc; return Object.assign({}, alias, item); }, {});", code: "items.reduce((acc, item) => { const alias = acc; return Object.assign({}, alias, item); }, {});\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => Object.assign({}, acc as State, item), {});", code: "items.reduce((acc, item) => Object.assign({}, acc as State, item), {});\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => { const next = Object.assign({}, acc); next[item.id] = item; return next; }, {});", code: "items.reduce((acc, item) => { const next = Object.assign({}, acc); next[item.id] = item; return next; }, {});\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => acc.concat([item]), []);", code: "items.reduce((acc, item) => acc.concat([item]), []);\n", findings: [finding(1)] },
    { why: "items.reduceRight((acc, item, index) => acc['concat']([item]), [] as Item[]);", code: "items.reduceRight((acc, item, index) => acc['concat']([item]), [] as Item[]);\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => { const next = acc.slice(); next.push(item); return next; }, []);", code: "items.reduce((acc, item) => { const next = acc.slice(); next.push(item); return next; }, []);\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => { const alias = acc; return alias.concat(item); }, []);", code: "items.reduce((acc, item) => { const alias = acc; return alias.concat(item); }, []);\n", findings: [finding(1)] },
    { why: "const initial = []; items.reduce((acc, item) => acc.concat(item), initial);", code: "const initial = []; items.reduce((acc, item) => acc.concat(item), initial);\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => { const next = Array.from(acc); next.push(item); return next; }, []);", code: "items.reduce((acc, item) => { const next = Array.from(acc); next.push(item); return next; }, []);\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => acc.toSpliced(acc.length, 0, item), []);", code: "items.reduce((acc, item) => acc.toSpliced(acc.length, 0, item), []);\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => acc.toSorted(), []);", code: "items.reduce((acc, item) => acc.toSorted(), []);\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => acc.toReversed(), []);", code: "items.reduce((acc, item) => acc.toReversed(), []);\n", findings: [finding(1)] },
    { why: "items.reduce((acc, item) => acc.with(0, item), []);", code: "items.reduce((acc, item) => acc.with(0, item), []);\n", findings: [finding(1)] },
    { why: 'fires on a .js file', filename: 'util.js', code: "items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});\n", findings: [finding(1)] },
    { why: "function f(initial: Item[]) { return items.reduce((acc, i) => acc.concat(i), initial); }", code: "function f(initial: Item[]) { return items.reduce((acc, i) => acc.concat(i), initial); }\n", findings: [finding(1)] },
    { why: "let initial: Item[] = []; items.reduce((acc, i) => acc.concat(i), initial);", code: "let initial: Item[] = [];\nitems.reduce((acc, i) => acc.concat(i), initial);\n", findings: [finding(2)] },
  ],
};
