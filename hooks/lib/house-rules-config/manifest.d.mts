export interface DocType {
  tier: "product" | "working" | "ephemeral";
  generates: string;
  description?: string;
  instruction?: string;
  template?: string | null;
  frontmatter?: Record<string, unknown>;
  headings?: string[];
}
export interface ForbiddenEntry {
  pattern: string;
  redirect: string;
}
export interface Manifest {
  govern?: string[];
  types?: Record<string, DocType>;
  forbidden?: ForbiddenEntry[];
}
export interface CompiledGenerates {
  template: string;
  params: { name: string; kase: string | null }[];
  match(path: string): Record<string, string> | null;
}
export interface NearestType {
  type: string;
  score: number;
  suggestion: string | null;
}
export function words(s: string): string[];
export function renderPath(template: string, params: Record<string, string>): string;
export function compileGenerates(template: string): CompiledGenerates;
export function matchPath(path: string, manifest: Manifest): { type: string; params: Record<string, string> } | null;
export function renderType(typeId: string, params: Record<string, string>, manifest: Manifest): string;
export function nearestTypes(path: string, manifest: Manifest, n: number): NearestType[];
export function inTypedArea(path: string, manifest: Manifest): boolean;
export function forbiddenRedirect(path: string, manifest: Manifest): string | null;
