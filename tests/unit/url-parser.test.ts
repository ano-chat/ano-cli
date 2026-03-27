import { describe, it, expect } from "vitest";
import { parseAnoUrl } from "../../src/core/url-parser.js";

describe("parseAnoUrl", () => {
  describe("valid ano.dev URLs", () => {
    it("parses workspace URL", () => {
      const result = parseAnoUrl("https://ano.dev/my-team");
      expect(result).toEqual({
        type: "workspace",
        workspace: "my-team",
      });
    });

    it("parses channel URL", () => {
      const result = parseAnoUrl("https://ano.dev/my-team/general");
      expect(result).toEqual({
        type: "channel",
        workspace: "my-team",
        channel: "general",
      });
    });

    it("parses message URL", () => {
      const result = parseAnoUrl(
        "https://ano.dev/my-team/general/msg-123",
      );
      expect(result).toEqual({
        type: "message",
        workspace: "my-team",
        channel: "general",
        messageId: "msg-123",
      });
    });

    it("handles subdomain URLs (app.ano.dev)", () => {
      const result = parseAnoUrl("https://app.ano.dev/workspace1");
      expect(result).toEqual({
        type: "workspace",
        workspace: "workspace1",
      });
    });

    it("handles subdomain channel URL", () => {
      const result = parseAnoUrl(
        "https://app.ano.dev/workspace1/engineering",
      );
      expect(result).toEqual({
        type: "channel",
        workspace: "workspace1",
        channel: "engineering",
      });
    });

    it("handles URLs with trailing slashes", () => {
      const result = parseAnoUrl("https://ano.dev/my-team/");
      expect(result).toEqual({
        type: "workspace",
        workspace: "my-team",
      });
    });

    it("handles channel URLs with trailing slashes", () => {
      const result = parseAnoUrl("https://ano.dev/my-team/general/");
      expect(result).toEqual({
        type: "channel",
        workspace: "my-team",
        channel: "general",
      });
    });

    it("handles message URLs with extra path segments", () => {
      const result = parseAnoUrl(
        "https://ano.dev/ws/ch/msg-id/extra",
      );
      expect(result).not.toBeNull();
      expect(result!.type).toBe("message");
      expect(result!.workspace).toBe("ws");
      expect(result!.channel).toBe("ch");
      expect(result!.messageId).toBe("msg-id");
    });
  });

  describe("rejects non-ano URLs", () => {
    it("rejects piano.com", () => {
      expect(parseAnoUrl("https://piano.com/workspace")).toBeNull();
    });

    it("rejects example.com", () => {
      expect(parseAnoUrl("https://example.com/test")).toBeNull();
    });

    it("rejects domains ending with ano.dev (e.g. notano.dev)", () => {
      expect(parseAnoUrl("https://notano.dev/workspace")).toBeNull();
    });

    it("rejects ano.dev root with no path", () => {
      expect(parseAnoUrl("https://ano.dev/")).toBeNull();
    });

    it("rejects ano.dev with empty path", () => {
      expect(parseAnoUrl("https://ano.dev")).toBeNull();
    });
  });

  describe("handles invalid URLs gracefully", () => {
    it("returns null for non-URL strings", () => {
      expect(parseAnoUrl("not a url")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseAnoUrl("")).toBeNull();
    });

    it("returns null for malformed URLs", () => {
      expect(parseAnoUrl("://missing-scheme")).toBeNull();
    });
  });
});
