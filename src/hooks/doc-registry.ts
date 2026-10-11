export type DocTypeId =
  | "motive"
  | "spec"
  | "ticket"
  | "map"
  | "research"
  | "plan"
  | "design"
  | "handoff"
  | "evidence"
  | "out-of-scope"
  | "lessons"
  | "adr"
  | "pr-body";

// Deliberately tiny subset: a hand-written validator supports only these keywords.
export interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  enum?: string[];
  items?: JsonSchema;
  const?: string;
  pattern?: string;
  format?: "date";
  if?: JsonSchema;
  then?: JsonSchema;
  oneOf?: JsonSchema[];
}

export interface DocType {
  tier: "working" | "product";
  generates: string;
  description: string;
  instruction: string;
  template: string | null;
  frontmatter: JsonSchema;
  headings: string[];
}

export interface ForbiddenPattern {
  pattern: string;
  redirect: string;
}

const W = ".groundwork/work/{slug}";
const tpl = (id: DocTypeId) => `templates/doc-types/${id}.md`;
const anyObject: JsonSchema = { type: "object" };

export const WORKING_TYPES: Record<DocTypeId, DocType> = {
  motive: {
    tier: "working",
    generates: `${W}/motive.md`,
    description: "Agent view of the charter: objective, decisions, open questions",
    instruction: "One per unit of work; record decisions via $GW event append; holds AC and agent detail",
    template: tpl("motive"),
    frontmatter: {
      type: "object",
      required: ["created", "status"],
      properties: {
        created: { type: "string", format: "date" },
        status: { enum: ["active", "complete", "abandoned"] },
      },
    },
    headings: ["Objective", "Decisions", "Open questions"],
  },
  spec: {
    tier: "working",
    generates: `${W}/spec.md`,
    description: "Agent view of the spec: requirements and AC, folded into durable docs",
    instruction: "Set folds_into to the durable doc, or none with a reason; holds AC",
    template: tpl("spec"),
    frontmatter: {
      type: "object",
      required: ["folds_into"],
      properties: { folds_into: { type: "string" }, reason: { type: "string" } },
      if: { properties: { folds_into: { const: "none" } }, required: ["folds_into"] },
      then: { required: ["reason"] },
    },
    headings: ["Purpose", "Requirements"],
  },
  ticket: {
    tier: "working",
    generates: `${W}/tickets/{nn}-{name:kebab}.md`,
    description: "Agent view of one actionable task, holds acceptance criteria",
    instruction: "Number tickets with a two-digit prefix; holds AC",
    template: tpl("ticket"),
    frontmatter: anyObject,
    headings: ["Goal", "Acceptance criteria"],
  },
  map: {
    tier: "working",
    generates: `${W}/map.md`,
    description: "Overview map of the work and its parts",
    instruction: "Keep to a short overview; link tickets and docs",
    template: tpl("map"),
    frontmatter: anyObject,
    headings: ["Overview"],
  },
  research: {
    tier: "working",
    generates: `${W}/research/{name:kebab}.md`,
    description: "Investigation of one question with graded confidence",
    instruction: "State the question and confidence in frontmatter",
    template: tpl("research"),
    frontmatter: {
      type: "object",
      required: ["question", "confidence"],
      properties: {
        question: { type: "string" },
        confidence: { enum: ["low", "medium", "high"] },
      },
    },
    headings: ["Question", "Findings"],
  },
  plan: {
    tier: "working",
    generates: `${W}/plan.md`,
    description: "Ordered steps to deliver the work",
    instruction: "List steps; update as the work changes",
    template: tpl("plan"),
    frontmatter: anyObject,
    headings: ["Steps"],
  },
  design: {
    tier: "working",
    generates: `${W}/design.md`,
    description: "Agent view of the design: context and chosen approach",
    instruction: "Explain context first, then the design; holds agent detail and AC",
    template: tpl("design"),
    frontmatter: anyObject,
    headings: ["Context", "Design"],
  },
  handoff: {
    tier: "working",
    generates: `${W}/handoff.md`,
    description: "State for the next session: done and next",
    instruction: "Write when pausing so a successor can resume",
    template: tpl("handoff"),
    frontmatter: anyObject,
    headings: ["Done", "Next"],
  },
  evidence: {
    tier: "working",
    generates: `${W}/evidence/{name:kebab}.md`,
    description: "Captured proof that a requirement is met",
    instruction: "One file per proof; no template",
    template: null,
    frontmatter: anyObject,
    headings: ["Evidence"],
  },
  "out-of-scope": {
    tier: "working",
    generates: `${W}/out-of-scope.md`,
    description: "Ideas and requests deliberately not done",
    instruction: "Record rejected scope here, not in .out-of-scope/",
    template: tpl("out-of-scope"),
    frontmatter: anyObject,
    headings: ["Out of scope"],
  },
  lessons: {
    tier: "working",
    generates: `${W}/lessons.md`,
    description: "Lessons learned during the work",
    instruction: "Capture lessons here, not in a lessons/ folder",
    template: tpl("lessons"),
    frontmatter: anyObject,
    headings: ["Lessons"],
  },
  adr: {
    tier: "working",
    generates: ".groundwork/adr/{nnnn}-{name:kebab}.md",
    description: "Agent-view decision record that can span motives: context, decision, rejected alternatives",
    instruction:
      "Number with a four-digit prefix; link it from a DECISION event via $GW event append --type DECISION --data '{\"adr\":\"<path>\"}'; supersede an accepted record instead of editing it",
    template: tpl("adr"),
    frontmatter: {
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["accepted", "superseded"] },
        superseded_by: { type: "string" },
        date: { type: "string", format: "date" },
        supersedes: { type: "array", items: { type: "string" } },
      },
      if: { properties: { status: { const: "superseded" } }, required: ["status"] },
      then: { required: ["superseded_by"] },
    },
    headings: ["Context", "Decision", "Rejected alternatives", "Consequences"],
  },
  "pr-body": {
    tier: "working",
    generates: `${W}/pr-body.md`,
    description: "Draft PR body: the human view of this change, reviewed before implementation and published as the PR description",
    instruction: "Only what could flip a reviewer's yes/no; Why, Changes and Impact are approved at H1/H2, so fill Review focus and Proof as work lands",
    template: tpl("pr-body"),
    frontmatter: { type: "object" },
    headings: ["Why", "Changes", "Impact", "Review focus", "Proof"],
  },
};

export const FORBIDDEN: ForbiddenPattern[] = [
  { pattern: "**/doc/adr/**", redirect: "Agent-view decision records go in `.groundwork/adr/{nnnn}-{name:kebab}.md`; link with `$GW event append --type DECISION --data '{\"adr\":\"<path>\"}'`" },
  { pattern: "**/docs/adr/**", redirect: "Agent-view decision records go in `.groundwork/adr/{nnnn}-{name:kebab}.md`; link with `$GW event append --type DECISION --data '{\"adr\":\"<path>\"}'`" },
  { pattern: ".scratch/**", redirect: "Use `.groundwork/work/{slug}/`" },
  { pattern: ".out-of-scope/**", redirect: "Use `.groundwork/work/{slug}/out-of-scope.md`" },
  { pattern: "lessons/**", redirect: "Use `.groundwork/work/{slug}/lessons.md`" },
  { pattern: "learning-records/**", redirect: "Use `.groundwork/work/{slug}/lessons.md`" },
  { pattern: "to-questionnaire-*.md", redirect: "Use `.groundwork/work/{slug}/`" },
  { pattern: "**/to-questionnaire-*.md", redirect: "Use `.groundwork/work/{slug}/`" },
  { pattern: "doc/*/motive.md", redirect: "doc/ describes the current code only; draft change intent in `.groundwork/work/{slug}/pr-body.md`" },
  { pattern: "doc/*/spec.md", redirect: "doc/ describes the current code only; draft change intent in `.groundwork/work/{slug}/pr-body.md`" },
  { pattern: "doc/*/tickets/**", redirect: "doc/ describes the current code only; draft change intent in `.groundwork/work/{slug}/pr-body.md`" },
];

const words = (s: string) => s.split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).map((w) => w.toLowerCase());
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

const CASES: Record<string, (v: string) => string> = {
  kebab: (v) => words(v).join("-"),
  camel: (v) => words(v).map((w, i) => (i ? cap(w) : w)).join(""),
  pascal: (v) => words(v).map(cap).join(""),
};

export function resolveDocPath(id: DocTypeId, params: Record<string, string>): string {
  return WORKING_TYPES[id].generates.replace(/\{(\w+)(?::(\w+))?\}/g, (_m, key: string, kase?: string) => {
    const v = params[key];
    if (v === undefined) throw new Error(`resolveDocPath(${id}): missing param "${key}"`);
    if (!kase) return v;
    const fn = CASES[kase];
    if (!fn) throw new Error(`resolveDocPath(${id}): unknown case "${kase}"`);
    return fn(v);
  });
}
