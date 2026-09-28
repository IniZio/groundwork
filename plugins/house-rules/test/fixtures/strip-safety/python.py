#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# strip-safety: removed=8
# isort: skip_file
# ruff: noqa
# flake8: noqa
# mypy: ignore-errors
# pyright: basic
"""Neutral strip-safety fixture for the com.example autofix pipeline."""

import os  # noqa: F401
import re  # noqa: F401
import sys


_HASH_IN_STR: str = "items: # not a comment here"
_HASH_IN_FSTR: str = f"total={1 + 1} # still not a real comment"


# fmt: off
LOOKUP: dict = {
    "alpha": 1,
    "beta":  2,
}
# fmt: on


def compute_score(x: int, scale: int = 1) -> int:  # type: ignore[return-value]
    """Return x multiplied by scale."""
    # This prose comment sits between the function signature and first logic.
    # Another prose line to push density above the five-percent cap.
    # Yet another prose line so the count is unambiguous and easy to verify.
    # Final prose line for the removable group in compute_score.
    if scale < 0:
        # This whole-line prose comment sits between the if: and its body.
        raise ValueError("scale must be non-negative")
    total = x * scale
    return total  # nosec


class DataHandler:
    """
    Handler class for sample data processing.

    This docstring spans multiple lines for the fixture.
    """

    # pylint: disable=too-few-public-methods

    # @apiParam {List} items  list of items to process
    # @apiParam {str}  mode   processing mode, one of strict or lax
    def process(self, items: list, mode: str = "strict") -> list:
        """Process items according to mode."""
        # pyre-ignore[16]
        result = []
        for item in items:
            result.append(str(item))
            # This prose comment is the last line of the for-loop block.
        return result  # pragma: no cover


def validate(
    value: object,  # type: ignore[misc]
) -> bool:
    """Return True if value is not None."""
    # Extra prose line A to be absolutely sure we exceed the density threshold.
    # Extra prose line B to make the group larger and ensure it is removable.
    # Extra prose line C so the count is unambiguous and easy to confirm.
    # Extra prose line D — final line in validate, included for good measure.
    _ = repr(value)  # normalise repr  # noqa: E501
    return value is not None  # noqa: E714
