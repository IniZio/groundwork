import { tool } from "@opencode-ai/plugin"
import path from "path"
import { readFile } from "fs/promises"

function findFeBin(): string {
  if (process.env.FE_BIN) return process.env.FE_BIN

  const candidates = [
    path.join(
      process.env.HOME || "~",
      ".config/opencode/fast-edit-rs/target/release/fe",
    ),
    path.join(
      process.env.HOME || "~",
      ".local/bin/fe",
    ),
  ]

  for (const candidate of candidates) {
    try {
      const stat = Bun.file(candidate)
      if (stat.size > 0) return candidate
    } catch {}
  }

  return "fe"
}

const FE_BIN = findFeBin()

function findLineRange(
  fileContent: string,
  oldString: string,
): { start: number; end: number } {
  const idx = fileContent.indexOf(oldString)
  if (idx === -1) {
    throw new Error("oldString not found in file content")
  }

  const secondIdx = fileContent.indexOf(oldString, idx + 1)
  if (secondIdx !== -1) {
    throw new Error(
      "oldString found multiple times — provide more context to make it unique, or use replaceAll",
    )
  }

  const beforeMatch = fileContent.slice(0, idx)
  const startLine = beforeMatch.split("\n").length
  const matchLines = oldString.split("\n")
  const endLine = startLine + matchLines.length - 1

  return { start: startLine, end: endLine }
}

export default tool({
  description:
    "[fast-edit] Fast, line-number-based file editing with automatic backups. " +
    "Performs exact string replacements in files. The oldString must match exactly " +
    "in the file. Use replaceAll to replace every occurrence. " +
    "Read the file first before editing. " +
    "Provides automatic backups before every mutation, line-number precision (no fuzzy matching), " +
    "better performance for large files, and shell-safe operations. " +
    "STOP: If you need to replace a large block (>80 lines) with repetitive/structured content, " +
    "do NOT output the full newString here — you will waste tokens. " +
    "Instead: skill('fast-edit'), then use `fe fast-batch --stdin` or `fe fast-generate` via Bash.",
  args: {
    filePath: tool.schema
      .string()
      .describe("Absolute path to the file to modify"),
    oldString: tool.schema.string().describe("The exact text to find and replace"),
    newString: tool.schema
      .string()
      .describe("The replacement text (must differ from oldString)"),
    replaceAll: tool.schema
      .boolean()
      .optional()
      .describe("Replace all occurrences (default: false)"),
  },
  async execute(args, context) {
    const { filePath, oldString, newString, replaceAll } = args
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.directory, filePath)

    if (oldString === newString) {
      throw new Error("oldString and newString are identical — no change needed")
    }

    let fileContent: string
    try {
      fileContent = await readFile(resolvedPath, "utf-8")
    } catch (e: any) {
      throw new Error(`Cannot read file ${resolvedPath}: ${e.message}`)
    }

    if (replaceAll) {
      if (!fileContent.includes(oldString)) {
        throw new Error("oldString not found in file content")
      }
      const updated = fileContent.split(oldString).join(newString)
      const count = fileContent.split(oldString).length - 1

      const proc = Bun.spawn(
        [FE_BIN, "fast-paste", resolvedPath, "--stdin"],
        { stdin: new Blob([updated]), stdout: "pipe", stderr: "pipe" },
      )

      const exitCode = await proc.exited
      const stderr = await new Response(proc.stderr).text()
      if (exitCode !== 0) {
        await Bun.write(resolvedPath, updated)
        return `Replaced ${count} occurrences in ${resolvedPath} (direct write)`
      }
      return `Replaced ${count} occurrences of oldString in ${resolvedPath}`
    }

    const { start, end } = findLineRange(fileContent, oldString)

    const batchSpec = {
      file: resolvedPath,
      edits: [
        {
          action: "replace-lines",
          start,
          end,
          content: newString.endsWith("\n") ? newString : newString + "\n",
        },
      ],
    }

    const proc = Bun.spawn(
      [FE_BIN, "fast-batch", "--stdin"],
      { stdin: new Blob([JSON.stringify(batchSpec)]), stdout: "pipe", stderr: "pipe" },
    )

    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()

    if (exitCode !== 0) {
      const updated = fileContent.replace(oldString, newString)
      await Bun.write(resolvedPath, updated)
      return `Edited ${resolvedPath} lines ${start}-${end} (direct write, fe error: ${stderr.trim()})`
    }

    try {
      const result = JSON.parse(stdout)
      const warnings = result.warnings || result.results?.[0]?.warnings || []
      const warningMsg =
        warnings.length > 0
          ? `\n⚠️ Warnings: ${warnings.join("; ")}`
          : ""
      const backup = result.backup || result.results?.[0]?.backup || ""
      const backupMsg = backup ? ` (backup: ${path.basename(backup)})` : ""
      return `Edited ${resolvedPath} lines ${start}-${end}${backupMsg}${warningMsg}`
    } catch {
      return stdout.trim() || `Edited ${resolvedPath} lines ${start}-${end}`
    }
  },
})
