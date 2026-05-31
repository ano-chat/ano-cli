import { describe, expect, it } from "vitest";
import {
  channelRefFromTarget,
  cleanChannelName,
  parseSingleChannelRef,
} from "../../src/cli/commands/messages/channel-target.js";

describe("channel target parsing", () => {
  it("parses #name as a channel name", () => {
    expect(channelRefFromTarget("#general")).toEqual({
      kind: "name",
      value: "general",
    });
  });

  it("parses UUID targets as channel IDs", () => {
    expect(
      channelRefFromTarget("ca4630cd-6a20-4407-a053-73fe7ccf1a16"),
    ).toEqual({
      kind: "id",
      value: "ca4630cd-6a20-4407-a053-73fe7ccf1a16",
    });
  });

  it("allows --channel to accept names for backwards-compatible compact use", () => {
    expect(parseSingleChannelRef({ channel: "general" })).toEqual({
      kind: "name",
      value: "general",
    });
  });

  it("strips a leading hash from --channel-name", () => {
    expect(cleanChannelName("#random")).toBe("random");
  });
});
