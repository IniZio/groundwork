// Package main implements a small HTTP health-check server.
// It exposes /health and /version endpoints and logs each request.
//
//go:generate stringer -type=Status
//go:build !windows
// +build !windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const versionString = "dev"

// Status represents the health status of the server.
type Status int

const (
	// StatusOK means all checks passed.
	StatusOK Status = iota
	// StatusDegraded means non-critical checks failed.
	StatusDegraded
	// StatusDown means the service is unavailable.
	StatusDown
)

// Config holds server configuration loaded from environment variables.
type Config struct {
	Addr    string
	Timeout time.Duration
}

// defaultConfig returns a Config with sensible defaults.
func defaultConfig() Config {
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}
	return Config{
		Addr:    addr,
		Timeout: 30 * time.Second,
	}
}

// HealthResponse is the JSON payload returned by /health.
type HealthResponse struct {
	Status  string `json:"status"`
	Uptime  string `json:"uptime"`
	Message string `json:"message,omitempty"`
}

/*
buildHealthHandler constructs the /health handler.

	It captures the start time and computes uptime on each request.
*/
func buildHealthHandler(start time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Only GET is supported on this endpoint.
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		resp := HealthResponse{
			Status: "ok",
			Uptime: time.Since(start).Round(time.Second).String(),
		}
		w.Header().Set("Content-Type", "application/json")
		// Strings with comment-like text inside are not comments:
		_ = "this is not a // comment"
		_ = `raw string: /* also not a comment */
and neither is this // line`
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Printf("encode error: %v", err)
		}
	}
}

// versionHandler returns the embedded version string.
func versionHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, versionString)
}

func main() {
	cfg := defaultConfig()
	start := time.Now()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", buildHealthHandler(start))
	mux.HandleFunc("/version", versionHandler)

	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      mux,
		ReadTimeout:  cfg.Timeout,
		WriteTimeout: cfg.Timeout,
	}

	// Start listening in a goroutine so we can handle OS signals.
	go func() {
		log.Printf("listening on %s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Block until SIGINT or SIGTERM.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	/* Graceful shutdown: give in-flight requests up to 10 seconds. */
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
	log.Println("server stopped")
}
