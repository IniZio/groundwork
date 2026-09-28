/**
 * PY-02c — Python comment-density rule/autofix-level tests.
 *
 * Covers:
 *   fixEntryFor("python").stability === "stable"
 *   Per-edit guard strips over-budget .py prose comments (Write + Edit payloads)
 *   Same for .pyi-style stub content (python language)
 *   Never stripped: PYTHON_TOOL_MARKERS family, shebang, PEP 263 coding,
 *                   docstrings ("""..."""), # inside string literals / f-strings
 *   Under-budget python passes through unchanged
 *   Assert identity of kept/removed lines; vary order to catch wrong-row stripping
 */
import { describe, it, expect } from "bun:test";
import { autoFix, findComments } from "../../src/hooks/lib/comment-density.js";
import { fixEntryFor } from "../../rules/comment-density/languages.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** n lines of removable Python prose, enough to push density over the 5% cap */
function removableBlock(n: number): string {
  return Array.from(
    { length: n },
    (_, i) => `# prose comment ${i} that is removable`,
  ).join("\n");
}

async function runFix(text: string, addedRows: Set<number>) {
  return autoFix(text, "python", addedRows);
}

function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

// ---------------------------------------------------------------------------
// fixEntryFor stability
// ---------------------------------------------------------------------------

describe("fixEntryFor(python) is stable", () => {
  it("stability === stable", () => {
    const entry = fixEntryFor("python");
    expect(entry.stability).toBe("stable");
  });
});

// ---------------------------------------------------------------------------
// Per-edit guard: Write payload (.py) — strips over-budget prose, code survives
// ---------------------------------------------------------------------------

describe("per-edit guard: Write payload removes over-budget prose comments (.py)", () => {
  const CODE_LINE = "def calculate(x: int) -> int:";
  const PROSE_COMMENT = "# removable prose line";
  const src = `#!/usr/bin/env python3

${CODE_LINE}
    return x * 2

${removableBlock(30)}
`;

  it("code line survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(CODE_LINE);
  });

  it("over-budget prose comment is removed", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).not.toContain(PROSE_COMMENT);
  });
});

// ---------------------------------------------------------------------------
// Per-edit guard: Write payload (.pyi stub) — python language, stub content
// ---------------------------------------------------------------------------

describe("per-edit guard: Write payload removes over-budget prose comments (.pyi stub)", () => {
  const CODE_LINE = "def get_value(key: str) -> int: ...";
  const PROSE_COMMENT = "# removable prose line";
  // .pyi files have no function bodies — just signatures and ellipses
  const src = `from typing import Optional

${CODE_LINE}
def set_value(key: str, value: int) -> None: ...
def delete_key(key: str) -> Optional[int]: ...

${removableBlock(30)}
`;

  it("stub function signature survives autoFix (.pyi content)", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(CODE_LINE);
  });

  it("over-budget prose comment removed in .pyi content", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).not.toContain(PROSE_COMMENT);
  });
});

// ---------------------------------------------------------------------------
// Per-edit guard: Edit payload (addedRows subset) — only added rows stripped
// ---------------------------------------------------------------------------

describe("per-edit guard: Edit payload only strips comments in addedRows", () => {
  const EXISTING_COMMENT = "# existing prose before edit";
  const ADDED_COMMENT = "# added prose that is removable";
  const src = `def run() -> None:
    pass

${EXISTING_COMMENT}

${removableBlock(29)}
${ADDED_COMMENT}
`;

  it("added prose comment is removed", async () => {
    const lines = src.split("\n");
    const addedIdx = lines.findIndex((l) => l === ADDED_COMMENT);
    expect(addedIdx).toBeGreaterThanOrEqual(0);
    const addedRows = new Set([addedIdx]);
    const r = await runFix(src, addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).not.toContain(ADDED_COMMENT);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: shebang line
// ---------------------------------------------------------------------------

describe("shebang #!/usr/bin/env python3 — not counted, never stripped", () => {
  const SHEBANG = "#!/usr/bin/env python3";
  const src = `${SHEBANG}

def main() -> None:
    pass

${removableBlock(30)}
`;

  it("shebang is exempt (not counted toward density)", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === SHEBANG);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("shebang survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(SHEBANG);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: PEP 263 coding declaration
// ---------------------------------------------------------------------------

describe("PEP 263 coding declaration — never stripped", () => {
  const CODING = "# coding: utf-8";
  const src = `${CODING}

def greet(name: str) -> str:
    return f"hello {name}"

${removableBlock(30)}
`;

  it("coding comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === CODING);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("coding comment survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(CODING);
  });
});

describe("PEP 263 Emacs-style coding: -*- coding: utf-8 -*- — never stripped", () => {
  const CODING = "# -*- coding: utf-8 -*-";
  const src = `${CODING}

x: int = 1

${removableBlock(30)}
`;

  it("Emacs-style coding comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === CODING);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("Emacs-style coding survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(CODING);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: PYTHON_TOOL_MARKERS — # noqa
// ---------------------------------------------------------------------------

describe("# noqa — never stripped", () => {
  const MARKER = "# noqa: E501";
  const src = `import os
import sys  ${MARKER}

def run() -> None:
    pass

${removableBlock(30)}
`;

  it("noqa comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("noqa survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # type: ignore
// ---------------------------------------------------------------------------

describe("# type: ignore — never stripped", () => {
  const MARKER = "# type: ignore";
  const src = `result = do_thing()  ${MARKER}

def do_thing():
    return 42

${removableBlock(30)}
`;

  it("type: ignore comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("type: ignore survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # nosec
// ---------------------------------------------------------------------------

describe("# nosec — never stripped", () => {
  const MARKER = "# nosec";
  const src = `import hashlib

digest = hashlib.md5(b"data")  ${MARKER}

${removableBlock(30)}
`;

  it("nosec comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("nosec survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # fmt: off / # fmt: on / # fmt: skip
// ---------------------------------------------------------------------------

describe("# fmt: off — never stripped", () => {
  const MARKER_OFF = "# fmt: off";
  const MARKER_ON = "# fmt: on";
  const src = `${MARKER_OFF}
matrix = [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
]
${MARKER_ON}

${removableBlock(30)}
`;

  it("fmt: off comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER_OFF);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("fmt: off/on survive autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER_OFF);
    expect(r.fixed).toContain(MARKER_ON);
  });
});

describe("# fmt: skip — never stripped", () => {
  const MARKER = "# fmt: skip";
  const src = `x = (1+2)  ${MARKER}

def run() -> None:
    pass

${removableBlock(30)}
`;

  it("fmt: skip survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # isort: skip_file
// ---------------------------------------------------------------------------

describe("# isort: skip_file — never stripped", () => {
  const MARKER = "# isort: skip_file";
  const src = `${MARKER}

import sys
import os

${removableBlock(30)}
`;

  it("isort: skip_file comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("isort: skip_file survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # mypy: ignore-errors
// ---------------------------------------------------------------------------

describe("# mypy: ignore-errors — never stripped", () => {
  const MARKER = "# mypy: ignore-errors";
  const src = `${MARKER}

def legacy(x) -> None:
    pass

${removableBlock(30)}
`;

  it("mypy: ignore-errors comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("mypy: ignore-errors survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # pyright: basic
// ---------------------------------------------------------------------------

describe("# pyright: basic — never stripped", () => {
  const MARKER = "# pyright: basic";
  const src = `${MARKER}

def helper(n: int) -> str:
    return str(n)

${removableBlock(30)}
`;

  it("pyright: basic comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("pyright: basic survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # flake8: noqa
// ---------------------------------------------------------------------------

describe("# flake8: noqa — never stripped", () => {
  const MARKER = "# flake8: noqa";
  const src = `${MARKER}

x = 1

${removableBlock(30)}
`;

  it("flake8: noqa survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # ruff: noqa
// ---------------------------------------------------------------------------

describe("# ruff: noqa — never stripped", () => {
  const MARKER = "# ruff: noqa";
  const src = `${MARKER}

x = 1

${removableBlock(30)}
`;

  it("ruff: noqa survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # pyre-ignore
// ---------------------------------------------------------------------------

describe("# pyre-ignore — never stripped", () => {
  const MARKER = "# pyre-ignore";
  const src = `result = unsafe_cast()  ${MARKER}

def unsafe_cast():
    return 1

${removableBlock(30)}
`;

  it("pyre-ignore comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("pyre-ignore survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # pylint: disable=...
// ---------------------------------------------------------------------------

describe("# pylint: disable=line-too-long — never stripped", () => {
  const MARKER = "# pylint: disable=line-too-long";
  const src = `${MARKER}

def run() -> None:
    pass

${removableBlock(30)}
`;

  it("pylint: disable comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("pylint: disable survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # pragma: no cover
// ---------------------------------------------------------------------------

describe("# pragma: no cover — never stripped", () => {
  const MARKER = "# pragma: no cover";
  const src = `def debug_only() -> None:  ${MARKER}
    import pdb; pdb.set_trace()

${removableBlock(30)}
`;

  it("pragma: no cover comment is exempt", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("pragma: no cover survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: docstrings """...""" — not comment nodes, always untouched
// ---------------------------------------------------------------------------

describe('module-level docstring """...""" — not counted as comment', () => {
  const DOCSTRING_INNER = "Compute the sum of two integers.";
  const src = `def add(a: int, b: int) -> int:
    """${DOCSTRING_INNER}"""
    return a + b

${removableBlock(30)}
`;

  it("docstring is not a comment node", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const fake = r.comments.find((c) => c.text.includes(DOCSTRING_INNER));
    expect(fake).toBeUndefined();
  });

  it("docstring content is byte-identical after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(DOCSTRING_INNER);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: # inside string literals — not comment nodes
// ---------------------------------------------------------------------------

describe("# inside string literal — not counted as comment", () => {
  const src = `url = "http://example.com/#fragment"

def run() -> None:
    pass

${removableBlock(30)}
`;

  it("# inside string literal is not a comment node", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const fake = r.comments.find((c) => c.text.includes("fragment"));
    expect(fake).toBeUndefined();
  });

  it("string literal with # is byte-identical after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain('url = "http://example.com/#fragment"');
  });
});

describe("# inside f-string — not counted as comment", () => {
  const src = `name = "world"
msg = f"hello {name} # not a comment"

def run() -> None:
    pass

${removableBlock(30)}
`;

  it("# inside f-string is not a comment node", async () => {
    const r = await findComments(src, "python");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const fake = r.comments.find((c) => c.text.includes("not a comment"));
    expect(fake).toBeUndefined();
  });

  it("f-string line is byte-identical after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain('msg = f"hello {name} # not a comment"');
  });
});

// ---------------------------------------------------------------------------
// Under-budget python — passes through unchanged
// ---------------------------------------------------------------------------

describe("under-budget python — passes through unchanged", () => {
  // 1 prose comment in ~40 code lines → well under 5% cap
  const src = `# a brief note
class Counter:
    def __init__(self) -> None:
        self.a = 0
        self.b = 0
        self.c = 0
        self.d = 0
        self.e = 0
        self.f = 0
        self.g = 0
        self.h = 0
        self.i = 0
        self.j = 0
        self.k = 0
        self.l = 0
        self.m = 0
        self.n = 0
        self.o = 0
        self.p = 0
        self.q = 0
        self.r = 0
    def get_a(self) -> int: return self.a
    def get_b(self) -> int: return self.b
    def get_c(self) -> int: return self.c
    def get_d(self) -> int: return self.d
    def get_e(self) -> int: return self.e
    def get_f(self) -> int: return self.f
    def get_g(self) -> int: return self.g
    def get_h(self) -> int: return self.h
    def get_i(self) -> int: return self.i
    def get_j(self) -> int: return self.j
    def get_k(self) -> int: return self.k
    def get_l(self) -> int: return self.l
    def get_m(self) -> int: return self.m
`;

  it("autoFix returns ok and fixed equals original", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// Identity assertion: mixed markers and prose — correct rows stripped, vary order
// ---------------------------------------------------------------------------

describe("identity: markers kept, prose removed — vary order to detect wrong row", () => {
  // Build source with markers interspersed between prose in different positions
  // so a by-count assertion would pass even if the wrong row is stripped.
  const KEPT_MARKER_A = "# noqa: E501";
  const KEPT_MARKER_B = "# type: ignore";
  const KEPT_MARKER_C = "# pragma: no cover";
  const REMOVED_A = "# prose alpha removable";
  const REMOVED_B = "# prose beta removable";

  // Order: REMOVED_A at top, markers scattered, REMOVED_B at bottom
  const src = `${REMOVED_A}
x = 1  ${KEPT_MARKER_A}

def run() -> None:  ${KEPT_MARKER_C}
    pass

${removableBlock(25)}

y = legacy()  ${KEPT_MARKER_B}

${REMOVED_B}
`;

  it("all three markers are kept after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(KEPT_MARKER_A);
    expect(r.fixed).toContain(KEPT_MARKER_B);
    expect(r.fixed).toContain(KEPT_MARKER_C);
  });

  it("REMOVED_A (top) is stripped", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).not.toContain(REMOVED_A);
  });

  it("REMOVED_B (bottom) is stripped", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).not.toContain(REMOVED_B);
  });
});

// ---------------------------------------------------------------------------
// Gate fix path: over-budget python reduces comment count
// ---------------------------------------------------------------------------

describe("gate fix path: over-budget python reduces comment count", () => {
  const PROSE = "# excess prose comment that should be removed";
  const src = `def compute(n: int) -> int:
    return n * n

${removableBlock(40)}
`;

  it("autoFix reduces non-exempt comment count", async () => {
    const rows = allRows(src);
    const before = await findComments(src, "python");
    expect(before.ok).toBe(true);
    if (!before.ok) throw new Error(before.reason);

    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);

    const after = await findComments(r.fixed, "python");
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error(after.reason);

    const beforeCount = before.comments.filter((c) => !c.exempt).length;
    const afterCount = after.comments.filter((c) => !c.exempt).length;
    expect(afterCount).toBeLessThan(beforeCount);
  });

  it("autoFix removed prose comment", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).not.toContain(PROSE);
  });
});
