// Turns a port check's .cases.ts into a probe file so upstream judges every authored case. Usage: bun gen-case-probes.ts <cases.ts>...
import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: bun gen-case-probes.ts <check>.cases.ts...'); process.exit(2); }
for (const f of files) {
  const check = basename(f).replace(/\.cases\.ts$/, '');
  const { cases } = await import(resolve(f));
  const probes: Record<string, unknown>[] = [];
  for (const [kind, tag] of [['valid', 'v'], ['invalid', 'i']] as const) {
    cases[kind].forEach((c: { why: string; code?: string; filename?: string; findings?: unknown[]; options?: unknown }, i: number) => {
      if (typeof c.code !== 'string') return;
      if (c.options !== undefined) return;
      const p: Record<string, unknown> = { id: `pc-${check}-${tag}${String(i).padStart(3, '0')}`, check, code: c.code, upstreamExpect: `${c.findings ? c.findings.length : 0} per port case: ${c.why}`, src: 'probe' };
      if (c.filename) p.filename = c.filename;
      probes.push(p);
    });
  }
  const out = resolve(import.meta.dir, 'probes', `${check}.port-cases.json`);
  writeFileSync(out, JSON.stringify(probes, null, 2) + '\n');
  console.log(check, probes.length);
}
