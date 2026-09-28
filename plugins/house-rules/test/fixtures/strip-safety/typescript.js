#!/usr/bin/env node
// strip-safety: removed=7
// source: synthetic plain-JS fixture for strip-safety suite (tree-sitter-tsx.wasm variant)
/*! Copyright 2024 Acme Corp. All rights reserved. MIT License */
/** @jsx h */
/* eslint-disable no-console */
// @ts-nocheck

// This standalone narrative comment will be kept; it is the first 1-row unit that fits the 5 % budget.

// eslint-disable-next-line no-unused-vars
// eslint-enable no-console
// prettier-ignore
const MATRIX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/*#__PURE__*/
const pureResult = expensiveCompute();

/* @__PURE__ */
const pureResult2 = expensiveCompute2();

// istanbul ignore next
function uncoveredBranch() {
  return process.env.NEVER_SET ? "a" : "b";
}

/* c8 ignore next */
function anotherUncoveredBranch() {
  return process.env.ALSO_NEVER ? "x" : "y";
}

// This second standalone narrative comment will also be kept; it fills the remaining budget.

// Narrative comment D; these three consecutive comments form one removal group.
// Narrative comment E; autoFix drops this block to bring the file within density cap.
// Narrative comment F; the block is larger than the residual budget so it is removed.
import { h } from "preact";

function Widget({ label }) {
  return (
    <div className="widget">
      {/*
        Multi-line JSX narrative comment, first container.
        These lines are stripped and the enclosing braces removed too.
      */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <span>{label}</span>
      {/*
        Multi-line JSX narrative comment, second container.
        No empty {} container is left behind after autoFix strips this block.
      */}
      <button type="button">click</button>
    </div>
  );
}

const _lazy = import(/* webpackChunkName: "x" */ "./x");
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==
