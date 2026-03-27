import type {
  GlobalOptions,
  Breadcrumb,
  OutputEnvelope,
  ExitCode,
} from "../cli/types.js";
import { renderTable } from "../util/table.js";
import { dim, bold, green, red } from "../util/colors.js";

declare const __VERSION__: string;

export interface OutputPayload<T = unknown> {
  data: T;
  breadcrumbs?: Breadcrumb[];
  columns?: string[];
  title?: string;
}

export function output<T>(globals: GlobalOptions, payload: OutputPayload<T>) {
  const breadcrumbs = payload.breadcrumbs ?? [];

  if (globals.json) {
    outputJson(payload.data, breadcrumbs);
  } else if (globals.md) {
    outputMarkdown(payload, breadcrumbs);
  } else if (globals.quiet || globals.agent) {
    outputRaw(payload.data);
  } else {
    outputStyled(payload, breadcrumbs);
  }
}

export function outputError(
  globals: GlobalOptions,
  message: string,
  exitCode: ExitCode,
  hint?: string,
) {
  if (globals.json || globals.agent || globals.quiet) {
    const obj: Record<string, unknown> = {
      ok: false,
      error: message,
      code: exitCode,
    };
    if (hint) obj.hint = hint;
    process.stdout.write(JSON.stringify(obj) + "\n");
  } else if (globals.md) {
    process.stdout.write(`**Error:** ${message}\n`);
    if (hint) process.stdout.write(`*${hint}*\n`);
  } else {
    process.stderr.write(`${red("Error:")} ${message}\n`);
    if (hint) process.stderr.write(`${dim(hint)}\n`);
  }
}

function outputJson<T>(data: T, breadcrumbs: Breadcrumb[]) {
  const envelope: OutputEnvelope<T> = {
    ok: true,
    data,
    breadcrumbs,
    meta: {
      timestamp: new Date().toISOString(),
      version: typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev",
    },
  };
  process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
}

function outputMarkdown<T>(
  payload: OutputPayload<T>,
  breadcrumbs: Breadcrumb[],
) {
  if (payload.title) {
    process.stdout.write(`## ${payload.title}\n\n`);
  }

  if (Array.isArray(payload.data) && payload.columns) {
    process.stdout.write(
      renderTable(
        payload.data as Record<string, unknown>[],
        payload.columns,
      ) + "\n",
    );
  } else {
    process.stdout.write(JSON.stringify(payload.data, null, 2) + "\n");
  }

  if (breadcrumbs.length > 0) {
    process.stdout.write("\n**Next steps:**\n");
    for (const b of breadcrumbs) {
      process.stdout.write(`- \`${b.cmd}\` — ${b.description}\n`);
    }
  }
}

function outputRaw<T>(data: T) {
  if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(JSON.stringify(item) + "\n");
    }
  } else {
    process.stdout.write(JSON.stringify(data) + "\n");
  }
}

function outputStyled<T>(
  payload: OutputPayload<T>,
  breadcrumbs: Breadcrumb[],
) {
  if (payload.title) {
    process.stdout.write(`${bold(payload.title)}\n\n`);
  }

  if (Array.isArray(payload.data) && payload.columns) {
    process.stdout.write(
      renderTable(
        payload.data as Record<string, unknown>[],
        payload.columns,
      ) + "\n",
    );
  } else {
    process.stdout.write(JSON.stringify(payload.data, null, 2) + "\n");
  }

  if (breadcrumbs.length > 0) {
    process.stdout.write(`\n${dim("Next steps:")}\n`);
    for (const b of breadcrumbs) {
      process.stdout.write(`  ${green(b.cmd)}  ${dim(b.description)}\n`);
    }
  }
}
