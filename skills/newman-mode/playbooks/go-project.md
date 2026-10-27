### Go project

**The language's own tools do the linting.** Set up golangci-lint v2, gofmt and govulncheck once, behind `make lint`. Do not copy their rules into house-rules. For the generic Makefile and CI parts load `handbook:dev-project-setup`. This page covers only what is Go-specific.

1. Pin the Go version in `go.mod` (`go 1.xx`). Install golangci-lint v2 and govulncheck in `make setup`.
2. Add `.golangci.yml`. Version 2 of the config format is required:
   ```yaml
   version: "2"

   linters:
     default: standard
     enable:
       - gocognit
       - nolintlint
     settings:
       gocognit:
         min-complexity: 10
       nolintlint:
         allow-unused: false
         require-explanation: true
         require-specific: true

   issues:
     max-issues-per-linter: 0
     max-same-issues: 0
   ```
   `nolintlint` makes every `//nolint` name the linter and give a reason (`//nolint:errcheck // closing a read-only file`). It also fails on a `//nolint` that suppresses nothing. A project with no `nolintlint` collects bare suppressions fast.
3. Adopting the config on an existing codebase: add `new-from-rev: <sha of HEAD>` under `issues:` so only new code is judged, and move the sha forward as the debt is paid. A fresh project does not need it.
4. Write the Make targets (names from the handbook contract). `make lint` includes the format check, so one command covers it:
   ```make
   GOLANGCI_LINT_VERSION = v2.13.2

   setup:
   	go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION)
   	go install golang.org/x/vuln/cmd/govulncheck@latest

   GOFMT_FILES = $(shell find . -name '*.go' -not -path './vendor/*')

   lint:
   	@out=$$(gofmt -l $(GOFMT_FILES)); if [ -n "$$out" ]; then printf '%s\n' "$$out"; echo "run: make format"; exit 1; fi
   	go vet ./...
   	golangci-lint run ./...

   format:
   	gofmt -w $(GOFMT_FILES)

   audit:
   	govulncheck ./...
   	go mod verify

   test:
   	go test -race -count=1 ./...

   ci: audit lint test
   ```
   `-count=1` stops Go from replaying a cached passing result.
5. Install the `house-rules` plugin for the rules that no Go tool owns: comment density and the lint-suppression rule.
6. Verify. Run `make lint` on the fresh project and see it pass. Then add a deliberate violation, for example an unchecked `os.Remove("x")` or a bare `//nolint`, and see `make lint` fail. Remove the violation.

**Reply:** the files added, the `make lint` result before and after the violation.
