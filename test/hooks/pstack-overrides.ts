export interface Override {
  from: string;
  to: string;
  why: string;
}

/** Deliberate departures of agents/worker.md from pstack's poteto-agent body. */
export const OVERRIDES: Override[] = [
  {
    from:
      "Use the absolute path your parent gave you. With no path, before any other work, search `~/.cursor/plugins/` for a file whose path ends in `skills/poteto-mode/SKILL.md`. If more than one file matches, use the copy whose `.cursor-plugin/plugin.json` has the highest `version`. Your skill catalog hides this skill, so a missing catalog entry does not mean pstack is absent. If no such file exists, stop and tell your parent.",
    to: "Use the absolute path on the `poteto-mode SKILL.md:` line at the end of your brief. Your skill catalog hides this skill, so a missing catalog entry does not mean pstack is absent. If that line is missing, stop and tell your parent.",
    why: "pstack searches ~/.cursor, which does not exist under Claude Code; the spawn guard appends the path instead.",
  },
];

/** Applies every override; throws if an override's `from` text is absent from the body. */
export function applyOverrides(body: string, overrides: Override[] = OVERRIDES): string {
  let out = body;
  for (const o of overrides) {
    if (!out.includes(o.from)) throw new Error(`stale override, text not in pstack body: ${o.from.slice(0, 60)}`);
    out = out.replace(o.from, () => o.to);
  }
  return out;
}
