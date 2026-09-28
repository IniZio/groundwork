// strip-safety: removed=7
// source: plugins/house-rules/test/fixtures/languages/go.go (HEAD) lines 1-130
// Package store implements a small in-memory key-value cache with TTL expiry.
// It exposes a thread-safe Get/Set interface and supports optional persistence.
//
//go:build !windows
// +build !windows

//go:generate stringer -type=StoreStatus

package store

import (
	"context"
	"embed"
	"fmt"
	"sync"
	"time"
)

//go:embed assets/defaults.json
var defaultsFS embed.FS

// StoreStatus represents the operational status of the cache.
type StoreStatus int

const (
	// StatusIdle means the store is running but has no pending work.
	StatusIdle StoreStatus = iota
	// StatusFlushing means a background persistence flush is in progress.
	StatusFlushing
	// StatusShutdown means the store has been stopped.
	StatusShutdown
)

// Config holds tunable parameters for the store loaded from defaults.json.
type Config struct {
	MaxEntries int           // upper bound on the number of cached entries
	DefaultTTL time.Duration // time-to-live applied when none is specified
}

// entry is the internal storage type for a single cache record.
type entry struct {
	value   any
	expiresAt time.Time
}

// Store is the main cache type; all exported methods are safe for concurrent use.
type Store struct {
	mu      sync.RWMutex
	items   map[string]entry
	cfg     Config
	status  StoreStatus
}

// New creates and returns a Store configured with cfg.
func New(cfg Config) *Store {
	// Initialise the backing map with a capacity hint to reduce rehashing.
	return &Store{
		items: make(map[string]entry, cfg.MaxEntries),
		cfg:   cfg,
	}
}

/*
 * Set stores a value under key with the default TTL from the config.
 * If the store is at capacity, the oldest entry is evicted first.
 * This comment block is intentionally verbose to stress byte-safety.
 */
//nolint:errcheck
func (s *Store) Set(key string, value any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Compute the expiry time from the current wall clock.
	exp := time.Now().Add(s.cfg.DefaultTTL)
	s.items[key] = entry{value: value, expiresAt: exp} // store under key
}

// Get retrieves a value from the store, returning false when missing or expired.
func (s *Store) Get(key string) (any, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.items[key]
	if !ok {
		return nil, false // key absent
	}
	/*
	 * Two-phase expiry check: first confirm the entry exists,
	 * then compare the current wall time against the stored deadline.
	 * Both conditions must hold for the entry to be considered live.
	 */
	// Check whether the entry has passed its expiry time.
	if time.Now().After(e.expiresAt) {
		return nil, false // entry expired
	}
	return e.value, true
}

// Shutdown transitions the store to StatusShutdown and releases resources.
func (s *Store) Shutdown(_ context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Mark the store as stopped so callers know not to issue new requests.
	s.status = StatusShutdown
	s.items = nil // release the backing map to the GC
	return nil
}

//export StoreVersion
func StoreVersion() string {
	// Return a hardcoded version string for the CGo-exported function.
	return fmt.Sprintf("store/%d", StatusShutdown)
}
