import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { autoFix } from "../../src/hooks/lib/comment-density.js";

function removableBlock(n: number): string {
  return Array.from({ length: n }, (_, i) => `\t// narration prose comment ${i}`).join("\n");
}

const goPath = spawnSync("which", ["go"], { encoding: "utf8" }).stdout.trim();
const goAvailable = goPath.length > 0 && spawnSync(goPath, ["env", "CGO_ENABLED"], { encoding: "utf8" }).stdout.trim() === "1";

const MIXED_PREAMBLE_SRC = `package main

// #define WIDTH 3
/*
static int width(void) { return WIDTH; }
*/
import "C"

import "fmt"

func main() {
\tfmt.Println(C.width())
${removableBlock(40)}
}
`;

describe("go-cgo-build: mixed preamble survives autoFix and go build", () => {
  it("autoFix preserves mixed cgo preamble", async () => {
    const lines = MIXED_PREAMBLE_SRC.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await autoFix(MIXED_PREAMBLE_SRC, "go", addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toContain("// #define WIDTH 3");
    expect(r.fixed).toContain("static int width(void) { return WIDTH; }");
    expect(r.fixed).toContain('import "C"');
  });

  it.skipIf(!goAvailable)("go build succeeds after autoFix on mixed cgo preamble", async () => {
    const lines = MIXED_PREAMBLE_SRC.split("\n");
    const addedRows = new Set(lines.map((_, i) => i));
    const r = await autoFix(MIXED_PREAMBLE_SRC, "go", addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);

    const tmpDir = join("/dev/shm", `go-cgo-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      writeFileSync(join(tmpDir, "go.mod"), "module cgobuildtest\ngo 1.21\n");
      writeFileSync(join(tmpDir, "main.go"), r.fixed);

      const buildResult = spawnSync(goPath, ["build", "."], {
        cwd: tmpDir,
        encoding: "utf8",
        env: { ...process.env, CGO_ENABLED: "1" },
      });
      if (buildResult.status !== 0) {
        throw new Error(`go build failed:\n${buildResult.stderr}\n\nfixed source:\n${r.fixed}`);
      }
      expect(buildResult.status).toBe(0);

      const vetResult = spawnSync(goPath, ["vet", "."], {
        cwd: tmpDir,
        encoding: "utf8",
        env: { ...process.env, CGO_ENABLED: "1" },
      });
      expect(vetResult.status).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
