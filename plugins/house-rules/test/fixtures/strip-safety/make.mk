# source: plugins/house-rules/test/fixtures/languages/make.mk (adapted for strip-safety probe)
# strip-safety: removed=16
# Makefile for a small C project — strip-safety fixture.
# Demonstrates variables, phony targets, pattern rules, and recipe comments.

# groundwork-rule: no-console-log
# groundwork-rule: no-ts-any

# Project identity
PROJECT = myapp
VERSION = 1.0.0

# Compiler and linker flags
CC      = gcc
CFLAGS  = -Wall -Wextra -O2 -std=c11
LDFLAGS =

# Source layout
SRC_DIR = src
OBJ_DIR = obj
BIN_DIR = bin

# Derived file lists
SRCS   = $(wildcard $(SRC_DIR)/*.c)
OBJS   = $(patsubst $(SRC_DIR)/%.c,$(OBJ_DIR)/%.o,$(SRCS))
TARGET = $(BIN_DIR)/$(PROJECT)

# Installation root; can be overridden with make install PREFIX=/opt/local
PREFIX ?= /usr/local
BINDIR  = $(PREFIX)/bin

# Default target — build the project binary
.PHONY: all
all: $(TARGET)

# Link object files into the final binary
$(TARGET): $(OBJS) | $(BIN_DIR)
	$(CC) $(LDFLAGS) -o $@ $^
	# Record the version tag in the build log so CI can trace which commit produced this binary.
	@echo "Built $(TARGET) v$(VERSION)"

# Compile each .c file into a .o under OBJ_DIR
$(OBJ_DIR)/%.o: $(SRC_DIR)/%.c | $(OBJ_DIR)
	$(CC) $(CFLAGS) -I$(SRC_DIR) -c -o $@ $<

# Create OBJ_DIR if it does not already exist
$(OBJ_DIR):
	mkdir -p $(OBJ_DIR)

$(BIN_DIR):
	mkdir -p $(BIN_DIR)

# Run the full test suite against the compiled binary
.PHONY: test
test: $(TARGET)
	# Execute the integration test runner; exits non-zero on any failure.
	./scripts/run-tests.sh
	@echo "# not a Makefile comment — this is inside a shell echo string"

# Remove build artefacts to force a clean rebuild
.PHONY: clean
clean:
	rm -rf $(OBJ_DIR) $(BIN_DIR)
	# Print a confirmation so the developer knows the clean completed.
	@echo "Cleaned build artefacts"

# Install the binary into BINDIR
.PHONY: install
install: $(TARGET)
	install -d $(DESTDIR)$(BINDIR)
	install -m 755 $(TARGET) $(DESTDIR)$(BINDIR)/$(PROJECT)

# Display build configuration for quick sanity checks
.PHONY: info
info:
	@echo "Project : $(PROJECT)"
	@echo "Version : $(VERSION)"
	@echo "Sources : $(SRCS)"

# Show available make targets
.PHONY: help
help:
	@echo "Targets: all test clean install info help"

# Variable whose value happens to contain a hash character — not a comment.
CHANGELOG_HEADING = "## v$(VERSION)"

HASH_CHAR = \#

define BUILD_STEP
# this hash line is body text handed to the shell, not a Makefile comment
echo building $(1) # shell comment inside the define body
endef
