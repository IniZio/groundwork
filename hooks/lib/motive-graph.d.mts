// Type declarations for motive-graph.mjs

/** Canonical edge kinds for the motive graph. */
export declare const EDGE_KINDS: Record<string, string>

/**
 * Assemble the full motive graph surface for a given motive slug.
 * Reads from the journal, folds events, projects graph, and enriches with
 * charter and ground-truth data.
 *
 * @param opts.projectDir - Absolute project root.
 * @param opts.slug       - Motive slug.
 * @returns               The assembled motive graph object.
 */
export declare function assembleMotiveGraph(opts: { projectDir: string; slug: string }): Promise<object>
