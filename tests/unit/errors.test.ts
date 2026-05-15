import { describe, it, expect } from "vitest";
import {
  AnoCliError,
  AuthError,
  NotFoundError,
  RateLimitError,
  NetworkError,
  ApiError,
} from "../../src/core/errors.js";
import { ExitCode } from "../../src/cli/types.js";

describe("AnoCliError", () => {
  it("defaults to API_ERROR exit code", () => {
    const err = new AnoCliError("something broke");
    expect(err.exitCode).toBe(ExitCode.API_ERROR);
    expect(err.message).toBe("something broke");
    expect(err.hint).toBeUndefined();
    expect(err.name).toBe("AnoCliError");
  });

  it("accepts custom exit code and hint", () => {
    const err = new AnoCliError("bad input", ExitCode.USAGE, "try again");
    expect(err.exitCode).toBe(ExitCode.USAGE);
    expect(err.hint).toBe("try again");
  });

  it("is an instance of Error", () => {
    expect(new AnoCliError("x")).toBeInstanceOf(Error);
  });
});

describe("AuthError", () => {
  it("has AUTH exit code by default", () => {
    const err = new AuthError("no key");
    expect(err.exitCode).toBe(ExitCode.AUTH);
    expect(err.name).toBe("AuthError");
  });

  it("includes login hint", () => {
    const err = new AuthError("no key");
    expect(err.hint).toBe('Run "ano auth login" or pass --key');
  });

  it("accepts custom exit code", () => {
    const err = new AuthError("forbidden", ExitCode.FORBIDDEN);
    expect(err.exitCode).toBe(ExitCode.FORBIDDEN);
  });

  it("is an instance of AnoCliError", () => {
    expect(new AuthError("x")).toBeInstanceOf(AnoCliError);
  });
});

describe("NotFoundError", () => {
  it("has NOT_FOUND exit code", () => {
    const err = new NotFoundError("channel missing");
    expect(err.exitCode).toBe(ExitCode.NOT_FOUND);
    expect(err.name).toBe("NotFoundError");
    expect(err.message).toBe("channel missing");
  });

  it("carries optional MCP code from the server's 404 body", () => {
    const err = new NotFoundError("not opted in", "not_opted_in");
    expect(err.code).toBe("not_opted_in");
  });

  it("code is undefined when omitted", () => {
    const err = new NotFoundError("plain 404");
    expect(err.code).toBeUndefined();
  });
});

describe("RateLimitError", () => {
  it("has RATE_LIMIT exit code and retry hint", () => {
    const err = new RateLimitError("too fast");
    expect(err.exitCode).toBe(ExitCode.RATE_LIMIT);
    expect(err.hint).toBe("Wait and retry");
    expect(err.name).toBe("RateLimitError");
  });
});

describe("NetworkError", () => {
  it("has NETWORK exit code and doctor hint", () => {
    const err = new NetworkError("timeout");
    expect(err.exitCode).toBe(ExitCode.NETWORK);
    expect(err.hint).toBe('Run "ano doctor" to diagnose');
    expect(err.name).toBe("NetworkError");
  });
});

describe("ApiError", () => {
  it("has API_ERROR exit code", () => {
    const err = new ApiError("server error");
    expect(err.exitCode).toBe(ExitCode.API_ERROR);
    expect(err.name).toBe("ApiError");
    expect(err.status).toBeUndefined();
  });

  it("stores HTTP status code", () => {
    const err = new ApiError("server error", 502);
    expect(err.status).toBe(502);
  });
});
