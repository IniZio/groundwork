/**
 * HC-4: keep-policy tests — shortest-group-first selection, tie-break by source order,
 * density trim drops longest kept group first.
 */
import { describe, it, expect } from "bun:test";
import { autoFix } from "../../src/hooks/lib/comment-density.js";


// ---------------------------------------------------------------------------
// Go fixtures
// ---------------------------------------------------------------------------

// Base code (~120 lines), real function bodies from nexus machine.go.
// We splice in the comment groups at specific positions to build test variants.
const GO_BASE_TOP = `package lifecycle

import (
	"fmt"
	"sort"
)

type State string
type Trigger string
type Initiator string

func (s State) Valid() bool { return s != "" }

type Edge struct {
	From      State
	Trigger   Trigger
	To        State
	Removal   bool
	Initiator Initiator
}

var table []Edge

type Machine struct{}

func New() Machine { return Machine{} }

type Transition struct {
	Remove    bool
	NextState State
}

type IllegalTransitionError struct {
	From          State
	Trigger       Trigger
	LegalTriggers []Trigger
}

func (e *IllegalTransitionError) Error() string {
`;

// 5-row prose block (one Go comment group).
const GO_PROSE_BLOCK = `	// This function formats an error message for an illegal state machine
	// transition. The message names the source state, the attempted trigger,
	// and every legal alternative trigger available from that state. When
	// no triggers are legal from the source state, it reports that explicitly
	// rather than listing an empty set of alternatives.
`;

const GO_ERROR_BODY = `	if len(e.LegalTriggers) == 0 {
		return fmt.Sprintf(
			"illegal transition: trigger %q is not valid from state %q",
			e.Trigger, e.From,
		)
	}
	legal := make([]string, len(e.LegalTriggers))
	for i, t := range e.LegalTriggers {
		legal[i] = string(t)
	}
	return fmt.Sprintf(
		"illegal transition: trigger %q is not valid from state %q; valid: %v",
		e.Trigger, e.From, legal,
	)
}

`;

// Six 1-row comments in separate function bodies (each separated by code lines → each its own group).
const GO_BOTTOM_FUNCS = `func (m Machine) Can(from State, trigger Trigger) bool {
	// iterate the transition table for a matching edge
	for _, e := range table {
		if e.From == from && e.Trigger == trigger {
			return true
		}
	}
	return false
}

func (m Machine) Next(from State, trigger Trigger) (Transition, error) {
	// scan the table for the requested transition
	for _, e := range table {
		if e.From == from && e.Trigger == trigger {
			return Transition{Remove: e.Removal, NextState: e.To}, nil
		}
	}
	return Transition{}, &IllegalTransitionError{
		From:          from,
		Trigger:       trigger,
		LegalTriggers: m.LegalTriggers(from),
	}
}

func (m Machine) Initiator(from State, trigger Trigger) (Initiator, error) {
	for _, e := range table {
		// check each edge for a match
		if e.From == from && e.Trigger == trigger {
			return e.Initiator, nil
		}
	}
	return "", &IllegalTransitionError{
		From:          from,
		Trigger:       trigger,
		LegalTriggers: m.LegalTriggers(from),
	}
}

func (m Machine) LegalTriggers(from State) []Trigger {
	seen := make(map[Trigger]struct{})
	for _, e := range table {
		if e.From == from {
			// record each unique trigger from this state
			seen[e.Trigger] = struct{}{}
		}
	}
	triggers := make([]Trigger, 0, len(seen))
	for t := range seen {
		triggers = append(triggers, t)
	}
	// sort triggers lexicographically for stable output
	sort.Slice(triggers, func(i, j int) bool {
		return triggers[i] < triggers[j]
	})
	return triggers
}

func (m Machine) All() []Edge {
	// return a defensive copy of the transition table
	out := make([]Edge, len(table))
	copy(out, table)
	return out
}
`;

// AC1 variant: prose block near top (inside Error()), six one-liners further down.
const GO_PROSE_NEAR_TOP =
  GO_BASE_TOP + GO_PROSE_BLOCK + GO_ERROR_BODY + GO_BOTTOM_FUNCS;

// AC2 variant: prose block at bottom (after all one-liner functions).
// Move the 5-row block into All() (last function) so it appears furthest down.
const GO_BASE_TOP_NO_PROSE = GO_BASE_TOP + GO_ERROR_BODY;
const GO_BOTTOM_FUNCS_WITH_PROSE_AT_BOTTOM = `func (m Machine) Can(from State, trigger Trigger) bool {
	// iterate the transition table for a matching edge
	for _, e := range table {
		if e.From == from && e.Trigger == trigger {
			return true
		}
	}
	return false
}

func (m Machine) Next(from State, trigger Trigger) (Transition, error) {
	// scan the table for the requested transition
	for _, e := range table {
		if e.From == from && e.Trigger == trigger {
			return Transition{Remove: e.Removal, NextState: e.To}, nil
		}
	}
	return Transition{}, &IllegalTransitionError{
		From:          from,
		Trigger:       trigger,
		LegalTriggers: m.LegalTriggers(from),
	}
}

func (m Machine) Initiator(from State, trigger Trigger) (Initiator, error) {
	for _, e := range table {
		// check each edge for a match
		if e.From == from && e.Trigger == trigger {
			return e.Initiator, nil
		}
	}
	return "", &IllegalTransitionError{
		From:          from,
		Trigger:       trigger,
		LegalTriggers: m.LegalTriggers(from),
	}
}

func (m Machine) LegalTriggers(from State) []Trigger {
	seen := make(map[Trigger]struct{})
	for _, e := range table {
		if e.From == from {
			// record each unique trigger from this state
			seen[e.Trigger] = struct{}{}
		}
	}
	triggers := make([]Trigger, 0, len(seen))
	for t := range seen {
		triggers = append(triggers, t)
	}
	// sort triggers lexicographically for stable output
	sort.Slice(triggers, func(i, j int) bool {
		return triggers[i] < triggers[j]
	})
	return triggers
}

func (m Machine) All() []Edge {
` + GO_PROSE_BLOCK + `	out := make([]Edge, len(table))
	// return a defensive copy of the transition table
	copy(out, table)
	return out
}
`;

const GO_PROSE_NEAR_BOTTOM =
  GO_BASE_TOP_NO_PROSE + GO_BOTTOM_FUNCS_WITH_PROSE_AT_BOTTOM;

// Expected kept/removed comment texts for Go fixtures.
// The six one-liner texts (each a single-line comment string).
const GO_ONELINERS = [
  "// iterate the transition table for a matching edge",
  "// scan the table for the requested transition",
  "// check each edge for a match",
  "// record each unique trigger from this state",
  "// sort triggers lexicographically for stable output",
  "// return a defensive copy of the transition table",
];

// The 5-row prose block texts (5 separate Comment objects, each one line).
const GO_PROSE_LINES = [
  "// This function formats an error message for an illegal state machine",
  "// transition. The message names the source state, the attempted trigger,",
  "// and every legal alternative trigger available from that state. When",
  "// no triggers are legal from the source state, it reports that explicitly",
  "// rather than listing an empty set of alternatives.",
];

function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

// ---------------------------------------------------------------------------
// TypeScript fixtures
// ---------------------------------------------------------------------------

// For non-Go: consecutive whole-line // comments on consecutive rows form one unit.
// Six separate // comments (each separated by code) form six units.

const TS_BASE_TOP = `type State = string;
type Trigger = string;
type Initiator = string;

function stateValid(s: State): boolean { return s !== ""; }

interface Edge {
  from: State;
  trigger: Trigger;
  to: State;
  removal: boolean;
  initiator: Initiator;
}

const table: Edge[] = [];

class Machine {
  static new(): Machine { return new Machine(); }

  error(legalTriggers: Trigger[], from: State, trigger: Trigger): string {
`;

// 5-row prose block for TypeScript (5 consecutive whole-line // comments).
const TS_PROSE_BLOCK = `    // This method formats an error message for an illegal state machine
    // transition. The message names the source state, the attempted trigger,
    // and every legal alternative trigger available from that state. When
    // no triggers are legal from the source state, it reports that explicitly
    // rather than listing an empty set of alternatives.
`;

const TS_ERROR_BODY = `    if (legalTriggers.length === 0) {
      return \`illegal transition: trigger "\${trigger}" not valid from "\${from}"\`;
    }
    return \`illegal transition: "\${trigger}" from "\${from}"; valid: \${legalTriggers.join(", ")}\`;
  }

`;

const TS_BOTTOM_METHODS = `  can(from: State, trigger: Trigger): boolean {
    // iterate the table for a matching edge
    for (const e of table) {
      if (e.from === from && e.trigger === trigger) return true;
    }
    return false;
  }

  next(from: State, trigger: Trigger): { remove: boolean; nextState: State } | null {
    // scan the table for the requested transition
    for (const e of table) {
      if (e.from === from && e.trigger === trigger) {
        return { remove: e.removal, nextState: e.to };
      }
    }
    return null;
  }

  initiator(from: State, trigger: Trigger): Initiator | null {
    for (const e of table) {
      // check each edge for a match
      if (e.from === from && e.trigger === trigger) return e.initiator;
    }
    return null;
  }

  legalTriggers(from: State): Trigger[] {
    const seen = new Set<Trigger>();
    for (const e of table) {
      if (e.from === from) {
        // record each unique trigger from this state
        seen.add(e.trigger);
      }
    }
    const triggers = [...seen];
    // sort triggers lexicographically for stable output
    return triggers.sort();
  }

  all(): Edge[] {
    // return a defensive copy of the transition table
    return [...table];
  }
}
`;

const TS_PROSE_NEAR_TOP = TS_BASE_TOP + TS_PROSE_BLOCK + TS_ERROR_BODY + TS_BOTTOM_METHODS;

// TypeScript variant with prose at bottom (inside all()).
const TS_BOTTOM_METHODS_WITH_PROSE_AT_BOTTOM = `  can(from: State, trigger: Trigger): boolean {
    // iterate the table for a matching edge
    for (const e of table) {
      if (e.from === from && e.trigger === trigger) return true;
    }
    return false;
  }

  next(from: State, trigger: Trigger): { remove: boolean; nextState: State } | null {
    // scan the table for the requested transition
    for (const e of table) {
      if (e.from === from && e.trigger === trigger) {
        return { remove: e.removal, nextState: e.to };
      }
    }
    return null;
  }

  initiator(from: State, trigger: Trigger): Initiator | null {
    for (const e of table) {
      // check each edge for a match
      if (e.from === from && e.trigger === trigger) return e.initiator;
    }
    return null;
  }

  legalTriggers(from: State): Trigger[] {
    const seen = new Set<Trigger>();
    for (const e of table) {
      if (e.from === from) {
        // record each unique trigger from this state
        seen.add(e.trigger);
      }
    }
    const triggers = [...seen];
    // sort triggers lexicographically for stable output
    return triggers.sort();
  }

  all(): Edge[] {
` + TS_PROSE_BLOCK + `    const copy = [...table];
    // return a defensive copy of the transition table
    return copy;
  }
}
`;

const TS_PROSE_NEAR_BOTTOM =
  TS_BASE_TOP + TS_ERROR_BODY + TS_BOTTOM_METHODS_WITH_PROSE_AT_BOTTOM;

const TS_ONELINERS = [
  "// iterate the table for a matching edge",
  "// scan the table for the requested transition",
  "// check each edge for a match",
  "// record each unique trigger from this state",
  "// sort triggers lexicographically for stable output",
  "// return a defensive copy of the transition table",
];

const TS_PROSE_LINES = [
  "// This method formats an error message for an illegal state machine",
  "// transition. The message names the source state, the attempted trigger,",
  "// and every legal alternative trigger available from that state. When",
  "// no triggers are legal from the source state, it reports that explicitly",
  "// rather than listing an empty set of alternatives.",
];

// ---------------------------------------------------------------------------
// AC1 + AC2: Go — shortest-first keeps one-liners, removes prose
// ---------------------------------------------------------------------------

describe("HC-4 keep-policy: Go, shortest-group-first (AC1)", () => {
  it("prose near top: six one-liners kept, 5-row prose removed", async () => {
    const text = GO_PROSE_NEAR_TOP;
    const rows = allRows(text);
    const r = await autoFix(text, "go", rows, undefined, undefined, { maxAllowedRows: 6 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // All six one-liner texts must be absent from removedTexts.
    for (const oneliner of GO_ONELINERS) {
      expect(r.removedTexts).not.toContain(oneliner);
    }
    // The five prose lines must all be removed.
    for (const prose of GO_PROSE_LINES) {
      expect(r.removedTexts).toContain(prose);
    }
    expect(r.removedTexts).toHaveLength(5);
  });

  it("prose near bottom: same kept-text set regardless of prose position (AC2)", async () => {
    const text = GO_PROSE_NEAR_BOTTOM;
    const rows = allRows(text);
    const r = await autoFix(text, "go", rows, undefined, undefined, { maxAllowedRows: 6 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const oneliner of GO_ONELINERS) {
      expect(r.removedTexts).not.toContain(oneliner);
    }
    for (const prose of GO_PROSE_LINES) {
      expect(r.removedTexts).toContain(prose);
    }
    expect(r.removedTexts).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// AC3: TypeScript — same shortest-first policy
// ---------------------------------------------------------------------------

describe("HC-4 keep-policy: TypeScript, shortest-group-first (AC3)", () => {
  it("prose near top: six one-liners kept, 5-row prose removed", async () => {
    const text = TS_PROSE_NEAR_TOP;
    const rows = allRows(text);
    const r = await autoFix(text, "typescript", rows, undefined, undefined, { maxAllowedRows: 6 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const oneliner of TS_ONELINERS) {
      expect(r.removedTexts).not.toContain(oneliner);
    }
    for (const prose of TS_PROSE_LINES) {
      expect(r.removedTexts).toContain(prose);
    }
    expect(r.removedTexts).toHaveLength(5);
  });

  it("prose near bottom: same kept-text set regardless of prose position (AC3 AC2-parity)", async () => {
    const text = TS_PROSE_NEAR_BOTTOM;
    const rows = allRows(text);
    const r = await autoFix(text, "typescript", rows, undefined, undefined, { maxAllowedRows: 6 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const oneliner of TS_ONELINERS) {
      expect(r.removedTexts).not.toContain(oneliner);
    }
    for (const prose of TS_PROSE_LINES) {
      expect(r.removedTexts).toContain(prose);
    }
    expect(r.removedTexts).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// AC4: Tie-break — four 1-row groups, max 2 → first two in source order kept
// ---------------------------------------------------------------------------

describe("HC-4 keep-policy: tie-break by source order (AC4)", () => {
  it("Go: four 1-row groups, max 2 → first two kept by source order", async () => {
    // Four single-line comments inside function bodies, separated by code lines.
    const text = `package main

var table []string

func f1() {
	// comment alpha
	_ = table
}

func f2() {
	// comment beta
	_ = table
}

func f3() {
	// comment gamma
	_ = table
}

func f4() {
	// comment delta
	_ = table
}
`;
    const rows = allRows(text);
    const r = await autoFix(text, "go", rows, undefined, undefined, { maxAllowedRows: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // First two in source order must be kept (not removed).
    expect(r.removedTexts).not.toContain("// comment alpha");
    expect(r.removedTexts).not.toContain("// comment beta");
    // Last two must be removed.
    expect(r.removedTexts).toContain("// comment gamma");
    expect(r.removedTexts).toContain("// comment delta");
    expect(r.removedTexts).toHaveLength(2);
  });

  it("TypeScript: four 1-row groups, max 2 → first two kept by source order", async () => {
    const text = [
      ...Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`),
      "// comment alpha",
      `const a0 = 0;`,
      "// comment beta",
      `const b0 = 0;`,
      "// comment gamma",
      `const c0 = 0;`,
      "// comment delta",
      `const d0 = 0;`,
    ].join("\n") + "\n";
    const rows = allRows(text);
    const r = await autoFix(text, "typescript", rows, undefined, undefined, { maxAllowedRows: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removedTexts).not.toContain("// comment alpha");
    expect(r.removedTexts).not.toContain("// comment beta");
    expect(r.removedTexts).toContain("// comment gamma");
    expect(r.removedTexts).toContain("// comment delta");
    expect(r.removedTexts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Bite proof: removing the sort breaks AC1 (documented here; run manually
// with the sort commented out to verify the named (fail) lines appear).
// The real bite test is the guard.test.ts / gate.test.ts suite + full suite.
// ---------------------------------------------------------------------------
