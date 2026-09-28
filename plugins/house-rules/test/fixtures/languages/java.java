/*
 * source: synthetic; shapes typical of a Java 8/21 Maven web app plus Java 21 constructs
 * conformance: comments=14 directive=5 doc=5 groups=14
 * Project : example shop
 * Licensed under the Apache License, Version 2.0.
 */

package com.example.demo;

import java.io.File;
import java.io.FilenameFilter;
import java.util.List;
import java.util.function.Consumer;

/**
 * SampleService demonstrates common Java language patterns.
 * Includes records, text blocks, switch expressions, and bounded wildcards.
 */
public class SampleService {

    // NOSONAR
    private static final int MAX_RETRY = 3;

    //noinspection unchecked
    @SuppressWarnings("unchecked")
    public List<String> getItems() {
        return (List<String>) new java.util.ArrayList<>();
    }

    /**
     * Creates a filename filter for the given prefix.
     *
     * @param prefix the filename prefix to match
     * @return a FilenameFilter that accepts names starting with prefix
     */
    public FilenameFilter createFilter(String prefix) {
        /* Create anonymous FilenameFilter inner class */
        return new FilenameFilter() {
            @Override
            public boolean accept(File dir, String name) {
                return name.startsWith(prefix);
            }
        };
    }

    /**
     * Processes items using bounded wildcard parameters and a lambda.
     */
    public void processItems(List<? extends String> items, Consumer<? super String> action) {
        // Process each item in sequence
        items.forEach(action);
    }

    // @formatter:off
    private String rawBlock = "not a comment: // fake // comment";
    // @formatter:on

    /**
     * Returns a text block containing comment-like sequences that are not real comments.
     * The // and /* sequences inside triple-quoted strings are string literals.
     */
    public String getTemplate() {
        String sql = """
                SELECT *
                -- this is SQL, not a Java comment
                FROM users /* also not a Java comment */
                WHERE active = 1
                """;
        return sql;
    }

    // Describe order status using a switch expression with yield
    public String describeStatus(int status) {
        return switch (status) {
            case 1 -> "active";
            case 2 -> {
                // falls through
                yield "pending";
            }
            default -> "unknown";
        };
    }
}

/** A simple record for holding key-value pairs from the Java 21 feature set. */
record KeyValue(String key, String value) {}
