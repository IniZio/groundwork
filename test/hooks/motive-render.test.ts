import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderView, buildHumanLayer } from '../../hooks/lib/motive-render.mjs';
import { compile } from '../../hooks/lib/motive-compile.mjs';
import { renderHtml } from '../../hooks/lib/motive-html.mjs';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeView(overrides: Record<string, unknown> = {}) {
  return {
    human: {
      title: 'Implement motive-render',
      banner: '✓ No divergence: log and repo agree at abc1234 on main.',
      narrative_sections: [
        { title: 'Objective', source: 'recorded:MOTIVE_START', content: 'Ship the renderer.' },
        { title: 'Progress', source: 'reconstructed:TASK_COMPLETE', content: 'S4 complete.' },
        { title: 'Rationale', source: 'absent', content: null },
        { title: 'Trouble', source: 'absent', content: null },
        { title: 'Verdict', source: 'recorded:SESSION_END', content: 'Approved.' },
        { title: 'Handoff', source: 'absent', content: null },
      ],
      divergence_findings: [],
      timeline: [],
      drift_warnings: [],
      spec_changes: [],
      ...((overrides.human as Record<string, unknown>) ?? {}),
    },
    agent: {
      objective: 'Ship the renderer.',
      confidence: 'high',
      ...((overrides.agent as Record<string, unknown>) ?? {}),
    },
    provenance: {
      compiler_version: '1.0.0',
      motive: 'test-motive',
      at_ord: 42,
      ...((overrides.provenance as Record<string, unknown>) ?? {}),
    },
  };
}

// ── S4-AC1: Banner is the first content line ──────────────────────────────────

describe('S4-AC1: banner-first', () => {
  it('banner appears before title when no divergence', () => {
    const view = makeView();
    const out = renderView(view);
    const lines = out.split('\n');
    // First non-comment, non-blank line should be the banner
    const contentLines = lines.filter((l: string) => !l.startsWith('<!--') && l.trim() !== '');
    expect(contentLines[0]).toBe('✓ No divergence: log and repo agree at abc1234 on main.');
    // Title comes after banner
    const bannerIdx = contentLines.findIndex((l: string) => l.startsWith('✓'));
    const titleIdx = contentLines.findIndex((l: string) => l.startsWith('# '));
    expect(bannerIdx).toBeLessThan(titleIdx);
  });

  it('renders the "not checked" banner state first', () => {
    const view = makeView({
      human: {
        banner: '⚠ GROUND TRUTH NOT CHECKED — this view has not been compared against the repo.',
      },
    });
    const out = renderView(view);
    const contentLines = out.split('\n').filter((l: string) => !l.startsWith('<!--') && l.trim() !== '');
    expect(contentLines[0]).toContain('GROUND TRUTH NOT CHECKED');
  });

  it('renders the "divergence found" banner state first', () => {
    const banner = '⚠ DIVERGENCE: 2 finding(s) (1 high, 1 medium) — the log and the repo disagree. Trust the repo.';
    const view = makeView({ human: { banner } });
    const out = renderView(view);
    const contentLines = out.split('\n').filter((l: string) => !l.startsWith('<!--') && l.trim() !== '');
    expect(contentLines[0]).toBe(banner);
    const bannerIdx = contentLines.findIndex((l: string) => l.includes('DIVERGENCE'));
    const titleIdx = contentLines.findIndex((l: string) => l.startsWith('# '));
    expect(bannerIdx).toBeLessThan(titleIdx);
  });
});

// ── S4-AC2: source: labels and visual distinction ─────────────────────────────

describe('S4-AC2: source labels', () => {
  it('every narrative section has a source: label in output', () => {
    const out = renderView(makeView());
    const sections = ['Objective', 'Progress', 'Rationale', 'Trouble', 'Verdict', 'Handoff'];
    for (const title of sections) {
      // Each section heading should be followed (somewhere in the section) by "source:"
      const idx = out.indexOf(`## ${title}`);
      expect(idx).toBeGreaterThanOrEqual(0);
      const afterSection = out.slice(idx, idx + 300);
      expect(afterSection).toContain('source:');
    }
  });

  it('recorded: sections are bold (**source:…**)', () => {
    const out = renderView(makeView());
    expect(out).toContain('**source: recorded:MOTIVE_START**');
    expect(out).toContain('**source: recorded:SESSION_END**');
  });

  it('reconstructed: sections are italic (_source:…_)', () => {
    const out = renderView(makeView());
    expect(out).toContain('_source: reconstructed:TASK_COMPLETE_');
  });

  it('absent sections use italic source label', () => {
    const out = renderView(makeView());
    // Rationale is absent
    const ratIdx = out.indexOf('## Rationale');
    const afterRat = out.slice(ratIdx, ratIdx + 200);
    expect(afterRat).toContain('_source: absent_');
  });
});

// ── S4-AC3: absent sections render explicit absence sentence ──────────────────

describe('S4-AC3: explicit absence statements', () => {
  it('absent sections render an explicit sentence, not empty', () => {
    const out = renderView(makeView());
    // Rationale, Trouble, Handoff are absent
    expect(out).toContain('_No rationale was recorded for this motive._');
    expect(out).toContain('_No trouble was recorded for this motive._');
    expect(out).toContain('_No handoff was recorded for this motive._');
  });

  it('absent sections do not produce empty ##-section bodies', () => {
    const out = renderView(makeView());
    // No two consecutive ## headings without content between
    const lines = out.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith('## ')) {
        // Next non-blank line should not be another ## heading
        const nextNonBlank = lines.slice(i + 1).find((l: string) => l.trim() !== '');
        if (nextNonBlank) {
          expect(nextNonBlank.startsWith('## ')).toBe(false);
        }
      }
    }
  });
});

// ── S4-AC4: pure Markdown output ─────────────────────────────────────────────

describe('S4-AC4: pure Markdown', () => {
  it('contains DO NOT EDIT marker', () => {
    const out = renderView(makeView());
    expect(out).toContain('DO NOT EDIT');
  });

  it('has no ANSI escape sequences', () => {
    const out = renderView(makeView());
    // ESC character
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('has no box-drawing characters', () => {
    const out = renderView(makeView());
    // Box-drawing unicode block U+2500–U+257F
    expect(out).not.toMatch(/[─-╿]/);
  });
});

// ── S4-AC5: pure function — determinism and no impure references ──────────────

describe('S4-AC5: purity', () => {
  it('20 renders of the same view are byte-identical', () => {
    const view = makeView();
    const first = renderView(view);
    for (let i = 1; i < 20; i++) {
      expect(renderView(view)).toBe(first);
    }
  });

  it('module source has no Date, fs, or process references', () => {
    const src = readFileSync(
      new URL('../../hooks/lib/motive-render.mjs', import.meta.url),
      'utf8'
    );
    // Strip comment lines, then check for impure globals (S4-AC5)
    const nonCommentSrc = src
      .split('\n')
      .filter((l: string) => !/^\s*\/\//.test(l))
      .join('\n');
    expect(nonCommentSrc).not.toMatch(/\bDate\b/);
    expect(nonCommentSrc).not.toMatch(/\bprocess\b/);
    expect(nonCommentSrc).not.toMatch(/\bfs\b/);
  });

  it('module has no import statements (zero imports)', () => {
    const src = readFileSync(
      new URL('../../hooks/lib/motive-render.mjs', import.meta.url),
      'utf8'
    );
    const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
    expect(importLines).toHaveLength(0);
  });
});

// ── Divergence findings rendering ─────────────────────────────────────────────

describe('divergence findings', () => {
  it('renders findings sorted: high before medium before info', () => {
    const view = makeView({
      human: {
        divergence_findings: [
          { severity: 'info', kind: 'head_not_recorded', detail: 'No sha.' },
          { severity: 'high', kind: 'slice_state_mismatch', path: 'S1', detail: 'Mismatch.' },
          { severity: 'medium', kind: 'no_ledger', detail: 'No ledger.' },
        ],
      },
    });
    const out = renderView(view);
    const highIdx = out.indexOf('[high]');
    const medIdx = out.indexOf('[medium]');
    const infoIdx = out.indexOf('[info]');
    expect(highIdx).toBeLessThan(medIdx);
    expect(medIdx).toBeLessThan(infoIdx);
  });

  it('does not render Divergence Findings section when list is empty', () => {
    const out = renderView(makeView());
    expect(out).not.toContain('## Divergence Findings');
  });
});

// ── Provenance meta line ──────────────────────────────────────────────────────

describe('meta line', () => {
  it('includes compiler_version, at_ord, and confidence', () => {
    const out = renderView(makeView());
    expect(out).toContain('compiler: 1.0.0');
    expect(out).toContain('at: 42');
    expect(out).toContain('confidence: high');
  });

  it('renders at_ord as HEAD when null', () => {
    const view = makeView({ provenance: { at_ord: null } });
    const out = renderView(view);
    expect(out).toContain('at: HEAD');
  });
});

// ── Integration: renderView(compile(events)) must not crash ───────────────────

describe('integration: renderView accepts compile() output directly', () => {
  // Minimal event array — no events, just an empty stream for the motive.
  const EMPTY_EVENTS: unknown[] = [];

  it('renderView(compile(events)) produces markdown without crashing', () => {
    const view = compile(EMPTY_EVENTS, {});
    // compile() sets human:null — renderView must build the human layer itself
    expect(view.human).toBeNull();
    const out = renderView(view as Parameters<typeof renderView>[0]);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('DO NOT EDIT');
  });

  it('banner is the first content line when compile() output is fed directly', () => {
    const view = compile(EMPTY_EVENTS, {});
    const out = renderView(view as Parameters<typeof renderView>[0]);
    const contentLines = out.split('\n').filter((l: string) => !l.startsWith('<!--') && l.trim() !== '');
    // First content line must be a banner (starts with ✓ or ⚠)
    expect(contentLines[0]).toMatch(/^[✓⚠]/);
    // Title (# …) comes after the banner
    const bannerIdx = contentLines.findIndex((l: string) => /^[✓⚠]/.test(l));
    const titleIdx = contentLines.findIndex((l: string) => l.startsWith('# '));
    expect(bannerIdx).toBeLessThan(titleIdx);
  });

  it('all 6 narrative sections are present (absent ones have explicit sentence)', () => {
    const view = compile(EMPTY_EVENTS, {});
    const out = renderView(view as Parameters<typeof renderView>[0]);
    for (const title of ['Objective', 'Progress', 'Rationale', 'Trouble', 'Verdict', 'Handoff']) {
      expect(out).toContain(`## ${title}`);
      expect(out).toContain('source:');
    }
    // All absent sections have explicit absence text
    expect(out).toMatch(/_No .+ was recorded for this motive\._/);
  });

  it('buildHumanLayer is exported and produces the human-layer fields', () => {
    const view = compile(EMPTY_EVENTS, {});
    const human = buildHumanLayer(view as Parameters<typeof buildHumanLayer>[0]);
    expect(human).toHaveProperty('title');
    expect(human).toHaveProperty('banner');
    expect(human).toHaveProperty('narrative_sections');
    expect(Array.isArray(human.narrative_sections)).toBe(true);
    expect(human.narrative_sections).toHaveLength(6);
    // Every section must have a source label
    for (const s of human.narrative_sections) {
      expect(s).toHaveProperty('source');
      expect(typeof s.source).toBe('string');
    }
  });

  it('20 renders of compile() output are byte-identical', () => {
    const view = compile(EMPTY_EVENTS, {});
    const first = renderView(view as Parameters<typeof renderView>[0]);
    for (let i = 1; i < 20; i++) {
      expect(renderView(view as Parameters<typeof renderView>[0])).toBe(first);
    }
  });
});

// ── Fix: Trouble section — no dangling colon when last_error is empty ─────────

describe('Trouble section: dangling colon fix (fix-2)', () => {
  it('omits the colon separator when last_error is null', () => {
    // Build from agent.failures via buildHumanLayer path
    const view = {
      human: null as unknown,
      agent: {
        objective: 'test',
        confidence: 'low' as const,
        failures: [{ target: 'my-task', attempts: 2, resolved: false, last_error: null }],
      },
      provenance: { compiler_version: '1.0.0', motive: 'test-motive', at_ord: 0 },
    };
    const out = renderView(view as Parameters<typeof renderView>[0]);
    // Must NOT end the line with ': ' (dangling colon)
    expect(out).not.toMatch(/attempt\(s\):\s*$/m);
    // Must contain the entry without a trailing colon
    expect(out).toContain('attempt(s))');
  });

  it('omits the colon separator when last_error is empty string', () => {
    const view = {
      human: null as unknown,
      agent: {
        objective: 'test',
        confidence: 'low' as const,
        failures: [{ target: 'my-task', attempts: 1, resolved: false, last_error: '' }],
      },
      provenance: { compiler_version: '1.0.0', motive: 'test-motive', at_ord: 0 },
    };
    const out = renderView(view as Parameters<typeof renderView>[0]);
    expect(out).not.toMatch(/attempt\(s\):\s*$/m);
  });

  it('includes the colon and message when last_error is non-empty', () => {
    const view = {
      human: null as unknown,
      agent: {
        objective: 'test',
        confidence: 'low' as const,
        failures: [{ target: 'my-task', attempts: 3, resolved: false, last_error: 'timeout' }],
      },
      provenance: { compiler_version: '1.0.0', motive: 'test-motive', at_ord: 0 },
    };
    const out = renderView(view as Parameters<typeof renderView>[0]);
    expect(out).toContain('attempt(s)): timeout');
  });
});

// ── Fix: motive-less view — DO NOT EDIT placeholder (fix-3) ──────────────────

describe('DO NOT EDIT comment: placeholder when motive absent (fix-3)', () => {
  it('uses <motive> placeholder when provenance.motive is undefined', () => {
    const view = {
      human: null as unknown,
      agent: { objective: 'test', confidence: 'low' as const, failures: [] },
      provenance: { compiler_version: '1.0.0', at_ord: 0 },
    };
    const out = renderView(view as Parameters<typeof renderView>[0]);
    // Must not say "journal compile undefined"
    expect(out).not.toContain('compile undefined');
    // Must use the neutral placeholder (the comment wraps the whole command in single quotes)
    expect(out).toContain("compile <motive>'");
  });

  it('uses actual motive when provenance.motive is present', () => {
    const view = makeView({ provenance: { compiler_version: '1.0.0', motive: 'my-feature', at_ord: 5 } });
    const out = renderView(view);
    expect(out).toContain("compile my-feature'");
  });
});

// ── AC×Slice Matrix and Slice DAG helpers ─────────────────────────────────────

function makeFullView(agentOverrides: Record<string, unknown> = {}) {
  const agent = {
    objective: 'Test objective',
    objective_source: 'recorded:DECISION',
    decision_log: [],
    baselines: [],
    open_items: [],
    open_items_summary: { total: 0, open: 0, resolved: 0 },
    open_items_source: null,
    all_slices: [],
    open_slices: [],
    blocked: [],
    last_gate: null,
    gates: {},
    failures: [],
    drift: [],
    waivers: [],
    resume: { next_actions: [] },
    confidence: 'low',
    confidence_notes: [],
    sessions: [],
    decisions: [],
    last_handoff: null,
    verifications: [],
    milestones: [],
    spec_changes: [],
    ac_coverage: { met: [], unmet: [] },
    ...agentOverrides,
  };
  return {
    compiler_version: '1.0.0',
    agent,
    human: null,
    provenance: {
      compiler_version: '1.0.0',
      motive: 'test-motive',
      at_ord: 0,
      at_marker: null,
      events_folded: 0,
      malformed_lines: 0,
      unknown_type_events: 0,
    },
    divergence: { checked: false, findings: [] },
  };
}

// ── AC×Slice Traceability Matrix (Markdown) ───────────────────────────────────

describe('AC×Slice Traceability Matrix — Markdown', () => {
  it('emits section heading', () => {
    const view = makeFullView({
      ac_coverage: { met: [{ id: 'AC1', covering: ['s1'], missing: [], met: true }], unmet: [] },
      all_slices: [{ id: 's1', status: 'complete' }],
    });
    expect(renderView(view)).toContain('## AC×Slice Traceability Matrix');
  });

  it('marks complete slice with ✓ and pending with ○', () => {
    const view = makeFullView({
      ac_coverage: {
        met: [{ id: 'AC1', covering: ['s1'], missing: [], met: true }],
        unmet: [{ id: 'AC2', covering: ['s2'], missing: ['s2'], met: false }],
      },
      all_slices: [
        { id: 's1', status: 'complete' },
        { id: 's2', status: 'in_progress' },
      ],
    });
    const md = renderView(view);
    expect(md).toContain('s1 ✓');
    expect(md).toContain('s2 ○');
  });

  it('puts zero-covering ACs in NO COVERAGE section, not table', () => {
    const view = makeFullView({
      ac_coverage: { met: [], unmet: [{ id: 'AC3', covering: [], missing: [], met: false }] },
      all_slices: [],
    });
    const md = renderView(view);
    expect(md).toContain('NO COVERAGE');
    expect(md).toContain('**AC3**');
    // Must NOT appear as a table row
    expect(md).not.toMatch(/\| \*\*AC3\*\*/);
  });

  it('emits empty fallback when no AC data at all', () => {
    const view = makeFullView({ ac_coverage: { met: [], unmet: [] }, all_slices: [] });
    expect(renderView(view)).toContain('No AC coverage data.');
  });

  it('shows met and unmet status columns', () => {
    const view = makeFullView({
      ac_coverage: {
        met: [{ id: 'AC1', covering: ['s1'], missing: [], met: true }],
        unmet: [{ id: 'AC2', covering: ['s2'], missing: ['s2'], met: false }],
      },
      all_slices: [{ id: 's1', status: 'complete' }, { id: 's2', status: 'pending' }],
    });
    const md = renderView(view);
    expect(md).toContain('✓ met');
    expect(md).toContain('✗ unmet');
  });
});

// ── Slice Dependency DAG (Markdown) ──────────────────────────────────────────

describe('Slice Dependency DAG — Markdown', () => {
  it('emits DAG section heading', () => {
    const view = makeFullView({ all_slices: [{ id: 's1', status: 'complete', blocked_by: [] }] });
    expect(renderView(view)).toContain('## Slice Dependency DAG');
  });

  it('emits mermaid graph TD fence', () => {
    const view = makeFullView({ all_slices: [{ id: 's1', status: 'complete', blocked_by: [] }] });
    const md = renderView(view);
    expect(md).toContain('```mermaid');
    expect(md).toContain('graph TD');
  });

  it('adds ✓ for complete and ○ for non-complete', () => {
    const view = makeFullView({
      all_slices: [
        { id: 's1', status: 'complete', blocked_by: [] },
        { id: 's2', status: 'in_progress', blocked_by: [] },
      ],
    });
    const md = renderView(view);
    expect(md).toContain('s1 ✓');
    expect(md).toContain('s2 ○');
  });

  it('emits blocked_by edge as mermaid arrow', () => {
    const view = makeFullView({
      all_slices: [
        { id: 'dep', status: 'complete', blocked_by: [] },
        { id: 'child', status: 'pending', blocked_by: ['dep'] },
      ],
    });
    const md = renderView(view);
    expect(md).toContain('dep --> child');
  });

  it('emits no-dependencies comment when no edges', () => {
    const view = makeFullView({ all_slices: [{ id: 's1', status: 'complete', blocked_by: [] }] });
    expect(renderView(view)).toContain('%% no dependencies');
  });

  it('emits empty fallback when no slices', () => {
    const view = makeFullView({ all_slices: [] });
    expect(renderView(view)).toContain('No slices recorded.');
  });

  it('sanitises slice ids with special chars into valid mermaid node ids', () => {
    const view = makeFullView({
      all_slices: [
        { id: 'slice-a', status: 'complete', blocked_by: [] },
        { id: 'slice-b', status: 'pending', blocked_by: ['slice-a'] },
      ],
    });
    const md = renderView(view);
    // Hyphens should be replaced with underscores in the mermaid arrow
    expect(md).toContain('slice_a --> slice_b');
  });
});

// ── AC×Slice Matrix + DAG (HTML) ─────────────────────────────────────────────

describe('AC×Slice Traceability Matrix — HTML', () => {
  it('renders table heading and matrix-table', () => {
    const view = makeFullView({
      ac_coverage: { met: [{ id: 'AC1', covering: ['s1'], missing: [], met: true }], unmet: [] },
      all_slices: [{ id: 's1', status: 'complete' }],
    });
    const html = renderHtml(view);
    expect(html).toContain('AC×Slice Traceability Matrix');
    expect(html).toContain('<table class="matrix-table">');
  });

  it('shows NO COVERAGE for zero-covering ACs', () => {
    const view = makeFullView({
      ac_coverage: { met: [], unmet: [{ id: 'AC5', covering: [], missing: [], met: false }] },
      all_slices: [],
    });
    const html = renderHtml(view);
    expect(html).toContain('NO COVERAGE');
    expect(html).toContain('AC5');
  });

  it('renders empty fallback when no AC data', () => {
    const view = makeFullView({ ac_coverage: { met: [], unmet: [] } });
    expect(renderHtml(view)).toContain('No AC coverage data.');
  });
});

describe('Slice Dependency DAG — HTML', () => {
  it('renders DAG heading and mermaid pre block', () => {
    const view = makeFullView({ all_slices: [{ id: 'sx', status: 'complete', blocked_by: [] }] });
    const html = renderHtml(view);
    expect(html).toContain('Slice Dependency DAG');
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain('graph TD');
  });

  it('includes blocked_by edge in mermaid source (HTML-escaped)', () => {
    const view = makeFullView({
      all_slices: [
        { id: 'a', status: 'complete', blocked_by: [] },
        { id: 'b', status: 'pending', blocked_by: ['a'] },
      ],
    });
    const html = renderHtml(view);
    // The mermaid source is HTML-escaped inside the <pre>; --> becomes --&gt;
    expect(html).toContain('a --&gt; b');
  });

  it('renders empty fallback when no slices', () => {
    const view = makeFullView({ all_slices: [] });
    expect(renderHtml(view)).toContain('No slices recorded.');
  });
});
