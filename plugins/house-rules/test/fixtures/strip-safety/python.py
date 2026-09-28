#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# strip-safety: removed=6
# source: derived from test/fixtures/languages/python.py (PyJWT@2.15.0, MIT) lines 1-69
import json
import platform
import sys

from . import __version__ as pyjwt_version  # noqa: E402

try:
    import cryptography

    cryptography_version = cryptography.__version__
except ModuleNotFoundError:
    # If cryptography is not installed, fall back to an empty version string.
    cryptography_version = ""


def info() -> dict[str, dict[str, str]]:
    """
    Generate information for a bug report.
    Based on the requests package help utility module.
    """
    # Gather OS-level platform fields; guard against rare OSError on restricted systems.
    try:
        platform_info = {
            "system": platform.system(),
            "release": platform.release(),
        }
    except OSError:
        platform_info = {"system": "Unknown", "release": "Unknown"}

    # python_implementation returns CPython, PyPy, Jython, etc.
    implementation = platform.python_implementation()

    if implementation == "CPython":
        # CPython exposes a simple dotted version string.
        implementation_version = platform.python_version()
    elif implementation == "PyPy":
        pypy_version_info = sys.pypy_version_info  # type: ignore[attr-defined]
        implementation_version = (
            f"{pypy_version_info.major}."
            f"{pypy_version_info.minor}."
            f"{pypy_version_info.micro}"
        )
        if pypy_version_info.releaselevel != "final":
            # Append the pre-release level label so callers can distinguish stable builds.
            implementation_version = "".join(
                [
                    implementation_version,
                    pypy_version_info.releaselevel,
                ]
            )
    else:
        # pylint: disable=invalid-name
        implementation_version = "Unknown"

    return {
        "platform": platform_info,
        "implementation": {
            "name": implementation,
            "version": implementation_version,
        },
        "cryptography": {"version": cryptography_version},
        "pyjwt": {"version": pyjwt_version},
    }


def main() -> None:  # pragma: no cover
    """Pretty-print the bug information as JSON."""
    # Dump the info dict as pretty-printed JSON so maintainers can paste it into issues.
    print(json.dumps(info(), sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
