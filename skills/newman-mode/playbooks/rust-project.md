### Rust project

**The language's own tools do the linting.** Set up clippy, rustfmt, taplo, typos and cargo-deny once, behind `make lint`. Do not copy their rules into house-rules. For the generic Makefile and CI parts load `handbook:dev-project-setup`. This page covers only what is Rust-specific.

1. Pin the toolchain in `rust-toolchain.toml`:
   ```toml
   [toolchain]
   channel = "<current stable, e.g. 1.98.1>"
   components = ["rustfmt", "clippy"]
   profile = "minimal"
   ```
2. Add `rustfmt.toml` (`edition = "2021"` or the project edition) and `taplo.toml` (`[formatting]` with `reorder_keys = false`; `include` lists every `*.toml` the project owns). Add `_typos.toml` with `[files] extend-exclude = ["target/", "Cargo.lock"]`.
3. Add `clippy.toml`:
   ```toml
   cognitive-complexity-threshold = 10
   too-many-lines-threshold = 60
   too-many-arguments-threshold = 6
   allow-unwrap-in-tests = true
   allow-expect-in-tests = true
   ```
4. Turn on lints in `Cargo.toml` (`[workspace.lints.*]` for a workspace, with `[lints] workspace = true` in each member):
   ```toml
   [lints.rust]
   unsafe_code = "forbid"

   [lints.clippy]
   pedantic = { level = "deny", priority = -1 }
   nursery = { level = "deny", priority = -1 }
   cognitive_complexity = "deny"
   unwrap_used = "deny"
   expect_used = "deny"
   panic = "deny"
   todo = "deny"
   unimplemented = "deny"
   dbg_macro = "deny"
   indexing_slicing = "deny"
   string_slice = "deny"
   exit = "deny"
   allow_attributes = "deny"
   allow_attributes_without_reason = "deny"
   ```
   `allow_attributes` and `allow_attributes_without_reason` are in clippy's restriction group, so they stay off until you name them. They push every suppression to `#[expect(lint, reason = "why")]`. An `expect` fails the build once the lint stops firing, so stale suppressions cannot pile up.
5. Add `deny.toml` with `[advisories] yanked = "deny"`, a `[licenses] allow` list of the licences the project accepts, and `[graph] targets` for the platforms you ship. Each `ignore` entry needs a `reason`.
6. Write the Make targets (names from the handbook contract). `make lint` includes the format check, so one command covers it:
   ```make
   setup:
   	rustup show
   	cargo install --locked taplo-cli typos-cli cargo-deny

   lint:
   	cargo fmt --all --check
   	taplo fmt --check
   	typos
   	cargo clippy --workspace --all-targets --locked -- -D warnings

   format:
   	cargo fmt --all
   	taplo fmt

   audit:
   	cargo deny check

   test:
   	cargo test --workspace --locked

   ci: audit lint test
   ```
7. Install the `house-rules` plugin for the rules that no Rust tool owns: comment density and the lint-suppression rule.
8. Verify. Run `make lint` on the fresh project and see it pass. Then add a deliberate violation, for example `let x = Some(1).unwrap();` or a badly indented line, and see `make lint` fail. Remove the violation.

**Reply:** the files added, the `make lint` result before and after the violation.
