// Type declarations for groundwork-resolver.mjs

/**
 * Returns the absolute path to groundwork's hooks/lib directory.
 * Pass this to renderCommitMsgHook() as `hooksLibPath`.
 */
export declare function getHooksLibPath(): string

/**
 * Returns the absolute path to the groundwork root (repo/plugin directory).
 * The root contains hooks/, src/, agents/, etc.
 */
export declare function getGroundworkRoot(): string
