import os from "node:os";
import path from "node:path";

export function getClaudeConfigDir(): string {
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (envDir) {
    return envDir.replace(/^~/, os.homedir()).replace(/\/$/, "");
  }
  return path.join(os.homedir(), ".claude");
}

export function getGroundworkStateDir(): string {
  return path.join(getClaudeConfigDir(), ".groundwork");
}
