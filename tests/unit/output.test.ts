import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { output, outputError } from "../../src/core/output.js";
import type { GlobalOptions, Breadcrumb } from "../../src/cli/types.js";
import { ExitCode } from "../../src/cli/types.js";

// Capture stdout/stderr writes
let stdoutChunks: string[];
let stderrChunks: string[];
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
  stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

function globals(overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return {
    endpoint: "https://api.ano.dev",
    ...overrides,
  };
}

const sampleBreadcrumbs: Breadcrumb[] = [
  {
    action: "view",
    cmd: "ano channels list",
    description: "list all channels",
  },
];

describe("output() with --json", () => {
  it("produces correct OutputEnvelope", () => {
    const data = { id: "123", name: "general" };
    output(globals({ json: true }), {
      data,
      breadcrumbs: sampleBreadcrumbs,
    });

    const raw = stdoutChunks.join("");
    const envelope = JSON.parse(raw);

    expect(envelope.ok).toBe(true);
    expect(envelope.data).toEqual(data);
    expect(envelope.breadcrumbs).toEqual(sampleBreadcrumbs);
    expect(envelope.meta).toBeDefined();
    expect(envelope.meta.timestamp).toBeTruthy();
    expect(typeof envelope.meta.version).toBe("string");
  });

  it("includes empty breadcrumbs when none provided", () => {
    output(globals({ json: true }), { data: "hello" });
    const envelope = JSON.parse(stdoutChunks.join(""));
    expect(envelope.breadcrumbs).toEqual([]);
  });
});

describe("output() with --md", () => {
  it("renders a GFM table for array data with columns", () => {
    output(globals({ md: true }), {
      data: [{ name: "general" }, { name: "random" }],
      columns: ["name"],
      title: "Channels",
    });

    const raw = stdoutChunks.join("");
    expect(raw).toContain("## Channels");
    expect(raw).toContain("name");
    expect(raw).toContain("general");
    expect(raw).toContain("random");
  });

  it("falls back to JSON for non-array data", () => {
    output(globals({ md: true }), { data: { key: "value" } });
    const raw = stdoutChunks.join("");
    expect(raw).toContain('"key"');
    expect(raw).toContain('"value"');
  });

  it("renders breadcrumbs as next steps", () => {
    output(globals({ md: true }), {
      data: [],
      columns: ["x"],
      breadcrumbs: sampleBreadcrumbs,
    });
    const raw = stdoutChunks.join("");
    expect(raw).toContain("**Next steps:**");
    expect(raw).toContain("`ano channels list`");
  });
});

describe("output() with --quiet", () => {
  it("outputs raw JSONL for arrays", () => {
    output(globals({ quiet: true }), {
      data: [{ a: 1 }, { a: 2 }],
    });

    const lines = stdoutChunks.join("").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[1])).toEqual({ a: 2 });
  });

  it("outputs single JSON line for scalar data", () => {
    output(globals({ quiet: true }), { data: "hello" });
    const raw = stdoutChunks.join("").trim();
    expect(JSON.parse(raw)).toBe("hello");
  });
});

describe("output() with --agent", () => {
  it("behaves like --quiet (raw JSONL)", () => {
    output(globals({ agent: true }), {
      data: [{ x: 1 }],
    });
    const raw = stdoutChunks.join("").trim();
    expect(JSON.parse(raw)).toEqual({ x: 1 });
  });
});

describe("output() default (styled)", () => {
  it("renders a table for array data with columns", () => {
    output(globals(), {
      data: [{ name: "general" }],
      columns: ["name"],
    });
    const raw = stdoutChunks.join("");
    expect(raw).toContain("name");
    expect(raw).toContain("general");
  });

  it("renders JSON for non-array data", () => {
    output(globals(), { data: { foo: "bar" } });
    const raw = stdoutChunks.join("");
    expect(raw).toContain('"foo"');
  });

  it("renders title when provided", () => {
    output(globals(), {
      data: [{ id: "1" }],
      columns: ["id"],
      title: "Items",
    });
    const raw = stdoutChunks.join("");
    expect(raw).toContain("Items");
  });
});

describe("outputError()", () => {
  it("in --json mode writes structured error to stdout", () => {
    outputError(globals({ json: true }), "bad request", ExitCode.USAGE, "fix it");
    const raw = stdoutChunks.join("");
    const obj = JSON.parse(raw);
    expect(obj.ok).toBe(false);
    expect(obj.error).toBe("bad request");
    expect(obj.code).toBe(ExitCode.USAGE);
    expect(obj.hint).toBe("fix it");
  });

  it("in --json mode omits hint when not provided", () => {
    outputError(globals({ json: true }), "bad request", ExitCode.USAGE);
    const obj = JSON.parse(stdoutChunks.join(""));
    expect(obj.hint).toBeUndefined();
  });

  it("in --agent mode writes structured error to stdout", () => {
    outputError(globals({ agent: true }), "fail", ExitCode.API_ERROR);
    const obj = JSON.parse(stdoutChunks.join(""));
    expect(obj.ok).toBe(false);
    expect(obj.error).toBe("fail");
  });

  it("in --quiet mode writes structured error to stdout", () => {
    outputError(globals({ quiet: true }), "fail", ExitCode.API_ERROR);
    const obj = JSON.parse(stdoutChunks.join(""));
    expect(obj.ok).toBe(false);
  });

  it("in --md mode writes markdown error to stdout", () => {
    outputError(globals({ md: true }), "bad", ExitCode.USAGE, "try again");
    const raw = stdoutChunks.join("");
    expect(raw).toContain("**Error:** bad");
    expect(raw).toContain("*try again*");
  });

  it("in default mode writes to stderr", () => {
    outputError(globals(), "something failed", ExitCode.API_ERROR, "check logs");
    expect(stderrChunks.join("")).toContain("something failed");
    expect(stderrChunks.join("")).toContain("check logs");
    // stdout should be empty
    expect(stdoutChunks.join("")).toBe("");
  });
});
