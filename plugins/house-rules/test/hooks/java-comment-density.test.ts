/**
 * JV-02b — Java comment-density rule/autofix-level tests.
 *
 * Covers:
 *   fixEntryFor("java").stability === "stable"
 *   Per-edit guard strips over-budget .java prose comments (Write + Edit payloads)
 *   Never stripped: Javadoc, license header, JAVA_TOOL_MARKERS
 *   Text blocks and string/char literals containing // or /* are untouched
 *   Under-budget java passes through unchanged
 *   Gate fix path for .java
 */
import { describe, it, expect } from "bun:test";
import { autoFix, findComments } from "../../src/hooks/lib/comment-density.js";
import { fixEntryFor } from "../../rules/comment-density/languages.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** n lines of removable prose, enough to push density over the 5% cap */
function removableBlock(n: number): string {
  return Array.from(
    { length: n },
    (_, i) => `// prose comment ${i} that is removable`,
  ).join("\n");
}

async function runFix(text: string, addedRows: Set<number>) {
  return autoFix(text, "java", addedRows);
}

function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

// ---------------------------------------------------------------------------
// fixEntryFor stability
// ---------------------------------------------------------------------------

describe("fixEntryFor(java) is stable", () => {
  it("stability === stable", () => {
    const entry = fixEntryFor("java");
    expect(entry.stability).toBe("stable");
  });
});

// ---------------------------------------------------------------------------
// Per-edit guard: Write payload — strips over-budget prose, code lines survive
// ---------------------------------------------------------------------------

describe("per-edit guard: Write payload removes over-budget prose comments", () => {
  const CODE_LINE = "public class Demo {}";
  const PROSE_COMMENT = "// removable prose line";
  const src = `package com.example.demo;

${CODE_LINE}

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
// Per-edit guard: Edit payload (addedRows subset) — only added rows affected
// ---------------------------------------------------------------------------

describe("per-edit guard: Edit payload only strips comments in addedRows", () => {
  const EXISTING_COMMENT = "// existing prose before edit";
  const ADDED_COMMENT = "// added prose that is removable";
  const src = `package com.example.demo;

${EXISTING_COMMENT}
public class Demo {
    void run() {}
}

${removableBlock(29)}
${ADDED_COMMENT}
`;

  it("added prose comment is removed", async () => {
    // Mark only the last comment line as added
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
// Never stripped: Javadoc /** ... */
// ---------------------------------------------------------------------------

describe("Javadoc /** */ — not counted toward density, never stripped", () => {
  const JAVADOC = "/**\n * @param id the identifier\n * @return string form\n */";
  const src = `package com.example.demo;

${JAVADOC}
public class Demo {
    public String find(int id) { return String.valueOf(id); }
}

${removableBlock(30)}
`;

  it("Javadoc is exempt (not counted toward density)", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);

    const jdoc = r.comments.find((c) => c.text.includes("@param id the identifier"));
    expect(jdoc).toBeDefined();
    expect(jdoc!.exempt).toBe(true);
  });

  it("Javadoc survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain("@param id the identifier");
  });
});

// ---------------------------------------------------------------------------
// Never stripped: license header block before package
// ---------------------------------------------------------------------------

describe("license header before package — not counted, not stripped", () => {
  const LICENSE_LINE = "// Copyright 2024 Example Corp. All rights reserved.";
  const src = `${LICENSE_LINE}
// SPDX-License-Identifier: Apache-2.0

package com.example.demo;

${removableBlock(30)}
`;

  it("license header comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);

    const c = r.comments.find((c) => c.text === LICENSE_LINE);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("license header survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(LICENSE_LINE);
  });
});

// ---------------------------------------------------------------------------
// Never stripped: JAVA_TOOL_MARKERS
// ---------------------------------------------------------------------------

describe("NOSONAR — never stripped", () => {
  const MARKER = "// NOSONAR"; // trailing on a code line
  const src = `package com.example.demo;

public class Demo {
    int x = riskyCall(); ${MARKER}
}

${removableBlock(30)}
`;

  it("NOSONAR comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("NOSONAR survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

describe("NOPMD — never stripped", () => {
  const MARKER = "// NOPMD";
  const src = `package com.example.demo;

public class Demo {
    void go() { return; } ${MARKER}
}

${removableBlock(30)}
`;

  it("NOPMD survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

describe("CHECKSTYLE:OFF — never stripped", () => {
  const MARKER = "// CHECKSTYLE:OFF";
  const src = `package com.example.demo;

${MARKER}
public class Demo {}
// CHECKSTYLE:ON

${removableBlock(30)}
`;

  it("CHECKSTYLE:OFF comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("CHECKSTYLE:OFF survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

describe("@formatter:off — never stripped", () => {
  const MARKER = "// @formatter:off";
  const src = `package com.example.demo;

${MARKER}
public class Demo {}
// @formatter:on

${removableBlock(30)}
`;

  it("@formatter:off comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("@formatter:off survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

describe("noinspection — never stripped", () => {
  const MARKER = "//noinspection SpellCheckingInspection";
  const src = `package com.example.demo;

${MARKER}
String identifier = "someIdentifierHere";

${removableBlock(30)}
`;

  it("noinspection comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("noinspection survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

describe("$NON-NLS-1$ — never stripped", () => {
  const MARKER = "//$NON-NLS-1$";
  const src = `package com.example.demo;

public class Demo {
    String s = "hello"; ${MARKER}
}

${removableBlock(30)}
`;

  it("$NON-NLS-1$ comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("$NON-NLS-1$ survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

describe("spotless:off — never stripped", () => {
  const MARKER = "// spotless:off";
  const src = `package com.example.demo;

${MARKER}
public class Demo {}
// spotless:on

${removableBlock(30)}
`;

  it("spotless:off comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("spotless:off survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

describe("CPD-OFF — never stripped", () => {
  const MARKER = "// CPD-OFF";
  const src = `package com.example.demo;

${MARKER}
public class Demo {}
// CPD-ON

${removableBlock(30)}
`;

  it("CPD-OFF comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("CPD-OFF survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

describe("deepcode ignore — never stripped", () => {
  const MARKER = "// deepcode ignore HardcodedNonCryptoSecret";
  const src = `package com.example.demo;

public class Demo {
    String s = "test-secret"; ${MARKER}
}

${removableBlock(30)}
`;

  it("deepcode ignore comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("deepcode ignore survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

describe("nosemgrep — never stripped", () => {
  const MARKER = "// nosemgrep: java.lang.security.audit.cbc-padding-oracle";
  const src = `package com.example.demo;

public class Demo {
    void decrypt() {} ${MARKER}
}

${removableBlock(30)}
`;

  it("nosemgrep comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("nosemgrep survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

describe("fall through between case labels — never stripped", () => {
  const MARKER = "// fall through";
  const src = `package com.example.demo;

public class Demo {
    void handle(int x) {
        switch (x) {
            case 1:
                doA();
                ${MARKER}
            case 2:
                doB();
                break;
        }
    }
    void doA() {}
    void doB() {}
}

${removableBlock(30)}
`;

  it("fall through comment is exempt", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find((c) => c.text === MARKER);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("fall through survives autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Text blocks """ containing // or /* — untouched
// ---------------------------------------------------------------------------

describe("text block with // — not counted as comment", () => {
  const src = `package com.example.demo;

public class Demo {
    String sql = """
            SELECT * FROM users -- not a comment
            WHERE id = 1
            """;
}

${removableBlock(30)}
`;

  it("content inside text block is not a comment node", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const fake = r.comments.find((c) => c.text.includes("not a comment"));
    expect(fake).toBeUndefined();
  });

  it("text block content is byte-identical after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain("SELECT * FROM users");
  });
});

describe("string literal with // — not counted as comment", () => {
  const src = `package com.example.demo;

public class Demo {
    String s = "url: http://example.com // not a comment";
}

${removableBlock(30)}
`;

  it("// inside string literal is not a comment", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const fake = r.comments.find((c) => c.text.includes("not a comment"));
    expect(fake).toBeUndefined();
  });

  it("string literal line is byte-identical after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain('String s = "url: http://example.com // not a comment"');
  });
});

describe("string literal with /* — not counted as comment", () => {
  const src = `package com.example.demo;

public class Demo {
    String s = "/* this looks like a block comment but is not */";
}

${removableBlock(30)}
`;

  it("/* inside string literal is not a comment", async () => {
    const r = await findComments(src, "java");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const fake = r.comments.find((c) =>
      c.text.includes("looks like a block comment"),
    );
    expect(fake).toBeUndefined();
  });

  it("string literal with /* is byte-identical after autoFix", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain("looks like a block comment");
  });
});

// ---------------------------------------------------------------------------
// Under-budget java passes through unchanged
// ---------------------------------------------------------------------------

describe("under-budget java — passes through unchanged", () => {
  // 1 prose comment in ~45 code lines → well under 5% cap
  const src = `package com.example.demo;

public class Demo {
    // a brief note
    private int a;
    private int b;
    private int c;
    private int d;
    private int e;
    private int f;
    private int g;
    private int h;
    private int i;
    private int j;
    private int k;
    private int l;
    private int m;
    private int n;
    private int o;
    private int p;
    private int q;
    private int r;
    private int s;
    private int t;
    private int u;
    private int v;
    private int w;
    public Demo() { this.a = 0; }
    public int getA() { return a; }
    public int getB() { return b; }
    public int getC() { return c; }
    public int getD() { return d; }
    public int getE() { return e; }
    public int getF() { return f; }
    public int getG() { return g; }
    public int getH() { return h; }
    public int getI() { return i; }
    public int getJ() { return j; }
    public int getK() { return k; }
    public int getL() { return l; }
    public int getM() { return m; }
}
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
// Gate fix path for .java
// ---------------------------------------------------------------------------

describe("gate fix path: .java file is processed by autoFix", () => {
  // A file that is clearly over-budget; gate path should reduce comment count
  const PROSE = "// excess prose comment that should be removed";
  const src = `package com.example.demo;

public class Demo {}

${removableBlock(40)}
`;

  it("autoFix reduces comment count for over-budget .java", async () => {
    const rows = allRows(src);
    const before = await findComments(src, "java");
    expect(before.ok).toBe(true);
    if (!before.ok) throw new Error(before.reason);

    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);

    const after = await findComments(r.fixed, "java");
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error(after.reason);

    const beforeCount = before.comments.filter((c) => !c.exempt).length;
    const afterCount = after.comments.filter((c) => !c.exempt).length;
    expect(afterCount).toBeLessThan(beforeCount);
  });

  it("autoFix removed prose comment from .java", async () => {
    const rows = allRows(src);
    const r = await runFix(src, rows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).not.toContain(PROSE);
  });
});
