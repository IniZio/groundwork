import type { Manifest } from "./manifest.mjs";

export interface RankedType {
  type: string;
  score: number;
}
export type WhereResult =
  | { kind: "type"; type: string; generates: string; instruction: string; description: string }
  | { kind: "unknown"; types: string[] }
  | { kind: "ranked"; ranked: { type: string; generates: string; instruction: string; score: number }[] };

export function renderStructure(manifest: Manifest, opts?: { maxLines?: number }): string[];
export function rankTypes(query: string, manifest: Manifest): RankedType[];
export function resolveWhere(query: string, manifest: Manifest): WhereResult;
export function fillBody(template: string, params: Record<string, string>, today: string): string;
export function scaffold(
  typeId: string,
  params: Record<string, string>,
  manifest: Manifest,
  today: string,
): { path: string; content: string };
