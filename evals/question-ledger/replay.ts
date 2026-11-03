import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTranscript, questionLines, turns as turnsOf } from "../../src/hooks/question-ledger.ts";

const root = path.join(os.homedir(), ".claude", "projects");
let turns = 0;
const flagged: string[] = [];
let questionTurns = 0;

for (const proj of readdirSync(root)) {
  let files: string[];
  try { files = readdirSync(path.join(root, proj)).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
  for (const f of files) {
    for (const texts of turnsOf(parseTranscript(readFileSync(path.join(root, proj, f), "utf8")))) {
      turns++;
      const lines = texts.flatMap(questionLines);
      if (lines.length) { questionTurns++; flagged.push(...lines); }
    }
  }
}

console.log(`turns=${turns} question_turns=${questionTurns}`);
for (let i = 0; i < 20 && flagged.length; i++) console.log("-", flagged.splice(Math.floor(Math.random() * flagged.length), 1)[0]!.slice(0, 160));
