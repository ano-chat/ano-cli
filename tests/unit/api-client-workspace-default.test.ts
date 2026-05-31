import { beforeEach, describe, expect, it, vi } from "vitest";

const retryFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/bridge/retry.js", () => ({
  retryFetch: retryFetchMock,
  PermanentError: class PermanentError extends Error {},
}));

const { createApiClient } = await import("../../src/core/api-client.js");

function ok(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function lastJsonBody(): Record<string, unknown> {
  const init = retryFetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

describe("createApiClient workspace defaults", () => {
  beforeEach(() => {
    retryFetchMock.mockReset();
    retryFetchMock.mockImplementation(async () =>
      ok({ channels: [], users: [] }),
    );
  });

  it("defaults workspace-scoped POST bodies to the pinned profile workspace", async () => {
    const client = createApiClient({
      key: "k",
      endpoint: "https://api.example",
      source: "global",
      workspace_id: "ws-profile",
    });

    await client.listChannels();
    expect(lastJsonBody()).toEqual({ workspace_id: "ws-profile" });

    await client.listUsers({});
    expect(lastJsonBody()).toEqual({ workspace_id: "ws-profile" });
  });

  it("lets an explicit command workspace override the pinned profile workspace", async () => {
    const client = createApiClient({
      key: "k",
      endpoint: "https://api.example",
      source: "global",
      workspace_id: "ws-profile",
    });

    await client.listChannels({ workspace_id: "ws-flag" });
    expect(lastJsonBody()).toEqual({ workspace_id: "ws-flag" });
  });

  it("leaves unscoped requests unscoped when the credential is not pinned", async () => {
    const client = createApiClient({
      key: "k",
      endpoint: "https://api.example",
      source: "flag",
    });

    await client.listChannels();
    expect(lastJsonBody()).toEqual({});
  });

  it("defaults GET context to the pinned profile workspace", async () => {
    retryFetchMock.mockResolvedValueOnce(
      ok({
        user: { id: "u", name: "Ruben", role: "admin", is_coworker: false },
        workspace: { id: "ws-profile", name: "Ano", member_count: 2 },
        channels: [],
        members: [],
      }),
    );
    const client = createApiClient({
      key: "k",
      endpoint: "https://api.example",
      source: "global",
      workspace_id: "ws-profile",
    });

    await client.context();
    const url = new URL(String(retryFetchMock.mock.calls.at(-1)?.[0]));
    expect(url.searchParams.get("workspace_id")).toBe("ws-profile");
  });
});
