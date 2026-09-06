// This is a real line comment
/* block comment
   spanning lines */
const url = "http://example.com"; // not a comment inside string
const str = "// this is not a comment";
function foo(x: number): number {
  return x + 1; // increment
}
const re = /http:\/\/regex/; // regex with //
/**
 * JSDoc comment
 * @param x - the value
 */
export function bar(x: string): string {
  return x;
}
