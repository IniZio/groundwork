`moor run <box> -- <cmd>` through a controller now prints the command's output while it runs and exits with the command's status. Text mode prints the output on stdout. `--json` prints it on stderr, so stdout stays one envelope. Until now the client printed only progress lines, and the output lived only in the controller's `runs/<id>.log`, which `moor close` deletes.

## What changed

- The controller follows `runs/<id>.log` and sends new bytes as the existing bytes frame that `artifact-read` uses. It buffers at most 4 pieces of 64 KiB for a slow client and leaves the log in place. See [`follow.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor/src/ops/run/follow.rs#L23-L64) ([diff](https://github.com/IniZio/moor/pull/421/files#diff-aafe30aa33303437cde2d80140f7ba7334d4b23ceeddf98f04baade5565e46ac)) and [`progress.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor/src/controller/progress.rs#L51-L93) ([diff](https://github.com/IniZio/moor/pull/421/files#diff-2a5a39de7c9734453a4448de1712f584f151d5f420ae37e6136d68824635e631)).
- The client holds one frame at a time, so memory stays flat for any output size. See [`client.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor/src/client.rs#L246-L259) ([diff](https://github.com/IniZio/moor/pull/421/files#diff-7b71bad872912885d2a55a82f7fe4bc09ea059024b5f86224856ed8370707748)) and [`remote.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor/src/client/remote.rs#L33-L42) ([diff](https://github.com/IniZio/moor/pull/421/files#diff-080ea4c0008f4cf7f125798d9bc8996bc06c36e55185138d132b80ec64fedbf9)).
- `PROTOCOL` goes from 7 to 8 in [`controller.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor-core/src/controller.rs#L14) ([diff](https://github.com/IniZio/moor/pull/421/files#diff-85b225d58b2eec98441267978988c4739fef508c6a429cf84698e1ac4b143fd7)). A protocol 7 client would reject the first bytes frame of a run. With the bump, it fails at hello instead.

## Limits

The run log merges the command's stdout and stderr into one file. The client therefore prints both on one stream, in log order. A progress line appears only after 5 s without output. No test runs a real command through `moor controller serve`, because that path needs crabbox and the Proxy.

## How to verify

```
cargo test -p moor --locked --test cli -- run_output
cargo test -p moor --locked --lib -- controller::tests::run_output controller::progress
```

The CLI tests in [`tests/cli/run_output.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor/tests/cli/run_output.rs#L78-L197) ([diff](https://github.com/IniZio/moor/pull/421/files#diff-544ef443ca376f48bf07f7e89229db77caffefb3a3f2666c99544c70cc66968d)) run the `moor` binary against a scripted controller socket. They check stdout, `--json` stderr, exit status 3, and a 64 MiB output that the client prints in full before the controller answers. The client's peak RSS is 21.0 to 21.7 MiB, the same as for a 64 KiB output. The library test in [`controller/tests/run_output.rs`](https://github.com/IniZio/moor/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/crates/moor/src/controller/tests/run_output.rs#L54-L107) ([diff](https://github.com/IniZio/moor/pull/421/files#diff-7e203e16fa9df3636eb96411bf4089e7dd2fbaf5d32e96a592c30b36d0614260)) runs the real client and connection handler over a Unix socket with a fake driver. It sees the first line of output before the command ends.


