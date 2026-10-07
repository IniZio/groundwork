import { writeFileSync } from "node:fs";
import { DOC, computeBytes, readDoc, renderDoc } from "../src/instructions/budget.js";

const before = readDoc();
const after = renderDoc(before, computeBytes());
if (after !== before) writeFileSync(DOC, after);
console.log(after === before ? "budget rows already current" : "budget rows updated");
