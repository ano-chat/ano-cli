import type { GlobalOptions } from "../types.js";
import { ExitCode } from "../types.js";
import { AnoCliError } from "../../core/errors.js";
import { outputError } from "../../core/output.js";

/**
 * Wrap a command action to catch errors and map them to exit codes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withErrorHandler(
  fn: (...args: any[]) => Promise<void>,
): (...args: any[]) => Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      // Extract globals from the last Command argument
      const cmd = args[args.length - 1] as {
        optsWithGlobals?: () => GlobalOptions;
      };
      const globals: GlobalOptions = cmd?.optsWithGlobals?.() ?? {
        endpoint: "https://api.ano.dev",
      };

      if (err instanceof AnoCliError) {
        outputError(globals, err.message, err.exitCode, err.hint);
        process.exit(err.exitCode);
      }

      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      outputError(globals, message, ExitCode.API_ERROR);
      process.exit(ExitCode.API_ERROR);
    }
  };
}
