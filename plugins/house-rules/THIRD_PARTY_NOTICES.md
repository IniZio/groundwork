# Third-party notices

## anti-slop

Several house-rules checks are ported from anti-slop, which is MIT-licensed.

- Upstream: https://github.com/dmmulroy/anti-slop
- Pinned commit: https://github.com/dmmulroy/anti-slop/tree/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b

Ported checks, by rule:

- `type-escape-hatches`: `no-unknown-parameters`, `no-unknown-returns`, `no-unknown-type-aliases`, `no-unsafe-dictionary-type`, `no-object-parameters`, `no-chained-type-assertions`, `no-runtime-typeof`, `no-widen-then-assert`, `no-known-value-widening`
- `code-smells`: `no-reflect-apply`, `no-reflect-get`, `no-conditional-empty-object-spread`, `no-array-filter-map`, `no-reduce-accumulator-copy`, `no-shape-in-symbol-names`
- `no-module-mocking`: `no-module-mocking`
- `effect`: `prefer-effect-match`, `no-manual-effect-error-tag`, `no-service-constructor-imports`, `no-manual-tag-comparison`, `no-manual-tagged-construction`
- `require-safety-comment-for-type-assertion`: `require-safety-comment-for-type-assertion`
- `require-readable-spacing`: `require-readable-spacing`

Licence:

```text
MIT License

Copyright (c) 2026 Dillon Mulroy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ESLint Stylistic

The blank-line policy of `require-readable-spacing` follows ESLint Stylistic's `padding-line-between-statements` rule, taken through anti-slop's vendored copy. ESLint Stylistic is MIT-licensed.

- Upstream: https://github.com/eslint-stylistic/eslint-stylistic
- Pinned commit: https://github.com/eslint-stylistic/eslint-stylistic/tree/435c3ea0fd26a5fef9042c4b36b6e165fbbf8d08

Licence:

```text
MIT License

Copyright OpenJS Foundation and other contributors, <www.openjsf.org>
Copyright (c) 2023-PRESENT ESLint Stylistic contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
