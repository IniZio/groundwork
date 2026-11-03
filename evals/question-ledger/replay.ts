import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { questionLines } from "../../src/hooks/question-ledger.ts";

const root = path.join(os.homedir(), ".claude", "projects");
let turns = 0;
const flagged: string[] = [];
let questionTurns = 0;

function genuine(e: any): boolean {
  const c = e.message?.content;
  if (typeof c === "string") return !c.trimStart().startsWith("<");
  return Array.isArray(c) && c.some((b: any) => b?.type === "text" && typeof b.text === "string" && !b.text.trimStart().startsWith("<"));
}

function flush(texts: string[]) {
  if (texts.length === 0) return;
  turns++;
  const lines = texts.flatMap(questionLines);
  if (lines.length) { questionTurns++; flagged.push(...lines); }
}

for (const proj of readdirSync(root)) {
  let files: string[];
  try { files = readdirSync(path.join(root, proj)).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
  for (const f of files) {
    let texts: string[] = [];
    for (const l of readFileSync(path.join(root, proj, f), "utf8").split("\n")) {
      if (!l) continue;
      let e: any;
      try { e = JSON.parse(l); } catch { continue; }
      if (e.isSidechain === true) continue;
      if (e.type === "user" && genuine(e)) { flush(texts); texts = []; }
      else if (e.type === "assistant" && Array.isArray(e.message?.content)) {
        for (const b of e.message.content) if (b?.type === "text" && typeof b.text === "string") texts.push(b.text);
      }
    }
    flush(texts);
  }
}

console.log(`turns=${turns} question_turns=${questionTurns}`);
for (let i = 0; i < 20 && flagged.length; i++) console.log("-", flagged.splice(Math.floor(Math.random() * flagged.length), 1)[0]!.slice(0, 160));
