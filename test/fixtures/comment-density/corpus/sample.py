#!/usr/bin/env python3
# Module comment

def greet(name: str) -> str:
    """
    Return a greeting.
    
    This is a docstring, not a comment technically,
    but many density checkers count it.
    """
    # build message
    return f"Hello, {name}"

URL = "http://not.a.comment"  # inline comment
