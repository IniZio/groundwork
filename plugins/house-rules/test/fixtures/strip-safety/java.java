/*
 * Copyright 2024 Example Corp. Licensed under the Apache License, Version 2.0.
 * strip-safety: removed=8
 * source: plugins/house-rules/test/fixtures/strip-safety/java.java
 */

package com.example.strip;

// NOSONAR
// NOPMD
// CHECKSTYLE:OFF
// @formatter:off
class StripSafetyDemo {

    // @formatter:on
    // CHECKSTYLE:ON
    // CHECKSTYLE.OFF: LineLength
    // spotless:off
    // spotless:on
    // CHECKSTYLE.ON: LineLength
    // CPD-OFF
    // CPD-ON

    /**
     * A Javadoc doc comment that is exempt from removal as a documentation comment.
     *
     * @param s the input string
     * @return a processed string
     */
    public String docMethod(String s) {
        // This prose comment exists to push density above the five-percent cap.
        // Another line here to make the group larger and ensure it is removable.
        // Yet another prose line so the count is unambiguous and easy to verify.
        // Additional line to ensure we are well above the budget threshold here.
        // One more line so the removed count is unambiguous and easy to verify.
        // Final line in the removable prose block for this strip-safety fixture.
        // Extra line to be absolutely sure we exceed the 5% density threshold.
        // And one more for good measure in the strip-safety fixture for Java.
        System.out.println("hello"); //
        String t = "not a comment"; //$NON-NLS-1$
        String u = "// not a comment";
        char c = '/';
        return t + u;
    }

    //noinspection unchecked
    public void directiveMethod() {
        System.out.println(/* inside arg list */ "world");
        // deepcode ignore SomeVuln
        // nosemgrep some-rule
    }

    @SuppressWarnings(/* inside annotation arg */ "unchecked")
    public void lambdaMethod() {
        Runnable r = () -> {
            // comment inside lambda body
            System.out.println("lambda");
        };
        Runnable anon = new Runnable() {
            // comment inside anonymous class body
            @Override
            public void run() {
                System.out.println("anon");
            }
        };
    }

    public void switchMethod(int x) {
        switch (x) {
            case 1:
                System.out.println("one");
                // fall through
            case 2:
                System.out.println("two or one");
                break;
        }
    }

    public String textBlockMethod() {
        String tb = """
                // this is inside a text block, not a comment
                /* also not a block comment */
                plain content here
                """;
        String lit = "// not a comment";
        return tb + lit;
    }
}
