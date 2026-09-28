/*
 * Copyright 2024 Example Corp. Licensed under the Apache License, Version 2.0.
 * strip-safety: removed=8
 * source: plugins/house-rules/test/fixtures/strip-safety/java.java
 */

package com.example.strip;

// NOSONAR
// @formatter:off
class StripSafetyDemo {

    // @formatter:on

    /**
     * A Javadoc doc comment that is exempt from removal as a documentation comment.
     */
    public void docMethod() {
        // This prose comment exists to push density above the five-percent cap.
        // Another line here to make the group larger and ensure it is removable.
        // Yet another prose line so the count is unambiguous and easy to verify.
        // Additional line to ensure we are well above the budget threshold here.
        // One more line so the removed count is unambiguous and easy to verify.
        // Final line in the removable prose block for this strip-safety fixture.
        // Extra line to be absolutely sure we exceed the 5% density threshold.
        // And one more for good measure in the strip-safety fixture for Java.
        System.out.println("hello");
    }

    //noinspection unchecked
    public void directiveMethod() {
        System.out.println("world");
    }
}
