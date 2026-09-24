import { getParser } from "./tree-sitter-loader.js";

const result = await getParser("bash");
if (!result.ok) {
  process.stderr.write(`FAIL: ${result.reason}\n`);
  process.exit(1);
}
const { parser } = result;
const tree = parser.parse("#!/bin/bash\n# probe comment\necho 'hi'");
let commentCount = 0;
function walk(node: import("./tree-sitter.js").Node): void {
  if (node.type.includes("comment")) commentCount++;
  for (let i = 0; i < node.childCount; i++) walk(node.child(i)!);
}
walk(tree.rootNode);
process.stdout.write(`OK comments=${commentCount}\n`);
