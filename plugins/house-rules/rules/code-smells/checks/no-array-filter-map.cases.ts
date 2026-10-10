import type { RuleCases } from '../../../src/engine/types.js';

const message = (first: string, second: string) =>
  `[no-array-filter-map] Avoid consecutive array \`${first}\` and \`${second}\` passes. Prefer \`.values().${first}(...).${second}(...).toArray()\` where iterator helpers are supported, or a single \`flatMap\`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.`;
const fm = (line: number) => ({ line, message: message('filter', 'map') });
const mf = (line: number) => ({ line, message: message('map', 'filter') });

export const cases: RuleCases = {
  valid: [
    { why: 'lazy iterator helpers via .values()', code: 'const users = []; users.values().filter(active).map(email).toArray();\n' },
    { why: 'lazy map then filter via .values()', code: 'const users = []; users.values().map(email).filter(Boolean).toArray();\n' },
    { why: 'Iterator.from pipeline', code: 'Iterator.from(users).filter(active).map(email).toArray();\n' },
    { why: 'IteratorObject-typed parameter', code: 'function collect(users: IteratorObject<User>) { return users.filter(active).map(email).toArray(); }\n' },
    { why: 'single flatMap', code: 'const users = []; users.flatMap(user => user.active ? [user.email] : []);\n' },
    { why: 'separate statements, not chained', code: 'const users = []; users.map(email); users.filter(active);\n' },
    { why: 'map then map', code: 'const users = []; users.map(email).map(normalize);\n' },
    { why: 'filter then filter', code: 'const users = []; users.filter(active).filter(verified);\n' },
    { why: 'custom object with filter/map methods', code: 'const custom = { filter() { return this; }, map() {} }; custom.filter(active).map(email);\n' },
    { why: 'unknown receiver parameter', code: 'function collect(unknownReceiver) { return unknownReceiver.filter(active).map(email); }\n' },
    { why: 'const initialised from a call, not known array', code: 'const users = fetchUsers(); users.filter(active).map(email);\n' },
    { why: 'inner parameter shadows outer array binding', code: 'const users = []; function collect(users) { return users.filter(active).map(email); }\n' },
    { why: 'let binding reassigned', code: 'let users = []; users = iterator; users.filter(active).map(email);\n' },
    { why: 'unreassigned let is not trusted as array', code: 'let users = []; users.filter(active).map(email);\n' },
    { why: 'annotated array reassigned elsewhere', code: 'let users: User[] = []; users = other; users.filter(active).map(email);\n' },
    { why: 'destructured binding is not known array', code: 'const { items } = obj; items.filter(f).map(g);\n' },
    { why: 'imported name is not known array', code: "import { items } from './x'; items.filter(f).map(g);\n" },
    { why: 'catch parameter is not known array', code: 'try { run(); } catch (items) { items.filter(f).map(g); }\n' },
    { why: 'for-of variable is not known array', code: 'for (const items of groups) { items.filter(f).map(g); }\n' },
    { why: 'dynamic method name', code: 'const users = []; users[method](active).map(email);\n' },
    { why: 'destructuring write disqualifies annotated let', code: 'let a: User[] = x;\n[a] = [y];\na.filter(g).map(h);\n' },
    { why: 'for-of write disqualifies annotated let', code: 'let a: User[] = x;\nfor (a of lists) {}\na.filter(g).map(h);\n' },
    { why: 'update write disqualifies annotated let', code: 'let a: User[] = x;\na++;\na.filter(g).map(h);\n' },
    { why: 'cyclic const bindings', code: 'const first = second; const second = first; first.filter(active).map(email);\n' },
    {
      why: 'filter.map on an unchanged base line is not flagged',
      base: '[].filter(active).map(email);\n',
      code: '[].filter(active).map(email);\nconst b = 1;\n',
    },
  ],
  invalid: [
    { why: 'array literal filter.map', code: '[].filter(active).map(email);\n', findings: [fm(1)] },
    { why: 'array literal map.filter', code: '[].map(user => user.active ? user.email : undefined).filter(email => email !== undefined);\n', findings: [mf(1)] },
    { why: 'const array map.filter', code: 'const users = []; users.map(email).filter(Boolean);\n', findings: [mf(1)] },
    { why: 'alias of const array', code: 'const users = []; const alias = users; alias.filter(active).map(email);\n', findings: [fm(1)] },
    { why: 'User[] annotation', code: 'function collect(users: User[]) { return users.filter(active).map(email); }\n', findings: [fm(1)] },
    { why: 'readonly User[] annotation', code: 'function collect(users: readonly User[]) { return users.map(email).filter(present); }\n', findings: [mf(1)] },
    { why: 'ReadonlyArray annotation', code: 'function collect(users: ReadonlyArray<User>) { return users.filter(active).map(email); }\n', findings: [fm(1)] },
    { why: 'Array<User> annotation', code: 'function collect(users: Array<User>) { return users.filter(active).map(email); }\n', findings: [fm(1)] },
    { why: 'computed string methods on `as const` array', code: "const users = [] as const; users['filter'](active)['map'](email);\n", findings: [fm(1)] },
    { why: 'non-null and parenthesised inner call', code: 'const users = []; (users.filter(active)!).map(email);\n', findings: [fm(1)] },
    { why: 'optional chaining', code: 'const users = []; users?.filter(active)?.map(email);\n', findings: [fm(1)] },
    { why: 'array-preserving slice before filter.map', code: 'const users = []; users.slice().filter(active).map(email);\n', findings: [fm(1)] },
    { why: 'filter.map.filter flags both adjacent pairs', code: 'const users = []; users.filter(active).map(email).filter(Boolean);\n', findings: [mf(1), fm(1)] },
    {
      why: 'multi-line chain is reported on the chain start row',
      code: 'const users = [];\nconst out = users\n  .filter(active)\n  .map(email);\n',
      findings: [fm(2)],
    },
    {
      why: 'only the added chain is flagged when base has other lines',
      base: 'const a = 1;\n',
      code: 'const a = 1;\n[].filter(active).map(email);\n',
      findings: [fm(2)],
    },
    { why: 'write to shadowing binding in nested function does not suppress', code: 'let a: User[] = [];\nfunction f(){ let a: number = 0; a = 1; }\na.filter(g).map(h);\n', findings: [fm(3)] },
    { why: 'fires on a .js file', filename: 'util.js', code: '[].filter(active).map(email);\n', findings: [fm(1)] },
  ],
};
