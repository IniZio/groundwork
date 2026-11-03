import { describe, it, expect } from "bun:test";
import { findComments } from "../../src/hooks/lib/comment-density.js";

const CASES = {
  "several names on one ARG": [
    "FROM debian:bookworm-slim AS fetch",
    "ARG TARGETARCH",
    "ARG GH_VERSION GH_SHA256_AMD64 GH_SHA256_ARM64",
    "RUN echo $GH_VERSION",
  ].join("\n") + "\n",
  "ARG with an empty default": [
    "FROM debian:bookworm-slim",
    "# the release, empty leaves the build unstamped",
    "ARG APP_VERSION=",
    "RUN echo $APP_VERSION",
  ].join("\n") + "\n",
  "# and [ inside a continued RUN word": [
    "FROM debian:bookworm-slim",
    "ARG FEATURES=a,b",
    "RUN features=\"\"; \\",
    "    if [ -n \"$FEATURES\" ]; then features=\"$(echo \"$FEATURES\" | sed 's#\\([^,]\\+\\)#app/\\1#g')\"; fi; \\",
    "    echo $features",
    "# after the run",
    "USER nobody",
  ].join("\n") + "\n",
} satisfies Record<string, string>;

describe("dockerfile grammar parses valid Docker syntax", () => {
  for (const [name, text] of Object.entries(CASES)) {
    it(`${name}: no error rows, only line-start # lines are comments`, async () => {
      const r = await findComments(text, "dockerfile");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect([...r.errorRows]).toEqual([]);
      const lineStart = text.split("\n").flatMap((l, i) => (/^\s*#/.test(l) ? [i] : []));
      expect(r.comments.map((c) => c.startRow)).toEqual(lineStart);
    });
  }
});
