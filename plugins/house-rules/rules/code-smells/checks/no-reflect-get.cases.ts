import type { RuleCases } from '../../../src/engine/types.js';

const MESSAGE = '[no-reflect-get] Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.';
const finding = (line: number) => ({ line, message: MESSAGE });

export const cases: RuleCases = {
  valid: [
    { why: 'plain property access', code: 'const value = owner.property;\n' },
    { why: 'computed property access', code: 'const value = owner[key];\n' },
    { why: 'other Reflect method', code: 'Reflect.set(owner, key, value);\n' },
    { why: 'get on another receiver', code: 'const value = map.get(key);\n' },
    { why: 'locally declared Reflect shadows the global', code: 'const Reflect = { get() { return 1; } }; Reflect.get();\n' },
    { why: 'parameter named Reflect shadows the global', code: 'function read(Reflect: { get(): number }) { return Reflect.get(); }\n' },
    {
      why: 'Reflect.get on an unchanged base line is not flagged',
      base: 'const a = Reflect.get(owner, key);\n',
      code: 'const a = Reflect.get(owner, key);\nconst b = 1;\n',
    },
  ],
  invalid: [
    { why: 'Reflect.get call', code: 'const value = Reflect.get(owner, key);\n', findings: [finding(1)] },
    { why: 'computed string member Reflect[\'get\']', code: "const value = Reflect['get'](owner, key);\n", findings: [finding(1)] },
    { why: 'optional-chained Reflect?.get', code: 'const value = Reflect?.get(owner, key);\n', findings: [finding(1)] },
    { why: 'optional call Reflect.get?.()', code: 'const value = Reflect.get?.(owner, key);\n', findings: [finding(1)] },
    {
      why: 'only the added Reflect.get line is flagged when base has other lines',
      base: 'const a = 1;\n',
      code: 'const a = 1;\nconst b = Reflect.get(owner, key);\n',
      findings: [finding(2)],
    },
    { why: 'fires on a .js file', filename: 'util.js', code: 'const value = Reflect.get(owner, key);\n', findings: [finding(1)] },
  ],
};

// Other checks' case keys this check also fires on.
export const foreignHits: readonly string[] = [
  '[no-reflect-apply] other Reflect method',
];
