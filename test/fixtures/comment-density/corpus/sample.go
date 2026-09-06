package main

import "fmt"

// Package-level comment
// spanning two lines

// greet returns a greeting
func greet(name string) string {
	// build the message
	return fmt.Sprintf("Hello, %s", name)
}

/* block comment in Go */
var url = "http://not.a.comment"
