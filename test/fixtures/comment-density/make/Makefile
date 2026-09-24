# Makefile for a small C project (groundwork test fixture)
# Demonstrates variables, rules, phony targets, and pattern rules.

# Project metadata
PROJECT = myapp
VERSION = 1.0.0

# Compiler settings
CC = gcc
CFLAGS = -Wall -Wextra -O2 -std=c11
LDFLAGS =
LIBS =

# Directories
SRC_DIR = src
OBJ_DIR = obj
BIN_DIR = bin
INCLUDE_DIR = include

# Source and object files
SRCS = $(wildcard $(SRC_DIR)/*.c)
OBJS = $(patsubst $(SRC_DIR)/%.c,$(OBJ_DIR)/%.o,$(SRCS))
TARGET = $(BIN_DIR)/$(PROJECT)

# Installation prefix
PREFIX ?= /usr/local
BINDIR = $(PREFIX)/bin

# Default target: build the project
.PHONY: all
all: $(TARGET)

# Link the final binary
$(TARGET): $(OBJS) | $(BIN_DIR)
	$(CC) $(LDFLAGS) -o $@ $^ $(LIBS)
	@echo "Built $(TARGET) v$(VERSION)"

# Compile each .c to .o (pattern rule)
$(OBJ_DIR)/%.o: $(SRC_DIR)/%.c | $(OBJ_DIR)
	$(CC) $(CFLAGS) -I$(INCLUDE_DIR) -c -o $@ $<

# Create output directories if they do not exist
$(OBJ_DIR):
	mkdir -p $(OBJ_DIR)

$(BIN_DIR):
	mkdir -p $(BIN_DIR)

# Run the test suite
.PHONY: test
test: $(TARGET)
	# Run unit tests using the built binary
	./scripts/run-tests.sh
	@echo "# not a comment inside echo string"
	echo hello # inline comment after recipe command

# Install the binary to PREFIX
.PHONY: install
install: $(TARGET)
	install -d $(DESTDIR)$(BINDIR)
	install -m 755 $(TARGET) $(DESTDIR)$(BINDIR)/$(PROJECT)
	@echo "Installed to $(DESTDIR)$(BINDIR)/$(PROJECT)"

# Uninstall the binary
.PHONY: uninstall
uninstall:
	rm -f $(DESTDIR)$(BINDIR)/$(PROJECT)

# Remove compiled objects and binary
.PHONY: clean
clean:
	rm -rf $(OBJ_DIR) $(BIN_DIR)
	@echo "Cleaned build artifacts"

# Remove everything including generated files
.PHONY: distclean
distclean: clean
	rm -f config.h

# Show project info
.PHONY: info
info:
	@echo "Project: $(PROJECT)"
	@echo "Version: $(VERSION)"
	@echo "Sources: $(SRCS)"

# Check code formatting with clang-format
.PHONY: fmt
fmt:
	clang-format -i $(SRC_DIR)/*.c $(INCLUDE_DIR)/*.h

# Static analysis target
.PHONY: lint
lint:
	cppcheck --enable=all $(SRC_DIR)/

# Print help
.PHONY: help
help:
	@echo "Available targets:"
	@echo "  all       - Build the project (default)"
	@echo "  test      - Run tests"
	@echo "  install   - Install binary to $(BINDIR)"
	@echo "  uninstall - Remove installed binary"
	@echo "  clean     - Remove build artifacts"
	@echo "  distclean - Remove everything generated"
	@echo "  fmt       - Format source files"
	@echo "  lint      - Run static analysis"
	@echo "  info      - Show project configuration"
	@echo "  help      - Show this help message"
