import { describe, it, expect } from "bun:test";
import { check } from "../../src/hooks/store-write-guard.js";

/**
 * Parse hook stdout safely.
 * Empty stdout is the allow-by-silence contract; treat it as permissionDecision:"allow"
 * so VIOLATION tests fail with "expected deny, got allow" instead of a SyntaxError.
 */
function safeDecision(result: { stdout: string; exit: number }): string {
  const s = result.stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch {
    return `parse-error(${s.slice(0, 60)})`;
  }
}

describe("store-write-guard — Family 2", () => {
  it("VIOLATION: Write to .groundwork/*.db → deny", () => {
    const result = check({ tool_name: "Write", tool_input: { file_path: "/repo/.groundwork/work.db", content: "x" } });
    expect(safeDecision(result)).toBe("deny");
  });

  it("VIOLATION: Edit to .groundwork/*.db → deny", () => {
    const result = check({ tool_name: "Edit", tool_input: { file_path: "/repo/.groundwork/work.db", old_string: "", new_string: "" } });
    expect(safeDecision(result)).toBe("deny");
  });

  it("VIOLATION: sqlite3 INSERT into store db → deny", () => {
    const result = check({ tool_name: "Bash", tool_input: { command: "sqlite3 .groundwork/work.db \"INSERT INTO slices VALUES ('x',1,'pending',NULL,NULL,NULL,NULL,'now',NULL)\"" } });
    expect(safeDecision(result)).toBe("deny");
  });

  it("VIOLATION: shell redirection into store db → deny", () => {
    const result = check({ tool_name: "Bash", tool_input: { command: "echo data > .groundwork/work.db" } });
    expect(safeDecision(result)).toBe("deny");
  });

  it("VIOLATION: rm of store db → deny", () => {
    const result = check({ tool_name: "Bash", tool_input: { command: "rm .groundwork/work.db" } });
    expect(safeDecision(result)).toBe("deny");
  });

  it("CLEAN: Write to non-db path → allow (empty stdout + exit 0)", () => {
    const result = check({ tool_name: "Write", tool_input: { file_path: "/repo/src/foo.ts", content: "x" } });
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("CLEAN: Bash reading db (no mutation) → allow (empty stdout + exit 0)", () => {
    const result = check({ tool_name: "Bash", tool_input: { command: "sqlite3 .groundwork/work.db 'SELECT * FROM slices'" } });
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("CLEAN: non-Bash non-Write tool → allow (empty stdout + exit 0)", () => {
    const result = check({ tool_name: "Read", tool_input: { file_path: ".groundwork/work.db" } });
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("GUARD-CAN-FAIL: path not matching STORE_PATH_RE → allow (proves guard is path-specific)", () => {
    const result = check({ tool_name: "Write", tool_input: { file_path: "/repo/src/store.ts", content: "x" } });
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("FALSE-POSITIVE FIX: cp whose SOURCE is the store db → allow (read, not write)", () => {
    const result = check({ tool_name: "Bash", tool_input: { command: "cp .groundwork/work.db /tmp/backup.db" } });
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("FALSE-POSITIVE FIX: printf that merely mentions cp+db inside quoted text → allow", () => {
    const result = check({ tool_name: "Bash", tool_input: { command: 'printf "see: cp /tmp/foo .groundwork/work.db" > ticket.md' } });
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("VIOLATION: cp whose DESTINATION is the store db → deny", () => {
    const result = check({ tool_name: "Bash", tool_input: { command: "cp /tmp/backup.db .groundwork/work.db" } });
    expect(safeDecision(result)).toBe("deny");
  });

  it("VIOLATION: mv involving the store db → deny", () => {
    const result = check({ tool_name: "Bash", tool_input: { command: "mv .groundwork/work.db /tmp/gone.db" } });
    expect(safeDecision(result)).toBe("deny");
  });
});
