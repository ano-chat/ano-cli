import { ExitCode } from "../cli/types.js";

export class AnoCliError extends Error {
  constructor(
    message: string,
    public exitCode: ExitCode = ExitCode.API_ERROR,
    public hint?: string,
  ) {
    super(message);
    this.name = "AnoCliError";
  }
}

export class AuthError extends AnoCliError {
  constructor(message: string, code: ExitCode = ExitCode.AUTH) {
    super(message, code, 'Run "ano auth login" or pass --key');
    this.name = "AuthError";
  }
}

export class NotFoundError extends AnoCliError {
  constructor(message: string) {
    super(message, ExitCode.NOT_FOUND);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends AnoCliError {
  constructor(message: string) {
    super(message, ExitCode.RATE_LIMIT, "Wait and retry");
    this.name = "RateLimitError";
  }
}

export class NetworkError extends AnoCliError {
  constructor(message: string) {
    super(message, ExitCode.NETWORK, 'Run "ano doctor" to diagnose');
    this.name = "NetworkError";
  }
}

export class ApiError extends AnoCliError {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message, ExitCode.API_ERROR);
    this.name = "ApiError";
  }
}
