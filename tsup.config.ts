import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "connect-entry": "src/connect-entry.ts",
  },
  format: ["esm"],
  target: "node18",
  clean: true,
  splitting: true,
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __VERSION__: JSON.stringify(
      process.env.npm_package_version ?? "0.0.0-dev",
    ),
  },
});
