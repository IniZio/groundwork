import { describe, it, expect, afterEach } from "bun:test";
import { createSourceFiles } from "../../src/engine/source-file.js";

let sf = createSourceFiles();
afterEach(() => {
  sf.dispose();
  sf = createSourceFiles();
});

// ── Group 1: Rust doc-comment kinds ──────────────────────────────────────────

const RUST_SNIPPET = `//! crate doc\n/// outer doc\n//// four slashes\n// plain\nfn foo() {}\n`;

describe("AC4 group 1: Rust doc-comment classification", () => {
  it("//! crate doc has kind doc", async () => {
    const r = await sf.get("rust", RUST_SNIPPET);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text.trim() === "//! crate doc");
    expect(c, "comment not found: //! crate doc").toBeDefined();
    expect(c!.kind).toBe("doc");
  });

  it("/// outer doc has kind doc", async () => {
    const r = await sf.get("rust", RUST_SNIPPET);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text.trim() === "/// outer doc");
    expect(c, "comment not found: /// outer doc").toBeDefined();
    expect(c!.kind).toBe("doc");
  });

  it("//// four slashes has kind line (not doc)", async () => {
    const r = await sf.get("rust", RUST_SNIPPET);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "//// four slashes");
    expect(c, "comment not found: //// four slashes").toBeDefined();
    expect(c!.kind).not.toBe("doc");
    expect(c!.kind).toBe("line");
  });

  it("// plain has kind line", async () => {
    const r = await sf.get("rust", RUST_SNIPPET);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "// plain");
    expect(c, "comment not found: // plain").toBeDefined();
    expect(c!.kind).toBe("line");
  });
});

// ── Group 2: Dockerfile parser directives ─────────────────────────────────────

// Row 0 comment must be a parser directive; same text on row 2 must not be.
const DOCKERFILE_SNIPPET =
  "# syntax=docker/dockerfile:1\nFROM alpine\n# syntax=late\nRUN echo hi\n";

describe("AC4 group 2: Dockerfile parser-directive classification", () => {
  it("row-0 # syntax=... has directive true", async () => {
    const r = await sf.get("dockerfile", DOCKERFILE_SNIPPET);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "# syntax=docker/dockerfile:1");
    expect(c, "comment not found: # syntax=docker/dockerfile:1").toBeDefined();
    expect(c!.directive).toBe(true);
  });

  it("# syntax=late after FROM has directive false", async () => {
    const r = await sf.get("dockerfile", DOCKERFILE_SNIPPET);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "# syntax=late");
    expect(c, "comment not found: # syntax=late").toBeDefined();
    expect(c!.directive).toBe(false);
  });
});

// ── Group 3: Shebang directive classification (bash + python) ─────────────────

// bash: row-0 shebang → directive true
const BASH_ROW0 = "#!/bin/bash\necho hello\n";
// bash: same text on row 5 (preceded by 5 code lines) → directive false
const BASH_ROW5 = "echo one\necho two\necho three\necho four\necho five\n#!/bin/bash\n";

// python: row-0 shebang → directive true
const PYTHON_ROW0 = "#!/usr/bin/env python3\nx = 1\n";
// python: same text on row 5 → directive false
const PYTHON_ROW5 = "x = 1\ny = 2\nz = 3\na = 4\nb = 5\n#!/usr/bin/env python3\n";

describe("AC4 group 3: Shebang directive classification — bash", () => {
  it("bash row-0 #!/bin/bash has directive true", async () => {
    const r = await sf.get("bash", BASH_ROW0);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "#!/bin/bash");
    expect(c, "comment not found: #!/bin/bash (row 0)").toBeDefined();
    expect(c!.startRow).toBe(0);
    expect(c!.directive).toBe(true);
  });

  it("bash row-5 #!/bin/bash has directive false", async () => {
    const r = await sf.get("bash", BASH_ROW5);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "#!/bin/bash");
    expect(c, "comment not found: #!/bin/bash (row 5)").toBeDefined();
    expect(c!.startRow).toBe(5);
    expect(c!.directive).toBe(false);
  });
});

describe("AC4 group 3: Shebang directive classification — python", () => {
  it("python row-0 #!/usr/bin/env python3 has directive true", async () => {
    const r = await sf.get("python", PYTHON_ROW0);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "#!/usr/bin/env python3");
    expect(c, "comment not found: #!/usr/bin/env python3 (row 0)").toBeDefined();
    expect(c!.startRow).toBe(0);
    expect(c!.directive).toBe(true);
  });

  it("python row-5 #!/usr/bin/env python3 has directive false", async () => {
    const r = await sf.get("python", PYTHON_ROW5);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "#!/usr/bin/env python3");
    expect(c, "comment not found: #!/usr/bin/env python3 (row 5)").toBeDefined();
    expect(c!.startRow).toBe(5);
    expect(c!.directive).toBe(false);
  });
});

// ── Secondary: TOML schema directive ─────────────────────────────────────────

const TOML_SNIPPET = "#:schema ./s.json\n# plain\n[section]\nkey = \"value\"\n";

describe("Secondary — TOML schema directive", () => {
  it("#:schema ./s.json has directive true", async () => {
    const r = await sf.get("toml", TOML_SNIPPET);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "#:schema ./s.json");
    expect(c, "comment not found: #:schema ./s.json").toBeDefined();
    expect(c!.directive).toBe(true);
  });

  it("# plain has directive false", async () => {
    const r = await sf.get("toml", TOML_SNIPPET);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "# plain");
    expect(c, "comment not found: # plain").toBeDefined();
    expect(c!.directive).toBe(false);
  });
});


const SQL_SNIPPET = "SELECT 1; /* block */\n";

describe("Secondary — SQL block comment presence", () => {
  it("/* block */ appears in SQL comments", async () => {
    const r = await sf.get("sql", SQL_SNIPPET);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "/* block */");
    expect(c, "comment not found: /* block */").toBeDefined();
    expect(c!.kind).toBe("block");
  });
});


const TS_DOC_SNIPPET = "/** jsdoc */\n/* block */\nconst x = 1;\n";

describe("Secondary — TypeScript jsdoc vs block kind", () => {
  it("/** jsdoc */ has kind doc", async () => {
    const r = await sf.get("typescript", TS_DOC_SNIPPET, "x.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "/** jsdoc */");
    expect(c, "comment not found: /** jsdoc */").toBeDefined();
    expect(c!.kind).toBe("doc");
  });

  it("/* block */ has kind block", async () => {
    const r = await sf.get("typescript", TS_DOC_SNIPPET, "x.ts");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("parse failed");
    const c = r.source.comments.find((x) => x.text === "/* block */");
    expect(c, "comment not found: /* block */").toBeDefined();
    expect(c!.kind).toBe("block");
  });
});
