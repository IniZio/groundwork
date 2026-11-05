## Why

`moor run <box> -- <cmd>` through a controller now prints the command's output while it runs and exits with the command's status. Text mode prints the output on stdout, and `--json` prints it on stderr. Until now the output lived only in the controller's `runs/<id>.log`, which `moor close` deletes.

## What changed

- The controller follows `runs/<id>.log` and sends new bytes as the existing bytes frame. See [`follow.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor/src/ops/run/follow.rs#L23-L64).
- The client holds one frame at a time, so memory stays flat for any output size. See [`client.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor/src/client.rs#L246-L259).
- `PROTOCOL` goes from 7 to 8 in [`controller.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor-core/src/controller.rs#L14). A protocol 7 client now fails at hello.

## Scope

The run log merges stdout and stderr, so the client prints both on one stream. No test runs a real command through `moor controller serve`, because that path needs crabbox and the Proxy.

## Verification

```
cargo test -p moor --locked --test cli -- run_output
cargo test -p moor --locked --lib -- controller::tests::run_output controller::progress
```

The CLI tests in [`tests/cli/run_output.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor/tests/cli/run_output.rs#L78-L197) run the `moor` binary against a scripted controller socket. A 64 MiB output prints in full, and the client's peak RSS is 21.0 to 21.7 MiB.
