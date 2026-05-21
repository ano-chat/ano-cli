/**
 * Tests for `src/cli/file-attachments.ts`. The `--file` flag is the
 * only Claude-facing way to attach screenshots / docs from disk, so
 * the path resolution + size validation + MIME inference all need
 * coverage.
 *
 * The upload itself is mocked at the api-client boundary; what matters
 * here is that:
 *   • paths are deduped + made absolute
 *   • missing / oversize / unsupported files surface a clear error
 *   • each prepared file is uploaded once, in input order
 *   • a partial-batch failure surfaces the offending filename
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileAttachmentError,
  readFileForUpload,
  resolveFiles,
  uploadAttachments,
} from "../../src/cli/file-attachments.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "ano-file-attach-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("resolveFiles", () => {
  it("returns [] for absent / empty input", () => {
    expect(resolveFiles(undefined)).toEqual([]);
    expect(resolveFiles(null)).toEqual([]);
    expect(resolveFiles([])).toEqual([]);
    expect(resolveFiles("")).toEqual([]);
  });

  it("makes a single relative path absolute", () => {
    const out = resolveFiles("foo.png");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/foo\.png$/);
    expect(out[0].startsWith("/")).toBe(true);
  });

  it("dedupes repeated entries", () => {
    const out = resolveFiles(["a.png", "a.png", "b.png"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/a\.png$/);
    expect(out[1]).toMatch(/b\.png$/);
  });

  it("splits comma-separated entries", () => {
    const out = resolveFiles("a.png,b.png");
    expect(out).toHaveLength(2);
  });

  it("preserves absolute paths verbatim", () => {
    const out = resolveFiles("/tmp/x.png");
    expect(out).toEqual(["/tmp/x.png"]);
  });

  it("handles mixed array + comma-separated input", () => {
    const out = resolveFiles(["a.png,b.png", "c.png"]);
    expect(out).toHaveLength(3);
  });
});

describe("readFileForUpload", () => {
  it("returns body+mime for a supported file", async () => {
    const path = join(workDir, "shot.png");
    await writeFile(path, Buffer.from([0xff, 0xd8, 0xff]));
    const result = await readFileForUpload(path);
    expect(result.filename).toBe("shot.png");
    expect(result.contentType).toBe("image/png");
    expect(result.body.byteLength).toBe(3);
  });

  it("throws FileAttachmentError on missing file", async () => {
    await expect(
      readFileForUpload(join(workDir, "nope.png")),
    ).rejects.toBeInstanceOf(FileAttachmentError);
  });

  it("throws on empty file", async () => {
    const path = join(workDir, "empty.pdf");
    await writeFile(path, "");
    await expect(readFileForUpload(path)).rejects.toBeInstanceOf(
      FileAttachmentError,
    );
  });

  it("throws on unsupported extension", async () => {
    const path = join(workDir, "weird.xyz");
    await writeFile(path, "hi");
    await expect(readFileForUpload(path)).rejects.toThrow(
      /Unsupported file type/,
    );
  });

  it("rejects oversize files", async () => {
    const path = join(workDir, "big.pdf");
    // 26 MB sparse-ish buffer; node will allocate it but the test
    // process keeps it briefly.
    await writeFile(path, Buffer.alloc(26 * 1024 * 1024, 0x20));
    await expect(readFileForUpload(path)).rejects.toThrow(/25 MB/);
  });

  it("infers MIME for common doc types", async () => {
    const cases: Array<[string, string]> = [
      ["a.pdf", "application/pdf"],
      ["a.txt", "text/plain"],
      ["a.md", "text/markdown"],
      ["a.json", "application/json"],
      ["a.csv", "text/csv"],
      // HTML attachments are server-side force-downloaded; here we just
      // need the CLI's extension → MIME map to allow them through.
      ["demo.html", "text/html"],
      ["demo.htm", "text/html"],
    ];
    for (const [name, expected] of cases) {
      const path = join(workDir, name);
      await writeFile(path, "x");
      const r = await readFileForUpload(path);
      expect(r.contentType).toBe(expected);
    }
  });
});

describe("uploadAttachments", () => {
  it("returns [] without calling client when paths is empty", async () => {
    const upload = vi.fn();
    const out = await uploadAttachments({ upload }, []);
    expect(out).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads each file once in input order", async () => {
    const a = join(workDir, "a.png");
    const b = join(workDir, "b.pdf");
    await writeFile(a, Buffer.from([0xff]));
    await writeFile(b, Buffer.from("hi"));

    const upload = vi.fn().mockImplementation(async (opts) => ({
      id: `att-${opts.filename}`,
      filename: opts.filename,
      file_type: opts.contentType,
      file_size: opts.body.byteLength,
      file_category: opts.contentType.startsWith("image/")
        ? "image"
        : "document",
      storage_key: `k/${opts.filename}`,
      storage_url: `https://cdn/${opts.filename}`,
      thumbnail_url: null,
      width: null,
      height: null,
    }));

    const out = await uploadAttachments({ upload }, [a, b]);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(out.map((r) => r.filename)).toEqual(["a.png", "b.pdf"]);
  });

  it("surfaces per-file failure with the offending filename", async () => {
    const a = join(workDir, "a.png");
    await writeFile(a, Buffer.from([0xff]));
    const upload = vi.fn().mockRejectedValue(new Error("R2 down"));
    await expect(uploadAttachments({ upload }, [a])).rejects.toThrow(
      /a\.png.*R2 down/,
    );
  });

  it("rejects pre-flight when total size exceeds the batch cap", async () => {
    // Five 24 MB files = 120 MB > 125 MB? No: cap is 125 MB. Push to 6 × 24 = 144 MB.
    const paths: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = join(workDir, `big-${i}.pdf`);
      await writeFile(p, Buffer.alloc(24 * 1024 * 1024, 0x20));
      paths.push(p);
    }
    const upload = vi.fn();
    await expect(uploadAttachments({ upload }, paths)).rejects.toThrow(
      /exceeds the 125 MB cap/,
    );
    expect(upload).not.toHaveBeenCalled();
  });
});
