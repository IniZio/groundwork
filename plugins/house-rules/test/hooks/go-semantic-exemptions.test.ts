import { describe, it, expect } from "bun:test";
import { autoFix } from "../../src/hooks/lib/comment-density.js";

function removableBlock(n: number): string {
  return Array.from({ length: n }, (_, i) => `\t// prose comment ${i} that is removable`).join("\n");
}

async function runFix(text: string, addedRows: Set<number>) {
  return autoFix(text, "go", addedRows);
}

describe("case 1a: cgo preamble inside grouped import", () => {
  const PREAMBLE = "// #include <stdlib.h>";
  const src = `package main

import (
\t${PREAMBLE}
\t"C"
)

func pad() {
${removableBlock(30)}
}
`;

  it("preamble survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    if (!r.ok) return;
    expect(r.fixed).toContain(PREAMBLE);
  });
});

describe("case 1b: mixed block+line preamble before import C", () => {
  const BLOCK = "/* cgo start */";
  const src = `package main

${BLOCK}
// #include <stdio.h>
import "C"

func pad() {
${removableBlock(30)}
}
`;

  it("block comment in mixed preamble survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(BLOCK);
  });
});

describe("case 1c: mixed //-then-block preamble top-level import", () => {
  const SLASH_LINE = "// #define WIDTH 3";
  const BLOCK_BODY = "static int width(void) { return WIDTH; }";
  const src = `package p

${SLASH_LINE}
/*
${BLOCK_BODY}
*/
import "C"

func pad() {
${removableBlock(30)}
}
`;

  it("slash line in mixed preamble survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(SLASH_LINE);
  });

  it("block body in mixed preamble survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(BLOCK_BODY);
  });
});

describe("case 1d: mixed block-then-// preamble inside grouped import", () => {
  const BLOCK_HEADER = "/* block header */";
  const SLASH_INCLUDE = "// #include <sys/types.h>";
  const src = `package p

import (
\t${BLOCK_HEADER}
\t${SLASH_INCLUDE}
\t"C"
\t"fmt"
)

func pad() {
${removableBlock(30)}
}
`;

  it("block header in grouped mixed preamble survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(BLOCK_HEADER);
  });

  it("slash include in grouped mixed preamble survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(SLASH_INCLUDE);
  });
});

describe("case 1e: type_elem doc comment survives autoFix", () => {
  const TYPE_ELEM_DOC = "// Read reads more output from the hash.";
  const src = `package p

import "io"

type XOF interface {
\t${TYPE_ELEM_DOC}
\tio.Reader
}

func pad() {
${removableBlock(30)}
}
`;

  it("type_elem doc comment survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(TYPE_ELEM_DOC);
  });
});

describe("case 1f: /*line */ directive survives autoFix", () => {
  const LINE_DIR = "/*line x.go:1*/";
  const src = `package p

func F() int {
\tx := ${LINE_DIR} 1
${removableBlock(30)}
\treturn x
}
`;

  it("block line directive survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain(LINE_DIR);
  });
});

describe("case 1g: removedTexts field", () => {
  it("removedTexts contains exact text of each removed comment", async () => {
    const C1 = "// whole line one";
    const C2 = "// whole line two";
    const src = `package p

func pad() {
\t${C1}
\t${C2}
${removableBlock(30)}
}
`;
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.removed).toBe(r.removedTexts.length);
    for (const txt of [C1, C2]) {
      expect(r.removedTexts).toContain(txt);
    }
  });
});

describe("case 2: /* Output: */ block comment in Example func", () => {
  const OUTPUT_BLOCK = "/* Output:\n\t42\n*/";
  const src = `package main

import "fmt"

func ExampleFoo() {
\tfmt.Println(42)
\t${OUTPUT_BLOCK}
}

func pad() {
${removableBlock(30)}
}
`;

  it("block Output: comment survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    if (!r.ok) return;
    expect(r.fixed).toContain("Output:");
  });
});

describe("case 3a: //extern gccgo directive", () => {
  const EXTERN = "//extern CGoFunction";
  const src = `package main

${EXTERN}
func CGoFunction() int32

func pad() {
${removableBlock(30)}
}
`;

  it("//extern survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    if (!r.ok) return;
    expect(r.fixed).toContain(EXTERN);
  });
});

describe("case 3b: generic //tool:directive", () => {
  const TOOL_DIR = "//gopherjs:keep";
  const src = `package main

${TOOL_DIR}
var keepMe = true

func pad() {
${removableBlock(30)}
}
`;

  it("//gopherjs:keep survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    if (!r.ok) return;
    expect(r.fixed).toContain(TOOL_DIR);
  });
});

describe("case 4: prose comment starting with 'line' is removable", () => {
  const PROSE = "// line one of a prose paragraph here";
  const src = `package main

func pad() {
\t${PROSE}
${removableBlock(30)}
}
`;

  it("'// line …' prose is NOT exempt and CAN be removed", async () => {
    const { findComments } = await import("../../src/hooks/lib/comment-density.js");
    const r = await findComments(src, "go");
    if (!r.ok) throw new Error(r.reason);
    const found = r.comments.find(c => c.text === PROSE);
    expect(found).toBeDefined();
    expect(found!.exempt).toBe(false);
  });
});

describe("case 5: exported interface method doc comment", () => {
  const METHOD_DOC = "// Read reads data.";
  const src = `package main

type Reader interface {
\t${METHOD_DOC}
\tRead(p []byte) (n int, err error)
}

func pad() {
${removableBlock(30)}
}
`;

  it("interface method doc survives autoFix", async () => {
    const lines = src.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await runFix(src, addedRows);
    if (!r.ok) return;
    expect(r.fixed).toContain(METHOD_DOC);
  });
});

describe("case 6: go/doc note markers beyond TODO", () => {
  for (const marker of ["FIXME", "BUG", "NOTE", "XXX", "HACK"]) {
    const COMMENT = `// ${marker}(owner): this must be preserved`;
    const src = `package main

func pad() {
\t${COMMENT}
${removableBlock(30)}
}
`;
    it(`${marker}(owner): marker survives autoFix`, async () => {
      const lines = src.split("\n");
      const addedRows = new Set(lines.map((_, i) => i));
      const r = await runFix(src, addedRows);
      if (!r.ok) return;
      expect(r.fixed).toContain(COMMENT);
    });
  }
});

describe("case 7: regression — generated marker and SPDX already exempt", () => {
  it("Code generated marker is exempt (before package clause)", async () => {
    const src = `// Code generated by foo. DO NOT EDIT.

package main

func pad() {
${removableBlock(30)}
}
`;
    const { findComments } = await import("../../src/hooks/lib/comment-density.js");
    const r = await findComments(src, "go");
    if (!r.ok) throw new Error(r.reason);
    const found = r.comments.find(c => c.text.includes("DO NOT EDIT"));
    expect(found).toBeDefined();
    expect(found!.exempt).toBe(true);
  });

  it("SPDX header is exempt (before package clause)", async () => {
    const src = `// SPDX-License-Identifier: MIT

package main

func pad() {
${removableBlock(30)}
}
`;
    const { findComments } = await import("../../src/hooks/lib/comment-density.js");
    const r = await findComments(src, "go");
    if (!r.ok) throw new Error(r.reason);
    const found = r.comments.find(c => c.text.includes("SPDX"));
    expect(found).toBeDefined();
    expect(found!.exempt).toBe(true);
  });
});
