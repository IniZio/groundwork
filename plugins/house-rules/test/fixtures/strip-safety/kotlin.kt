/*
 * Copyright 2024 Acme Corp. Licensed under the Apache License, Version 2.0.
 * strip-safety: removed=9
 * source: plugins/house-rules/test/fixtures/strip-safety/kotlin.kt
 */

@file:Suppress("UNUSED_VARIABLE", "WildcardImport")

package com.example.cache

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okio.Buffer
import okio.Source

/* /* nested block comment */ still outer */
val sentinel = 1

//noinspection SpellCheckingInspection
// ktlint-disable no-wildcard-imports
// language=SQL
// spotless:off
val rawSql = """
    SELECT *
    FROM users
    -- SQL comment, not Kotlin
    WHERE active = 1
""".trimIndent()
// spotless:on

//<editor-fold desc="Internal helpers">

/**
 * CacheEntry stores a single cached value with its expiry timestamp.
 *
 * @param key   The string key under which the value is stored.
 * @param value The cached payload; may be any serialisable type.
 * @param ttlMs Time-to-live in milliseconds from creation time.
 */
data class CacheEntry(
    val key: String,
    val value: Any,
    val ttlMs: Long,
)

// This comment is ordinary prose explaining nothing important about the code.
// It exists solely to inflate the comment density above the five-percent cap.
// The autofix is expected to remove this block of consecutive prose comments.
// Removing it does not alter any semantic behaviour of the program at all.
// Another prose line here to keep the block large enough to exceed the budget.
// Yet another line; the grouping logic bundles consecutive whole-line slashes.
// One more line so the removed count is unambiguous and easy to verify by hand.
// Final prose line in the first removable block — eight lines total removed here.

/**
 * MemoryCache is a lightweight in-process LRU cache backed by a LinkedHashMap.
 * It is safe for single-threaded use; callers must synchronise externally.
 */
class MemoryCache(private val maxSize: Int) {
    private val store = LinkedHashMap<String, CacheEntry>(16, 0.75f, true)

    /** Inserts or replaces the entry for [key]. Evicts LRU entry if over capacity. */
    fun put(key: String, entry: CacheEntry) {
        if (store.size >= maxSize) {
            store.iterator().apply { next(); remove() }
        }
        store[key] = entry
    }

    /** Returns the entry for [key], or null if absent or expired. */
    fun get(key: String): CacheEntry? {
        val e = store[key] ?: return null
        if (System.currentTimeMillis() > e.ttlMs) {
            store.remove(key)
            return null // entry expired; evict lazily
        }
        return e
    }
}

//</editor-fold>

/**
 * Reads all bytes from [source] into a fresh [Buffer] and returns it.
 * The caller is responsible for closing the returned buffer when done.
 */
fun readAll(source: Source): Buffer {
    val sink = Buffer()
    // Transfer bytes in 8 KiB chunks to avoid large heap allocations.
    val tmp = Buffer()
    while (source.read(tmp, 8192L) != -1L) {
        sink.writeAll(tmp)
    }
    return sink
}

// A raw string that happens to contain a double-slash sequence:
val embeddedProtocol = """https://example.com/api/v2"""

// Trailing url comment is kept because it contains a URL: https://kotlinlang.org/docs/coroutines-overview.html
val scope = CoroutineScope(Dispatchers.IO)

fun launchWork(block: suspend CoroutineScope.() -> Unit) {
    scope.launch(block = block)
}
