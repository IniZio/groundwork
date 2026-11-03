import type { ProjectFacts } from '../../src/engine/project-deps.js';

/** Package name to the name a message shows, in the order messages list them. */
const KNOWN_VALIDATORS: ReadonlyArray<readonly [pkg: string, shown: string]> = [
  ['ajv', 'ajv'],
  ['zod', 'zod'],
  ['valibot', 'valibot'],
  ['@sinclair/typebox', '@sinclair/typebox'],
  ['effect', 'Schema from effect'],
  ['yup', 'yup'],
  ['joi', 'joi'],
];

/** Validators the project depends on, as shown in messages; empty when none or when there is no package.json. */
export function projectValidators(project: ProjectFacts | undefined): string[] {
  return KNOWN_VALIDATORS.flatMap(([pkg, shown]) => (project?.dependencies.has(pkg) ? [shown] : []));
}

export function orList(names: readonly string[]): string {
  return names.length <= 2 ? names.join(' or ') : `${names.slice(0, -1).join(', ')}, or ${names.at(-1)}`;
}

/** Noun phrase naming what to parse with, readable in any sentence position. */
export function parseWith(project: ProjectFacts | undefined): string {
  const found = projectValidators(project);
  if (found.length === 0) return 'a validator (add one if this project has none; ajv is a common choice)';
  return `${orList(found)} (this project already depends on ${found.length === 1 ? 'it' : 'them'})`;
}
