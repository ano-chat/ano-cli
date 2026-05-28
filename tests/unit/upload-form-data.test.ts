/**
 * Realm-guard for the upload multipart body. The CLI sends uploads via
 * the npm-`undici` `fetch`, which only serializes a FormData as
 * `multipart/form-data` if it's undici's OWN FormData class. A Node
 * GLOBAL FormData (Node's embedded undici — a different realm) serializes
 * as `text/plain`, and the server's `c.req.formData()` then throws
 * "Invalid multipart body". These tests fail if `buildUploadFormData`
 * ever reverts to the global FormData.
 */
import { describe, it, expect } from "vitest";
import { Request } from "undici";
import { buildUploadFormData } from "../../src/core/api-client.js";

describe("buildUploadFormData", () => {
  it("produces a body undici serializes as multipart/form-data", () => {
    const fd = buildUploadFormData({
      body: Buffer.from("<html>hi</html>"),
      filename: "x.html",
      contentType: "text/html",
    });
    // undici's Request mirrors what undiciFetch does to the body.
    const req = new Request("http://x/mcp/upload", {
      method: "POST",
      body: fd,
    });
    expect(req.headers.get("content-type")).toMatch(
      /^multipart\/form-data; boundary=/,
    );
  });

  it("attaches the bytes under the 'file' field with the filename", () => {
    const fd = buildUploadFormData({
      body: Buffer.from("report-bytes"),
      filename: "report.pdf",
      contentType: "application/pdf",
    });
    const file = fd.get("file") as { name?: string; type?: string } | null;
    expect(file).not.toBeNull();
    expect(file?.name).toBe("report.pdf");
    expect(file?.type).toBe("application/pdf");
  });
});
