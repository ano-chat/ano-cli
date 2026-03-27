/**
 * Install/uninstall ano-connect as a persistent system service.
 * macOS → LaunchAgent, Linux → systemd user unit.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export type ServiceOptions = {
  key: string;
  endpoint: string;
  webhook?: string;
  webhookSecret?: string;
  controlPort?: number;
  healthPort?: number;
  openclaw?: string;
  openclawToken?: string;
  openclawAgent?: string;
};

function serviceHash(key: string, endpoint: string): string {
  return createHash("sha256")
    .update(key.slice(0, 16) + endpoint)
    .digest("hex")
    .slice(0, 12);
}

function buildArgs(opts: ServiceOptions): string[] {
  const args = ["--key", opts.key, "--endpoint", opts.endpoint];
  if (opts.webhook) args.push("--webhook", opts.webhook);
  if (opts.webhookSecret) args.push("--webhook-secret", opts.webhookSecret);
  if (opts.controlPort !== undefined)
    args.push("--control-port", String(opts.controlPort));
  if (opts.healthPort !== undefined)
    args.push("--health-port", String(opts.healthPort));
  if (opts.openclaw) args.push("--openclaw", opts.openclaw);
  if (opts.openclawToken) args.push("--openclaw-token", opts.openclawToken);
  if (opts.openclawAgent) args.push("--openclaw-agent", opts.openclawAgent);
  return args;
}

function log(msg: string) {
  process.stderr.write(`[ano-connect] ${msg}\n`);
}

async function validateCredentials(
  key: string,
  endpoint: string,
): Promise<string> {
  const res = await fetch(`${endpoint}/mcp/context`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Credential validation failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    workspace?: { name?: string };
  };
  return data.workspace?.name ?? "unknown";
}

function generatePlist(
  label: string,
  npxPath: string,
  args: string[],
  logDir: string,
  hash: string,
  envPath: string,
): string {
  const programArgs = [npxPath, "ano-connect", ...args]
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logDir)}/${hash}.out.log</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logDir)}/${hash}.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(envPath)}</string>
  </dict>
</dict>
</plist>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateSystemdUnit(
  description: string,
  npxPath: string,
  args: string[],
  logDir: string,
  hash: string,
  envPath: string,
): string {
  const execStart = [npxPath, "ano-connect", ...args]
    .map((a) => (a.includes(" ") ? `"${a}"` : a))
    .join(" ");

  return `[Unit]
Description=${description}

[Service]
ExecStart=${execStart}
Restart=on-failure
RestartSec=5
StandardOutput=append:${logDir}/${hash}.out.log
StandardError=append:${logDir}/${hash}.err.log
Environment=PATH=${envPath}

[Install]
WantedBy=default.target
`;
}

export async function installService(opts: ServiceOptions): Promise<void> {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(
      `Unsupported platform: ${platform}. Only macOS and Linux are supported.`,
    );
  }

  log("Validating credentials...");
  const workspaceName = await validateCredentials(opts.key, opts.endpoint);
  log(`Workspace: ${workspaceName}`);

  const hash = serviceHash(opts.key, opts.endpoint);
  const home = homedir();
  const logDir = join(home, ".ano-connect", "logs");
  mkdirSync(logDir, { recursive: true });

  // Use npx for stable resolution — process.argv[1] is ephemeral in npx cache
  let npxPath: string;
  try {
    npxPath = execSync("which npx", { encoding: "utf-8" }).trim();
  } catch {
    npxPath = join(process.execPath.replace(/\/node$/, ""), "..", "bin", "npx");
  }
  const args = buildArgs(opts);
  const envPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";

  if (platform === "darwin") {
    const label = `dev.ano.connect.${hash}`;
    const plistDir = join(home, "Library", "LaunchAgents");
    mkdirSync(plistDir, { recursive: true });
    const plistPath = join(plistDir, `${label}.plist`);

    const plist = generatePlist(label, npxPath, args, logDir, hash, envPath);
    writeFileSync(plistPath, plist);
    log(`Wrote ${plistPath}`);

    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, {
        stdio: "ignore",
      });
    } catch {
      // May not be loaded yet
    }
    execSync(`launchctl load "${plistPath}"`);
    log(`Service loaded: ${label}`);
    log(`Logs: ${logDir}/${hash}.out.log`);
    log(`Workspace: ${workspaceName} | Hash: ${hash} | Auto-restart: enabled`);
  } else {
    const serviceName = `ano-connect-${hash}`;
    const unitDir = join(home, ".config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    const unitPath = join(unitDir, `${serviceName}.service`);

    const unit = generateSystemdUnit(
      `Ano Connect Bridge (${workspaceName})`,
      npxPath,
      args,
      logDir,
      hash,
      envPath,
    );
    writeFileSync(unitPath, unit);
    log(`Wrote ${unitPath}`);

    execSync("systemctl --user daemon-reload");
    execSync(`systemctl --user enable --now ${serviceName}`);
    log(`Service enabled: ${serviceName}`);
    log(`Logs: ${logDir}/${hash}.out.log`);
    log(`Workspace: ${workspaceName} | Hash: ${hash} | Auto-restart: enabled`);
  }
}

export async function uninstallService(workspace: string): Promise<void> {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  // workspace can be the hash directly or something to look up
  const hash = /^[a-f0-9]{12}$/.test(workspace)
    ? workspace
    : createHash("sha256").update(workspace).digest("hex").slice(0, 12);

  const home = homedir();

  if (platform === "darwin") {
    const label = `dev.ano.connect.${hash}`;
    const plistPath = join(home, "Library", "LaunchAgents", `${label}.plist`);

    if (!existsSync(plistPath)) {
      log(`Service not found: ${label} (${plistPath})`);
      process.exit(1);
    }

    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" });
    } catch {
      // Already unloaded
    }
    unlinkSync(plistPath);
    log(`Service removed: ${label}`);
  } else {
    const serviceName = `ano-connect-${hash}`;
    const unitPath = join(
      home,
      ".config",
      "systemd",
      "user",
      `${serviceName}.service`,
    );

    if (!existsSync(unitPath)) {
      log(`Service not found: ${serviceName} (${unitPath})`);
      process.exit(1);
    }

    try {
      execSync(`systemctl --user disable --now ${serviceName}`, {
        stdio: "ignore",
      });
    } catch {
      // May already be stopped
    }
    unlinkSync(unitPath);
    execSync("systemctl --user daemon-reload");
    log(`Service removed: ${serviceName}`);
  }
}
