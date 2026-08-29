/**
 * GwEnvelope — the single machine-parseable output shape for every gw command.
 * Emitted as one JSON line to stdout when --json is passed.
 * exit: 0=success, 1=operational failure, 2=usage error.
 */
export type GwEnvelope =
  | { ok: true; command: string; data: unknown; exit: 0 }
  | { ok: false; command: string; error: { code: string; message: string }; exit: 1 | 2 }

export function okEnvelope(command: string, data: unknown): GwEnvelope {
  return { ok: true, command, data, exit: 0 }
}

export function errEnvelope(
  command: string,
  code: string,
  message: string,
  exit: 1 | 2 = 1,
): GwEnvelope {
  return { ok: false, command, error: { code, message }, exit }
}
