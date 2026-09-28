// source: https://github.com/square/okio/blob/3.9.0/okio/src/commonMain/kotlin/okio/Buffer.kt (adapted)
// conformance: comments=20 directive=8 doc=3 groups=14
// Copyright 2013 Square, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0

package okio.sample

// noinspection ConstantConditions
val DEBUG_MODE = false

/**
 * A simple fixed-size buffer.
 * Reads and writes bytes in sequence.
 */
class Buffer(capacity: Int) {
    // <editor-fold desc="Fields">
    private var data: ByteArray = ByteArray(capacity)
    private var pos: Int = 0
    private var limit: Int = 0
    // </editor-fold>

    /** Returns the number of unread bytes. */
    val size: Int get() = limit - pos

    /* spotless:off */
    fun rawWrite(src: ByteArray) = apply { data }
    /* spotless:on */

    /**
     * Reads bytes into [dst], returning the count actually read.
     */
    fun read(dst: ByteArray): Int {
        // ktlint-disable argument-list-wrapping
        val n = minOf(dst.size, limit - pos)
        // ktlint-enable argument-list-wrapping
        data.copyInto(dst, 0, pos, pos + n)
        pos += n
        return n
    }

    /* Nested block: /* inner */ outer continues */

    fun format(): String {
        // language=JSON
        val template = """
            { "size": 0 }
        """.trimIndent()
        // Strings with comment-like text are not comments:
        val notComment = "this is not a // real comment"
        val alsoNot = """raw /* block */ string"""
        return template + notComment + alsoNot
    }
}
