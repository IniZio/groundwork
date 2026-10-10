<!-- This file is generated. Do not edit manually. -->

# no-module-mocking

Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.

**Severity**: warn | **Autofix**: no

**Edit-time check**: yes | **Languages**: typescript

## Allowed

### [no-module-mocking] plain in-memory fake

```
const store = new InMemoryUserStore();

```

### [no-module-mocking] vi.spyOn is not module mocking

```
vi.spyOn(store, 'save');

```

### [no-module-mocking] vi.fn is not module mocking

```
const f = vi.fn();

```

### [no-module-mocking] jest.fn is not module mocking

```
const f = jest.fn();

```

### [no-module-mocking] unrelated object with mock method

```
server.mock('./user-store');

```

### [no-module-mocking] locally declared vi is not the framework

```
const vi = { mock() {} };
vi.mock();

```

### [no-module-mocking] jest parameter shadows the global

```
function test(jest: { mock(): void }) { jest.mock(); }

```

### [no-module-mocking] vi imported from a helper module

```
import { vi as localVi } from './helpers';
localVi.mock('./module');

```

### [no-module-mocking] vi declared via declare const is not the framework

```
declare const vi: any;
vi.mock('x');

```

### [no-module-mocking] catch parameter shadows vi

```
try {} catch (vi) { vi.mock('x'); }

```

### [no-module-mocking] for-of loop variable shadows vi

```
for (const vi of xs) { vi.mock('x'); }

```

### [no-module-mocking] computed non-mock method

```
vi['fn']();

```

### [no-module-mocking] identical vi.mock on an unchanged base line

```
vi.mock('./user-store');
const a = 2;

```

## Flagged

### [no-module-mocking] vi.mock

```
vi.mock('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] jest.mock

```
jest.mock('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] vi.doMock

```
vi.doMock('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] jest.doMock

```
jest.doMock('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] jest.unstable_mockModule

```
jest.unstable_mockModule('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] computed string doMock

```
vi['doMock']('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] computed string mock

```
jest['mock']('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] vi imported from vitest

```
import { vi } from 'vitest';
vi.mock('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] aliased vi import from vitest

```
import { vi as testApi } from 'vitest';
testApi.mock('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] jest imported from @jest/globals

```
import { jest } from '@jest/globals';
jest.mock('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] mjs file

```mjs
vi.mock('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] js file

```js
jest.mock('./user-store');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] tsx file

```tsx
vi.mock('./user-store');
const el = <div />;

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.

### [no-module-mocking] newly added vi.mock beside unchanged base lines

```
vi.mock('./a');
vi.mock('./b');

```

**Expected findings:**
- [no-module-mocking] Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.
