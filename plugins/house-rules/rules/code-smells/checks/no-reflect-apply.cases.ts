import type { RuleCases } from '../../../src/engine/types.js';

const MESSAGE = '[no-reflect-apply] Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.';
const finding = (line: number) => ({ line, message: MESSAGE });

export const cases: RuleCases = {
  valid: [
    { why: 'native Function.prototype-style .apply on another receiver', code: 'const value = operation.apply(owner, args);\n' },
    { why: 'other Reflect method', code: 'Reflect.get(owner, key);\n' },
    { why: 'locally declared Reflect shadows the global', code: 'const Reflect = { apply() { return 1; } }; Reflect.apply();\n' },
    { why: 'parameter named Reflect shadows the global', code: 'function invoke(Reflect: { apply(): number }) { return Reflect.apply(); }\n' },
    {
      why: 'Reflect.apply on an unchanged base line is not flagged',
      base: 'const a = Reflect.apply(op, owner, args);\n',
      code: 'const a = Reflect.apply(op, owner, args);\nconst b = 1;\n',
    },
  ],
  invalid: [
    { why: 'Reflect.apply call', code: 'const value = Reflect.apply(operation, owner, args);\n', findings: [finding(1)] },
    { why: 'computed string member Reflect[\'apply\']', code: "const value = Reflect['apply'](operation, owner, args);\n", findings: [finding(1)] },
    { why: 'optional-chained Reflect?.apply', code: 'const value = Reflect?.apply(operation, owner, args);\n', findings: [finding(1)] },
    { why: 'optional call Reflect.apply?.()', code: 'const value = Reflect.apply?.(operation, owner, args);\n', findings: [finding(1)] },
    {
      why: 'only the added Reflect.apply line is flagged when base has other lines',
      base: 'const a = 1;\n',
      code: 'const a = 1;\nconst b = Reflect.apply(op, owner, args);\n',
      findings: [finding(2)],
    },
    { why: 'fires on a .js file', filename: 'util.js', code: 'const value = Reflect.apply(operation, owner, args);\n', findings: [finding(1)] },
  ],
};
