// Re-export OpenCode plugin from .opencode/plugins for backward compatibility
// @ts-expect-error — groundwork.js is a bundled JS plugin with no type declarations.
export { GroundworkPlugin, GroundworkPlugin as default } from "../.opencode/plugins/groundwork.js";
