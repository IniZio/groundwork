import type { RuleCases } from '../../../src/engine/types.js';

const MSG = 'Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.';
const flagged = [{ message: `[no-module-mocking] ${MSG}` }];

export const cases: RuleCases = {
  valid: [
    { why: 'plain in-memory fake', code: "const store = new InMemoryUserStore();\n" },
    { why: 'vi.spyOn is not module mocking', code: "vi.spyOn(store, 'save');\n" },
    { why: 'vi.fn is not module mocking', code: "const f = vi.fn();\n" },
    { why: 'jest.fn is not module mocking', code: "const f = jest.fn();\n" },
    { why: 'unrelated object with mock method', code: "server.mock('./user-store');\n" },
    { why: 'locally declared vi is not the framework', code: "const vi = { mock() {} };\nvi.mock();\n" },
    { why: 'jest parameter shadows the global', code: "function test(jest: { mock(): void }) { jest.mock(); }\n" },
    { why: 'vi imported from a helper module', code: "import { vi as localVi } from './helpers';\nlocalVi.mock('./module');\n" },
    { why: 'computed non-mock method', code: "vi['fn']();\n" },
    { why: 'identical vi.mock on an unchanged base line', code: "vi.mock('./user-store');\nconst a = 2;\n", base: "vi.mock('./user-store');\nconst a = 1;\n" },
  ],
  invalid: [
    { why: 'vi.mock', code: "vi.mock('./user-store');\n", findings: flagged },
    { why: 'jest.mock', code: "jest.mock('./user-store');\n", findings: flagged },
    { why: 'vi.doMock', code: "vi.doMock('./user-store');\n", findings: flagged },
    { why: 'jest.doMock', code: "jest.doMock('./user-store');\n", findings: flagged },
    { why: 'jest.unstable_mockModule', code: "jest.unstable_mockModule('./user-store');\n", findings: flagged },
    { why: 'computed string doMock', code: "vi['doMock']('./user-store');\n", findings: flagged },
    { why: 'computed string mock', code: "jest['mock']('./user-store');\n", findings: flagged },
    { why: 'vi imported from vitest', code: "import { vi } from 'vitest';\nvi.mock('./user-store');\n", findings: flagged },
    { why: 'aliased vi import from vitest', code: "import { vi as testApi } from 'vitest';\ntestApi.mock('./user-store');\n", findings: flagged },
    { why: 'jest imported from @jest/globals', code: "import { jest } from '@jest/globals';\njest.mock('./user-store');\n", findings: flagged },
    { why: 'mjs file', filename: 'setup.mjs', code: "vi.mock('./user-store');\n", findings: flagged },
    { why: 'js file', filename: 'setup.js', code: "jest.mock('./user-store');\n", findings: flagged },
    { why: 'tsx file', filename: 'view.test.tsx', code: "vi.mock('./user-store');\nconst el = <div />;\n", findings: flagged },
    { why: 'newly added vi.mock beside unchanged base lines', code: "vi.mock('./a');\nvi.mock('./b');\n", base: "vi.mock('./a');\n", findings: flagged },
  ],
};
