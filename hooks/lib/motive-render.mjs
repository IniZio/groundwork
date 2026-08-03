// hooks/lib/motive-render.mjs
// Pure view → Markdown renderer.
// Zero imports. No wall-clock or I/O references.
// Two exports: buildHumanLayer(view) and renderView(view).
// Both are pure functions of their input — byte-identical across repeated calls.

const SEVERITY_ORDER = { high: 0, medium: 1, info: 2 };

// ── buildHumanLayer ───────────────────────────────────────────────────────────

/**
 * Derive the human presentation layer from the raw compile() output.
 * compile() always returns human:null — S4 owns building it.
 *
 * @param {object} view  Raw compile() output: { agent, provenance, divergence, ... }
 * @returns {object}     The human layer object.
 */
export function buildHumanLayer(view) {
  const { agent, provenance, divergence } = view;

  // ── Banner (full D4 text) ─────────────────────────────────────────────────
  const banner = _buildBanner(divergence, provenance);

  // ── Title ─────────────────────────────────────────────────────────────────
  const title = provenance.motive
    ? `Motive: ${provenance.motive}`
    : 'Compiled motive view';

  // ── Narrative sections ────────────────────────────────────────────────────
  const narrative_sections = _buildNarrativeSections(agent);

  // ── Timeline — one entry per session boundary ─────────────────────────────
  const timeline = (agent.sessions ?? []).map((s) => ({
    ts: s.ts ?? null,
    ord: s.ord ?? null,
    summary: s.type === 'SESSION_START' ? `Session started` : `Session ended`,
  }));

  // ── Drift warnings ────────────────────────────────────────────────────────
  const drift_warnings = (agent.drift ?? []).map(
    (d) => `${d.kind ?? 'drift'}: ${d.path ?? d.detail ?? JSON.stringify(d)}`
  );

  // ── Spec changes ──────────────────────────────────────────────────────────
  const spec_changes = (agent.spec_changes ?? []).map(
    (c) => `${c.spec_ref ?? '?'}: ${c.change ?? c.reason ?? JSON.stringify(c)}`
  );

  // ── Divergence findings list (for renderer) ───────────────────────────────
  const divergence_findings = (divergence?.findings ?? []);

  return {
    title,
    banner,
    narrative_sections,
    timeline,
    drift_warnings,
    spec_changes,
    divergence_findings,
  };
}

// ── renderView ────────────────────────────────────────────────────────────────

/**
 * Render a compiled motive view to Markdown.
 * Accepts compile() output directly — derives the human layer if view.human is null/absent.
 *
 * @param {object} view  Full view from compile() (agent + human + provenance + divergence).
 * @returns {string}     A Markdown string. Banner is the first content line.
 */
export function renderView(view) {
  // Self-sufficient: build human layer if compile() left it null (S4 contract)
  const human = view.human != null ? view.human : buildHumanLayer(view);
  const { agent, provenance } = view;
  const parts = [];

  // DO NOT EDIT marker — HTML comment, invisible in rendered Markdown
  parts.push(`<!-- DO NOT EDIT — regenerate with 'journal compile ${provenance.motive ?? '<motive>'}' -->`);
  parts.push('');

  // ── Banner FIRST (S4-AC1, D4) ──────────────────────────────────────────────
  parts.push(human.banner);
  parts.push('');

  // ── Title ──────────────────────────────────────────────────────────────────
  parts.push(`# ${human.title}`);
  parts.push('');

  // ── Meta line: compiler_version / at_ord / confidence ─────────────────────
  const atLabel = provenance.at_ord != null ? String(provenance.at_ord) : 'HEAD';
  parts.push(
    `_compiler: ${provenance.compiler_version} · at: ${atLabel} · confidence: ${agent.confidence}_`
  );
  parts.push('');

  // ── Objective (S2) ────────────────────────────────────────────────────────
  parts.push('## Objective');
  parts.push('');
  {
    // Source label: prefer the human layer's narrative section if available (back-compat
    // with pre-built human layers), fall back to agent.objective_source.
    const objNarrative = human.narrative_sections.find((s) => s.title === 'Objective');
    const objSource = objNarrative?.source ?? agent.objective_source ?? 'absent';
    parts.push(_sourceLabel(objSource));
    parts.push('');
    if (agent.objective != null) {
      parts.push(agent.objective);
    } else {
      parts.push('_No objective was recorded for this motive._');
    }
  }
  parts.push('');

  // ── Open Items (S2) ───────────────────────────────────────────────────────
  parts.push('## Open Items');
  parts.push('');
  if (agent.open_items_source == null) {
    parts.push('_no register found — charter not injected._');
  } else {
    const items = agent.open_items ?? [];
    if (items.length === 0) {
      parts.push('_No open items._');
    } else {
      const summary = agent.open_items_summary ?? { total: 0, open: 0, resolved: 0 };
      parts.push(`${summary.open} open / ${summary.resolved} resolved / ${summary.total} total`);
      parts.push('');
      for (const item of items) {
        const tag = item.resolved_by != null ? '[x]' : '[ ]';
        const ownerNote = item.owner ? ` (owner: ${item.owner})` : '';
        const resolvedNote = item.resolved_by ? ` — resolved by ${item.resolved_by}` : '';
        parts.push(`- ${tag} **${item.id}** — ${item.statement ?? ''}${ownerNote}${resolvedNote}`);
      }
    }
  }
  parts.push('');

  // ── AC Coverage (S8) ──────────────────────────────────────────────────────
  parts.push('## AC Coverage');
  parts.push('');
  const acCoverage = agent.ac_coverage ?? { met: [], unmet: [] };
  const acMet = acCoverage.met ?? [];
  const acUnmet = acCoverage.unmet ?? [];
  if (acMet.length === 0 && acUnmet.length === 0) {
    parts.push('_No AC coverage recorded._');
  } else {
    for (const a of acMet) {
      parts.push(`- ✓ **${a.id}** — met  covering=[${a.covering.join(', ')}]`);
    }
    for (const a of acUnmet) {
      const why = a.covering.length === 0
        ? 'no covering slices assigned'
        : `missing: ${a.missing.join(', ')}`;
      parts.push(`- ✗ **${a.id}** — unmet  covering=[${a.covering.join(', ')}]  (${why})`);
    }
  }
  parts.push('');

  // ── Decision Log (S2) ─────────────────────────────────────────────────────
  parts.push('## Decision Log');
  parts.push('');
  const decisionLog = agent.decision_log ?? [];
  if (decisionLog.length === 0) {
    parts.push('_No decisions recorded._');
    parts.push('');
  } else {
    for (const d of decisionLog) {
      const statusBadge = `[${d.status ?? 'unknown'}]`;
      const supersededNote = d.superseded_by ? ` → superseded by ${d.superseded_by}` : '';
      const supersedes = d.supersedes ? ` (supersedes ${d.supersedes})` : '';
      parts.push(`### ${d.id}: ${d.title ?? '(untitled)'}${supersedes}`);
      parts.push('');
      parts.push(`**Status:** ${statusBadge}${supersededNote}`);
      if (d.rationale != null) {
        parts.push('');
        parts.push(`**Rationale:** ${d.rationale}`);
      }
      if (d.resolves != null) {
        parts.push('');
        parts.push(`**Resolves:** ${d.resolves}`);
      }
      parts.push('');
    }
  }

  // ── Baselines (S2) ────────────────────────────────────────────────────────
  parts.push('## Baselines');
  parts.push('');
  const baselines = agent.baselines ?? [];
  if (baselines.length === 0) {
    parts.push('_No baselines recorded._');
  } else {
    for (const b of baselines) {
      parts.push(`- **${b.name ?? '(unnamed)'}** at ord ${b.ord} (${b.ts ?? 'unknown'})`);
    }
  }
  parts.push('');

  // ── Narrative sections (S4-AC2, S4-AC3) ───────────────────────────────────
  for (const section of human.narrative_sections) {
    // Objective is now rendered above — skip the duplicate narrative Objective section
    if (section.title === 'Objective') continue;
    parts.push(`## ${section.title}`);
    parts.push('');
    // source: label — visually distinct for recorded vs reconstructed (AC2)
    parts.push(_sourceLabel(section.source));
    parts.push('');
    if (section.source === 'absent') {
      // Explicit absence sentence — never an empty section (P-B, S4-AC3)
      parts.push(`_No ${section.title.toLowerCase()} was recorded for this motive._`);
    } else {
      parts.push(section.content ?? '');
    }
    parts.push('');
  }

  // ── Divergence findings (rendered only when present) ──────────────────────
  const divergenceFindings = human.divergence_findings ?? [];
  if (divergenceFindings.length > 0) {
    parts.push('## Divergence Findings');
    parts.push('');
    const sorted = [...divergenceFindings].sort(_findingOrder);
    for (const f of sorted) {
      const pathNote = f.path ? ` — \`${f.path}\`` : '';
      const idNote = f.id ? ` [${f.id}]` : '';
      parts.push(`- **[${f.severity}]** ${f.kind}${idNote}${pathNote}: ${f.detail ?? ''}`);
    }
    parts.push('');
  }

  // ── Timeline ───────────────────────────────────────────────────────────────
  if (human.timeline && human.timeline.length > 0) {
    parts.push('## Timeline');
    parts.push('');
    for (const entry of human.timeline) {
      const stamp = entry.ts ?? String(entry.ord);
      parts.push(`- **${stamp}** — ${entry.summary}`);
    }
    parts.push('');
  }

  // ── Drift warnings ─────────────────────────────────────────────────────────
  if (human.drift_warnings && human.drift_warnings.length > 0) {
    parts.push('## Drift Warnings');
    parts.push('');
    for (const w of human.drift_warnings) {
      parts.push(`- ${w}`);
    }
    parts.push('');
  }

  // ── Spec changes ───────────────────────────────────────────────────────────
  if (human.spec_changes && human.spec_changes.length > 0) {
    parts.push('## Spec Changes');
    parts.push('');
    for (const c of human.spec_changes) {
      parts.push(`- ${c}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Build the full D4 banner text from divergence + provenance.
 * compile() only emits a partial label; the full text needs head_sha/branch.
 */
function _buildBanner(divergence, provenance) {
  if (!divergence || divergence.checked === false) {
    return '⚠ GROUND TRUTH NOT CHECKED — this view has not been compared against the repo.';
  }
  const findings = divergence.findings ?? [];
  if (findings.length === 0) {
    const gt = provenance.ground_truth ?? {};
    const sha = gt.head_sha ? gt.head_sha.slice(0, 7) : 'unknown';
    const branch = gt.branch ?? 'unknown';
    return `✓ No divergence: log and repo agree at ${sha} on ${branch}.`;
  }
  const high = findings.filter((f) => f.severity === 'high').length;
  const medium = findings.filter((f) => f.severity === 'medium').length;
  return `⚠ DIVERGENCE: ${findings.length} finding(s) (${high} high, ${medium} medium) — the log and the repo disagree. Trust the repo.`;
}

/**
 * Build the 6 standard narrative sections from the agent layer.
 * Absent material is marked source:'absent' — never omitted silently (P-B, S4-AC3).
 */
function _buildNarrativeSections(agent) {
  const sections = [];

  // Objective
  if (agent.objective != null) {
    sections.push({
      title: 'Objective',
      source: agent.objective_source ?? 'recorded:unknown',
      content: agent.objective,
    });
  } else {
    sections.push({ title: 'Objective', source: 'absent', content: null });
  }

  // Progress — reconstructed from slice counts
  const total = (agent.all_slices ?? []).length;
  const open = (agent.open_slices ?? []).length;
  const done = total - open;
  if (total > 0) {
    sections.push({
      title: 'Progress',
      source: 'reconstructed:all_slices',
      content: `${done}/${total} slices complete. ${open} remaining. Confidence: ${agent.confidence}.`,
    });
  } else {
    sections.push({ title: 'Progress', source: 'absent', content: null });
  }

  // Rationale — from decisions if recorded
  const decisions = agent.decisions ?? [];
  if (decisions.length > 0) {
    const lines = decisions.map(
      (d) => `- **${d.key ?? d.type ?? 'decision'}**: ${d.value ?? d.summary ?? JSON.stringify(d)}`
    );
    sections.push({
      title: 'Rationale',
      source: 'recorded:DECISION',
      content: lines.join('\n'),
    });
  } else {
    sections.push({ title: 'Rationale', source: 'absent', content: null });
  }

  // Trouble — from unresolved failures
  const failures = (agent.failures ?? []).filter((f) => !f.resolved);
  if (failures.length > 0) {
    const lines = failures.map(
      (f) => {
        const name = f.target ?? f.fingerprint ?? 'failure';
        const summary = f.msg ?? f.last_error ?? '';
        return summary
          ? `- **${name}** (${f.attempts ?? 1} attempt(s)): ${summary}`
          : `- **${name}** (${f.attempts ?? 1} attempt(s))`;
      }
    );
    sections.push({
      title: 'Trouble',
      source: 'reconstructed:STRUGGLE_DETECTED',
      content: lines.join('\n'),
    });
  } else {
    sections.push({ title: 'Trouble', source: 'absent', content: null });
  }

  // Verdict — from last gate
  const gate = agent.last_gate;
  if (gate != null) {
    sections.push({
      title: 'Verdict',
      source: 'recorded:GATE',
      content: `**${gate.verdict}** (${gate.which ?? 'advisor'})${gate.citation ? ` — ${gate.citation}` : ''}`,
    });
  } else {
    sections.push({ title: 'Verdict', source: 'absent', content: null });
  }

  // Handoff — from last handoff event
  const handoff = agent.last_handoff;
  if (handoff != null) {
    sections.push({
      title: 'Handoff',
      source: 'recorded:HANDOFF',
      content: handoff.summary ?? handoff.content ?? JSON.stringify(handoff),
    });
  } else {
    sections.push({ title: 'Handoff', source: 'absent', content: null });
  }

  return sections;
}

/**
 * Render a source: label. Recorded sections are bold (prominent), reconstructed
 * are italic (hedged), absent is italic note. AC2 requires visual distinction.
 */
function _sourceLabel(source) {
  if (source === 'absent') {
    return `_source: absent_`;
  }
  if (source.startsWith('recorded:')) {
    return `**source: ${source}**`;
  }
  // reconstructed:* or any other value
  return `_source: ${source}_`;
}

/** Sort findings by severity (high < medium < info), then kind, then path. */
function _findingOrder(a, b) {
  const sa = SEVERITY_ORDER[a.severity] ?? 99;
  const sb = SEVERITY_ORDER[b.severity] ?? 99;
  if (sa !== sb) return sa - sb;
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  const pa = a.path ?? '';
  const pb = b.path ?? '';
  if (pa < pb) return -1;
  if (pa > pb) return 1;
  return 0;
}
