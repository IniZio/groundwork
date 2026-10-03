/** Bun test preload: keep tests from writing to the real system log. Set in place, never reassign process.env. */
process.env.GROUNDWORK_NOTIFY = "off";
