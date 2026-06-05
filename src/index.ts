// Re-export OpenCode plugin from .opencode/plugins for backward compatibility
// @ts-expect-error — JS file without declaration
export {
	GroundworkPlugin,
	GroundworkPlugin as default,
} from "../.opencode/plugins/groundwork.js";
