import type { RuleCases } from '../../../src/engine/types.js';

const msg = (name: string) => ({
  message: `[no-service-constructor-imports] Do not import Effect service constructor "${name}" into runtime code. Import the owning Layer, yield the contextual service, and allow its requirements to propagate to the composition root.`,
});

export const cases: RuleCases = {
  valid: [
    { why: 'test file may import constructor', filename: 'src/issue-service.test.ts', code: 'import { makeIssueService } from "./issue-service.ts";\n' },
    { why: 'spec tsx file may import constructor', filename: 'src/issue-service.spec.tsx', code: 'import { makeIssueService } from "../issue-service.ts";\n' },
    { why: 'package import is not project-local', filename: 'src/runtime.ts', code: 'import { makeExecutionMemo } from "alchemy/Runtime/ExecutionMemo";\n' },
    { why: 'layer import and unrelated make call', filename: 'src/runtime.ts', code: 'import { issueServiceLayer } from "./issue-service.ts";\nWorkspaceName.make("name");\n' },
    { why: 'lowercase after make is not a constructor name', filename: 'src/runtime.ts', code: 'import { makeissueService } from "./issue-service.ts";\n' },
  ],
  invalid: [
    { why: 'local constructor import', filename: 'src/runtime.ts', code: 'import { makeIssueService } from "./issue-service.ts";\n', findings: [msg('makeIssueService')] },
    { why: 'aliased constructor import reports imported name', filename: 'src/runtime.ts', code: 'import { makeIssueService as createIssueService } from "../issue-service.ts";\n', findings: [msg('makeIssueService')] },
  ],
};
