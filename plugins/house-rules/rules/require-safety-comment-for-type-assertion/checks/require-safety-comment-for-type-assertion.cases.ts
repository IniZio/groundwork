import type { RuleCases } from '../../../src/engine/types.js';
import { MESSAGE } from './require-safety-comment-for-type-assertion.js';

const flagged = [{ message: `[require-safety-comment-for-type-assertion] ${MESSAGE}` }];

export const cases: RuleCases = {
  valid: [
    { why: 'const assertion on array is exempt', code: "const values = [1, 2] as const;\n" },
    { why: 'angle-bracket const assertion is exempt', code: "const value = <const>{ id: 'one' };\n" },
    { why: 'SAFETY line comment before statement', code: "// SAFETY: The parser established the UserId invariant.\nconst id = value as UserId;\n" },
    { why: 'SAFETY comment before return statement', code: "function parse(): UserId {\n// SAFETY: Validation above established the UserId invariant.\nreturn value as UserId;\n}\n" },
    { why: 'inline SAFETY block comment before assertion', code: "const id = /* SAFETY: Validation established the invariant. */ value as UserId;\n" },
    { why: 'SAFETY comment before exported declaration', code: "// SAFETY: The parser established the exported UserId invariant.\nexport const id = value as UserId;\n" },
    { why: 'multi-line SAFETY block before exported declaration', code: "/* SAFETY:\n * The parser established the exported UserId invariant.\n */\nexport const id = value as UserId;\n" },
  ],
  invalid: [
    { why: 'bare as assertion', code: "const id = value as UserId;\n", findings: flagged },
    { why: 'bare angle-bracket assertion', code: "const id = <UserId>value;\n", findings: flagged },
    { why: 'trailing SAFETY comment is too late', code: "const id = value as UserId; // SAFETY: Too late.\n", findings: flagged },
    { why: 'unrelated preceding comment', code: "// This cast seems fine.\nconst id = value as UserId;\n", findings: flagged },
    { why: 'empty SAFETY comment', code: "// SAFETY:\nconst id = value as UserId;\n", findings: flagged },
    { why: 'whitespace-only SAFETY comment', code: "// SAFETY:   \nconst id = value as UserId;\n", findings: flagged },
    { why: 'empty inline SAFETY block', code: "const id = /* SAFETY: */ value as UserId;\n", findings: flagged },
    { why: 'bare exported assertion', code: "export const id = value as UserId;\n", findings: flagged },
    { why: 'non-safety comment before exported assertion', code: "// This is not a safety justification.\nexport const id = value as UserId;\n", findings: flagged },
  ],
};
