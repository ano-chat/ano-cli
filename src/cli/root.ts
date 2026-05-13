import { Command, Option } from "commander";

declare const __VERSION__: string;

export function createProgram(): Command {
  const version =
    typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev";

  const program = new Command("ano")
    .version(version)
    .description("CLI for Ano — team communication for humans and agents")
    .addOption(
      new Option("-k, --key <key>", "API key (ano_cwk_...)").env("ANO_API_KEY"),
    )
    .addOption(
      new Option("-e, --endpoint <url>", "API endpoint")
        .env("ANO_ENDPOINT")
        .default("https://api.ano.dev"),
    )
    .addOption(
      new Option(
        "-w, --workspace <id>",
        "Workspace ID (if multi-workspace)",
      ).env("ANO_WORKSPACE_ID"),
    )
    .addOption(
      new Option(
        "-p, --profile <name>",
        "Profile to read auth from (~/.config/ano/credentials.json)",
      ).env("ANO_PROFILE"),
    )
    .addOption(
      new Option("-j, --json", "Output as JSON envelope with breadcrumbs"),
    )
    .addOption(new Option("-m, --md", "Output as GFM markdown"))
    .addOption(new Option("-q, --quiet", "Minimal output, raw data only"))
    .addOption(new Option("--agent", "Agent mode: raw data, no chrome"))
    .addOption(new Option("--no-color", "Disable ANSI colors"))
    .addOption(new Option("--debug", "Show debug info on stderr"));

  return program;
}
