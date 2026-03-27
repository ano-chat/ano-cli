import { execFile } from "node:child_process";
import { resolve } from "node:path";

const CLI_ENTRY = resolve(import.meta.dirname, "../../dist/index.js");

export function runCli(
  args: string[],
  options?: { env?: Record<string, string>; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI_ENTRY, ...args],
      {
        env: { ...process.env, NO_COLOR: "1", ...options?.env },
        timeout: options?.timeout ?? 10_000,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error?.code
            ? typeof error.code === "number"
              ? error.code
              : 1
            : child.exitCode ?? 0,
        });
      },
    );
  });
}
