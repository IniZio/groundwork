import { describe, it, expect, afterAll } from "bun:test";
import { createSourceFiles } from "../../src/engine/source-file.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { findComments, stripComments } from "../../src/hooks/lib/comment-density.js";
import { parserForPath } from "../../src/hooks/languages/parse.js";
import { languageForPath } from "../../src/hooks/languages/registry.js";

const sf = createSourceFiles(getParser);
afterAll(() => sf.dispose());

async function classify(text: string, filePath = "module.py") {
  const r = await sf.get("python", text, filePath);
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`);
  return r.source.comments;
}

async function comments(text: string, filePath = "module.py") {
  return findComments(text, "python", parserForPath(getParser, filePath));
}

function markerSrc(marker: string): string {
  return `x = 0\n${marker}\ny = 1\n`;
}

function markerSrcTrailing(stmt: string, marker: string): string {
  return `x = 0\n${stmt}  ${marker}\ny = 1\n`;
}

describe("languageForPath — python", () => {
  it("module.py → python", () => {
    expect(languageForPath("module.py")).toBe("python");
  });
  it("stubs/types.pyi → python", () => {
    expect(languageForPath("stubs/types.pyi")).toBe("python");
  });
  it("src/utils/helpers.py → python", () => {
    expect(languageForPath("src/utils/helpers.py")).toBe("python");
  });
  it("index.ts → not python", () => {
    expect(languageForPath("index.ts")).not.toBe("python");
  });
  it("extensionless + #!/usr/bin/env python3 → python", () => {
    expect(languageForPath("script", "#!/usr/bin/env python3")).toBe("python");
  });
  it("extensionless + #!/usr/bin/env python2 → python", () => {
    expect(languageForPath("script", "#!/usr/bin/env python2")).toBe("python");
  });
  it("extensionless + #!/usr/bin/python → python", () => {
    expect(languageForPath("script", "#!/usr/bin/python")).toBe("python");
  });
});

type MarkerCase = { title: string; src: string; marker: string };

const MARKER_CASES: MarkerCase[] = [
  { title: "noqa bare", src: markerSrc("# noqa"), marker: "# noqa" },
  { title: "noqa: E501", src: markerSrc("# noqa: E501"), marker: "# noqa: E501" },
  { title: "NOQA uppercase", src: markerSrc("# NOQA"), marker: "# NOQA" },
  { title: "noqa trailing after stmt", src: markerSrcTrailing("x = compute()", "# noqa: E501"), marker: "# noqa: E501" },
  { title: "type: int", src: markerSrc("# type: int"), marker: "# type: int" },
  { title: "type: (int) -> str", src: markerSrc("# type: (int) -> str"), marker: "# type: (int) -> str" },
  { title: "type: ignore", src: markerSrc("# type: ignore"), marker: "# type: ignore" },
  { title: "type: ignore[attr-defined]", src: markerSrcTrailing("v = obj.attr", "# type: ignore[attr-defined]"), marker: "# type: ignore[attr-defined]" },
  { title: "coding=utf-8 (PEP 263)", src: markerSrc("# coding=utf-8"), marker: "# coding=utf-8" },
  { title: "coding: latin-1 (PEP 263)", src: markerSrc("# coding: latin-1"), marker: "# coding: latin-1" },
  { title: "-*- coding: utf-8 -*- (PEP 263)", src: markerSrc("# -*- coding: utf-8 -*-"), marker: "# -*- coding: utf-8 -*-" },
  { title: "vim: set fileencoding=utf-8 : (PEP 263)", src: markerSrc("# vim: set fileencoding=utf-8 :"), marker: "# vim: set fileencoding=utf-8 :" },
  { title: "nosec", src: markerSrc("# nosec"), marker: "# nosec" },
  { title: "nosec trailing after stmt", src: markerSrcTrailing("result = query()", "# nosec"), marker: "# nosec" },
  { title: "fmt: off", src: markerSrc("# fmt: off"), marker: "# fmt: off" },
  { title: "fmt: on", src: markerSrc("# fmt: on"), marker: "# fmt: on" },
  { title: "fmt: skip trailing", src: markerSrcTrailing("x = [1,2,3]", "# fmt: skip"), marker: "# fmt: skip" },
  { title: "isort: skip", src: markerSrc("# isort: skip"), marker: "# isort: skip" },
  { title: "isort:skip_file", src: markerSrc("# isort:skip_file"), marker: "# isort:skip_file" },
  { title: "isort: off", src: markerSrc("# isort: off"), marker: "# isort: off" },
  { title: "isort: on", src: markerSrc("# isort: on"), marker: "# isort: on" },
  { title: "mypy: ignore-errors", src: markerSrc("# mypy: ignore-errors"), marker: "# mypy: ignore-errors" },
  { title: "pyright: basic", src: markerSrc("# pyright: basic"), marker: "# pyright: basic" },
  { title: "flake8: noqa", src: markerSrc("# flake8: noqa"), marker: "# flake8: noqa" },
  { title: "ruff: noqa", src: markerSrc("# ruff: noqa"), marker: "# ruff: noqa" },
  { title: "pyre-ignore", src: markerSrc("# pyre-ignore"), marker: "# pyre-ignore" },
  { title: "pyre-fixme[16]", src: markerSrc("# pyre-fixme[16]"), marker: "# pyre-fixme[16]" },
  { title: "pyre-strict", src: markerSrc("# pyre-strict"), marker: "# pyre-strict" },
  { title: "pylint: disable=invalid-name", src: markerSrc("# pylint: disable=invalid-name"), marker: "# pylint: disable=invalid-name" },
  { title: "pylint: enable=line-too-long", src: markerSrc("# pylint: enable=line-too-long"), marker: "# pylint: enable=line-too-long" },
  { title: "pragma: no cover", src: markerSrcTrailing("def main():", "# pragma: no cover"), marker: "# pragma: no cover" },
  { title: "PRAGMA: NO COVER (uppercase)", src: markerSrcTrailing("def run():", "# PRAGMA: NO COVER"), marker: "# PRAGMA: NO COVER" },
];

describe("marker directives → directive true", () => {
  for (const { title, src, marker } of MARKER_CASES) {
    it(`${title} — directive true`, async () => {
      const cs = await classify(src);
      const c = cs.find(x => x.text === marker);
      expect(c, `comment "${marker}" not found in classified`).toBeDefined();
      expect(c!.directive).toBe(true);
    });

    it(`${title} — findComments exempt true`, async () => {
      const r = await comments(src);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.reason);
      const c = r.comments.find(x => x.text === marker);
      expect(c, `comment "${marker}" not found`).toBeDefined();
      expect(c!.exempt).toBe(true);
    });

    it(`${title} — stripComments keeps marker, removes prose`, async () => {
      const prose = "# removable prose line";
      const fullSrc = src + prose + "\n";
      const r = await comments(fullSrc);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error(r.reason);
      const nonExempt = r.comments.filter(c => !c.exempt);
      const { text: stripped } = stripComments(fullSrc, nonExempt);
      expect(stripped).toContain(marker);
      expect(stripped).not.toContain("removable prose line");
    });
  }
});

describe("prose negatives — directive false", () => {
  const NEG: Array<{ title: string; src: string; marker: string }> = [
    { title: "plain prose comment", src: markerSrc("# compute the total"), marker: "# compute the total" },
    { title: "TODO comment", src: markerSrc("# TODO fix this"), marker: "# TODO fix this" },
    { title: "trailing explain (not noqa)", src: markerSrcTrailing("x = 1", "# explain"), marker: "# explain" },
    { title: "@apiParam — prose not directive", src: markerSrc("# @apiParam {String} id The record ID."), marker: "# @apiParam {String} id The record ID." },
    { title: "@apiSuccess — prose not directive", src: markerSrc("# @apiSuccess {Object} data The payload."), marker: "# @apiSuccess {Object} data The payload." },
    { title: "noquax — not a marker", src: markerSrc("# noquax"), marker: "# noquax" },
    { title: "pyre-unknown prefix — not a marker", src: markerSrc("# pyre-unknown"), marker: "# pyre-unknown" },
  ];

  for (const { title, src, marker } of NEG) {
    it(`${title} — directive false`, async () => {
      const cs = await classify(src);
      const c = cs.find(x => x.text === marker);
      expect(c, `comment "${marker}" not found`).toBeDefined();
      expect(c!.directive).toBe(false);
    });
  }

  it("trailing noqa IS directive true", async () => {
    const src = markerSrcTrailing("x = 1", "# noqa");
    const cs = await classify(src);
    const c = cs.find(x => x.text === "# noqa");
    expect(c, `"# noqa" not found`).toBeDefined();
    expect(c!.directive).toBe(true);
  });
});

describe("shebang — kept as directive", () => {
  it("#!/usr/bin/env python3 on line 0 → directive true", async () => {
    const src = "#!/usr/bin/env python3\nx = 1\n";
    const cs = await classify(src);
    const c = cs.find(x => x.text === "#!/usr/bin/env python3");
    expect(c, "shebang not found").toBeDefined();
    expect(c!.directive).toBe(true);
  });

  it("shebang survives stripComments alongside prose", async () => {
    const src = "#!/usr/bin/env python3\n# prose comment\nx = 1\n";
    const r = await comments(src);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(src, nonExempt);
    expect(stripped).toContain("#!/usr/bin/env python3");
    expect(stripped).not.toContain("# prose comment");
  });
});

describe("docstrings and string literals — 0 comments", () => {
  it('string literal "# not a comment" → 0 comments', async () => {
    const src = `x = "# not a comment"\n`;
    const r = await comments(src);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(0);
  });

  it("f-string with embedded # → 0 comments", async () => {
    const src = `msg = f"value is # {value}"\n`;
    const r = await comments(src);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments).toHaveLength(0);
  });

  it("module docstring with # inside → 0 comments from docstring", async () => {
    const src = `"""Module docstring.\n# This is not a comment.\n"""\nx = 1\n`;
    const r = await comments(src);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.some(c => c.text.includes("This is not a comment"))).toBe(false);
  });

  it("function docstring with # inside → no comment nodes from docstring", async () => {
    const src = `def compute():\n    """Compute result.\n    # internal note\n    """\n    return 0\n`;
    const r = await comments(src);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.some(c => c.text.includes("internal note"))).toBe(false);
  });
});

describe("stripComments — mixed sample identity", () => {
  const SHEBANG = "#!/usr/bin/env python3";
  const ENCODING = "# -*- coding: utf-8 -*-";
  const NOQA = "# noqa: E402";
  const TYPE_IGNORE = "# type: ignore[attr-defined]";
  const PYLINT = "# pylint: disable=invalid-name";
  const PRAGMA = "# pragma: no cover";
  const NOSEC = "# nosec";

  const PROSE_A = "# initialise the registry with default values";
  const PROSE_B = "# check for edge-case inputs before processing";
  const PROSE_C = "# return early if no records found";

  const MIXED = [
    `${SHEBANG}`,
    `${ENCODING}`,
    `import registry  ${NOQA}`,
    `${PROSE_A}`,
    `obj = registry.lookup()  ${TYPE_IGNORE}`,
    `${PROSE_B}`,
    `${PYLINT}`,
    `name = "example"`,
    `${PROSE_C}`,
    `def run():  ${PRAGMA}`,
    `    result = fetch()  ${NOSEC}`,
    `    return result`,
  ].join("\n") + "\n";

  it("all marker/shebang comments survive strip", async () => {
    const r = await comments(MIXED);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(MIXED, nonExempt);

    for (const kept of [SHEBANG, ENCODING, NOQA, TYPE_IGNORE, PYLINT, PRAGMA, NOSEC]) {
      expect(stripped, `expected "${kept}" to survive strip`).toContain(kept);
    }
  });

  it("prose comments are removed by strip", async () => {
    const r = await comments(MIXED);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(MIXED, nonExempt);

    for (const prose of [
      "initialise the registry with default values",
      "check for edge-case inputs before processing",
      "return early if no records found",
    ]) {
      expect(stripped, `expected prose "${prose}" to be removed`).not.toContain(prose);
    }
  });

  it("nonExempt set contains exactly the prose comments", async () => {
    const r = await comments(MIXED);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const proseTexts = r.comments.filter(c => !c.exempt).map(c => c.text);
    expect(proseTexts).toContain(PROSE_A);
    expect(proseTexts).toContain(PROSE_B);
    expect(proseTexts).toContain(PROSE_C);
    for (const kept of [SHEBANG, ENCODING]) {
      expect(proseTexts, `"${kept}" must not be in nonExempt`).not.toContain(kept);
    }
  });
});
