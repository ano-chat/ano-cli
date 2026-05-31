import {
  PROTOCOL_VERSION,
  frame,
  type DaemonError,
  type DaemonResponse,
  type ExecRequest,
} from "../../../daemon/protocol.js";
import { dispatchCli, prewarmDaemonRuntime } from "../../../daemon/server.js";

declare const __VERSION__: string;

const STARTED_AT = Date.now();

type DispatchFn = (req: ExecRequest) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

export async function runAgentStdio(): Promise<void> {
  if (process.env.ANO_AGENT_STDIO_SKIP_PREWARM !== "1") {
    prewarmDaemonRuntime();
  }

  process.stdin.setEncoding("utf8");

  let buffer = "";
  let queue = Promise.resolve();

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      queue = queue
        .then(() => handleLine(line))
        .catch((err) => {
          writeResponse(
            errorResponse(
              0,
              err instanceof Error ? err.message : String(err),
              "internal",
            ),
          );
        });
    }
  });

  process.stdin.on("end", () => {
    queue.finally(() => process.exit(0));
  });

  process.stdin.resume();
}

export async function handleAgentStdioRequest(
  raw: unknown,
  dispatchFn: DispatchFn = dispatchCli,
): Promise<DaemonResponse> {
  const req = raw as Record<string, unknown> | null;
  const id = typeof req?.id === "number" ? req.id : 0;

  if (!req || typeof req !== "object") {
    return errorResponse(id, "request must be an object", "unknown_method");
  }
  if (req.v !== PROTOCOL_VERSION) {
    return errorResponse(
      id,
      `stdio protocol v${PROTOCOL_VERSION}; client sent v${String(req.v)}`,
      "version_mismatch",
    );
  }
  if (req.method === "ping") {
    return {
      id,
      ok: true,
      pong: true,
      pid: process.pid,
      startedAt: STARTED_AT,
      v: PROTOCOL_VERSION,
      cliVersion: cliVersion(),
    };
  }
  if (req.method === "shutdown") {
    setTimeout(() => process.exit(0), 50);
    return errorResponse(id, "shutting down", "shutdown_acked");
  }
  if (req.method !== undefined && req.method !== "exec") {
    return errorResponse(
      id,
      `unknown method: ${String(req.method)}`,
      "unknown_method",
    );
  }

  if (!Array.isArray(req.argv) || req.argv.length === 0) {
    return errorResponse(
      id,
      "exec request requires argv: string[]",
      "unknown_method",
    );
  }
  if (!req.argv.every((v): v is string => typeof v === "string")) {
    return errorResponse(
      id,
      "exec argv must contain only strings",
      "unknown_method",
    );
  }
  const argv = req.argv;

  const rejection = rejectArgv(argv);
  if (rejection) return rejection(id);

  const t0 = performance.now();
  let result: Awaited<ReturnType<DispatchFn>>;
  try {
    result = await dispatchFn({
      method: "exec",
      id,
      v: PROTOCOL_VERSION,
      cliVersion: cliVersion(),
      argv,
      cwd: typeof req.cwd === "string" ? req.cwd : process.cwd(),
      env: normalizeEnv(req.env),
    });
  } catch (err) {
    return errorResponse(
      id,
      err instanceof Error ? err.message : String(err),
      "internal",
    );
  }

  return {
    id,
    ok: true,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    dispatchMs: Math.round(performance.now() - t0),
  };
}

async function handleLine(line: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    writeResponse(errorResponse(0, "invalid JSON frame", "unknown_method"));
    return;
  }
  writeResponse(await handleAgentStdioRequest(parsed));
}

function writeResponse(resp: DaemonResponse): void {
  process.stdout.write(frame(resp));
}

function normalizeEnv(env: unknown): Record<string, string> {
  const source =
    env && typeof env === "object"
      ? (env as Record<string, unknown>)
      : process.env;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function rejectArgv(argv: string[]): ((id: number) => DaemonError) | null {
  const [top, sub] = topAndSub(argv);
  if (top === "connect" || (top === "daemon" && sub === "serve")) {
    return (id) =>
      errorResponse(
        id,
        `stdio mode does not host long-running '${top === "connect" ? "connect" : "daemon serve"}'`,
        "unknown_method",
      );
  }
  if (top === "agent" && sub === "stdio") {
    return (id) =>
      errorResponse(
        id,
        "recursive agent stdio is unsupported",
        "unknown_method",
      );
  }
  if (looksLikeStdinFile(argv)) {
    return (id) =>
      errorResponse(
        id,
        "commands that read stdin cannot run inside agent stdio",
        "stdin_unsupported",
      );
  }
  if (!hasMachineOutputFlag(argv)) {
    return (id) =>
      errorResponse(
        id,
        "agent stdio exec requires machine-readable output; add --agent, --json, or --quiet to argv",
        "machine_output_required",
      );
  }
  return null;
}

function topAndSub(argv: string[]): [string | null, string | null] {
  const valueFlags = new Set([
    "--key",
    "-k",
    "--endpoint",
    "-e",
    "--workspace",
    "-w",
    "--profile",
    "-p",
  ]);
  let top: string | null = null;
  let sub: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (valueFlags.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    if (top === null) top = arg;
    else if (sub === null) {
      sub = arg;
      break;
    }
  }
  return [top, sub];
}

function looksLikeStdinFile(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--file" || arg === "-f") && argv[i + 1] === "-") return true;
    if (arg === "--file=-" || arg === "-f=-") return true;
  }
  return false;
}

function hasMachineOutputFlag(argv: string[]): boolean {
  return argv.some(
    (arg) =>
      arg === "--agent" ||
      arg === "--json" ||
      arg === "--quiet" ||
      arg === "-j" ||
      arg === "-q" ||
      arg.startsWith("--agent=") ||
      arg.startsWith("--json=") ||
      arg.startsWith("--quiet="),
  );
}

function errorResponse(
  id: number,
  error: string,
  code: DaemonError["code"],
): DaemonError {
  return { id, ok: false, error, code };
}

function cliVersion(): string {
  return typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev";
}
