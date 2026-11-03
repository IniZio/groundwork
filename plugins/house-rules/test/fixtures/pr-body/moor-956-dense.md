## What

`moor exec <box> [-i] -- <cmd> [args…]` runs a command inside a Box over the controller with ssh-like byte semantics: stdin is forwarded until EOF and then the remote stdin closes; stdout and stderr come back on their own frames, unchanged, with no PTY, banner, marker or escape character; the exit code is the command's (255 when moor itself fails, as ssh does); when the client goes away the remote process group is hung up. The Box is woken if asleep and the command runs under the Box's Proxy environment.

- Request `exec` and the `eof` / `stderr` frames beside the existing `bytes` ([request.rs](https://github.com/IniZio/moor/blob/11fb9fe7/crates/moor-core/src/request.rs#L111), [controller.rs](https://github.com/IniZio/moor/blob/11fb9fe7/crates/moor-core/src/controller.rs#L45)); the protocol version stays 15 because the change is additive.
- A `Driver::exec_piped` capability, unsupported by default; the crabbox adapter implements it with `ssh -T -e none BatchMode=yes`, passing the env through a byte-counted header so no stdin byte is lost, and recording the remote pgid for the hang-up ([crabbox/piped.rs](https://github.com/IniZio/moor/blob/11fb9fe7/crates/moor/src/adapters/crabbox/piped.rs#L44)).
- Docs: the `docs/cli.md` row and a "Byte pipe" paragraph with one external example, `hc machine add --name <box> --via 'moor exec <box> --'`.

Two problems the live check found are fixed in the last commit: a synchronous crabbox lease heartbeat cost 3.4 s of a 4.0 s call (it now runs detached), and the ssh mux master kept a killed client's command running and wedged the controller thread (moor now hangs up the remote group on stop).

## Why

Nothing in moor gave an external tool a byte-clean, long-lived stdio into a Box: `moor run` ignores stdin and costs seconds per call, and attach is a PTY with ssh's escape character on (#951), so binary payloads were corrupted. A spike needed marker framing and tilde doubling to get 1 MiB through.

## Checks

- `cargo test -p moor exec` (67), `cargo test -p moor controller` (258), `cargo test -p moor-core` (1081): pass. New tests cover the pump (a 1 MiB blob containing `\n~.` and `\n~C`, stderr kept apart, EOF, stop and kill), the crabbox wrapper under dash, the controller through the real client and the fake driver, the op, and the CLI binary (`head -n1` prints hi, `exit 7` exits 7).
- `make lint`: pass.
- Live, on a separate controller with its own state and a dummy secret: start 43 s; `echo hi | head -n1` 0.55 s; `exit 7` 0.57 s; 1 MiB random and the escape blob byte-identical in 0.66 s; stdout and stderr apart; a killed client's remote command gone within 0.8 s; close 12.7 s.

One existing test pin changed: the access-control registry in `controller/tests/authz.rs` declares `exec` and counts 26 request kinds instead of 25, as the attach commit did. `--tty` is out of scope. Larger than the usual review size because the protocol, driver, adapter and CLI slices are coupled; the four commits split them.

Closes #951 for the exec path; attach itself still carries the escape character.


