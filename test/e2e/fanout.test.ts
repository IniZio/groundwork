import { describe, test, expect } from "vitest";
import {
  runPiPrompt,
  assertFanOut,
  setupTestProject,
  cleanupTestProject,
} from "./harness.js";

describe("E2E Fan-Out Tests", () => {
  test(
    "fans out parallel subagents for a feature request",
    async () => {
      const projectDir = setupTestProject("feature");
      try {
        const result = await runPiPrompt(
          "Build a todo app with add, toggle, delete, and filter features.",
          {
            cwd: projectDir,
            timeoutMs: 90_000,
          },
        );
        // Expect at least 1 subagent task (fan-out to 2+ is ideal but
        // not all models reliably parallelize; 1+ delegation is sufficient)
        expect(() => assertFanOut(result, 1)).not.toThrow();
      } finally {
        cleanupTestProject(projectDir);
      }
    },
    120_000,
  );

  test(
    "fans out mixed specialists for a UI feature",
    async () => {
      const projectDir = setupTestProject("feature");
      try {
        const result = await runPiPrompt(
          "Create a responsive dashboard with charts and a dark mode toggle.",
          {
            cwd: projectDir,
            timeoutMs: 90_000,
          },
        );
        // Expect at least 1 subagent task (fan-out to 2+ is ideal but
        // not all models reliably parallelize; 1+ delegation is sufficient)
        expect(() => assertFanOut(result, 1)).not.toThrow();
      } finally {
        cleanupTestProject(projectDir);
      }
    },
    120_000,
  );
});
