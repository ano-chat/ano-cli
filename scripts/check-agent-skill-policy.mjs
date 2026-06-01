#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(
  root,
  "packages",
  "skills",
  "skills",
  "ano-cli",
  "SKILL.md",
);
const skill = readFileSync(skillPath, "utf8");

const required = [
  [
    "stdio-first policy",
    /## Fastest Agent Policy[\s\S]*Preferred transport:[\s\S]*ano agent stdio/,
  ],
  [
    "direct channel read policy",
    /Use direct task commands first[\s\S]*messages read <channel-name>/,
  ],
  [
    "bounded context policy",
    /Fetch startup context only when broad context is needed[\s\S]*agent context --no-tables --json/,
  ],
  [
    "machine-output stdio enforcement",
    /agent stdio[\s\S]*Every `exec\.argv` must[\s\S]*`--agent`, `--json`, or `--quiet`/,
  ],
  [
    "roundtrip budgets",
    /## Roundtrip Budgets[\s\S]*Send to named channel[\s\S]*Send DM by display name/,
  ],
  [
    "server-side named channel send",
    /messages send "text" --channel-name general --agent/,
  ],
  ["server-side DM send", /dm send "text" --to "Name" --agent/],
  ["read-only DM read", /dm read "Name" --agent/],
];

const forbidden = [
  ["old channel pre-list workflow", /channels=\$\(ano channels list --agent\)/],
  ["old user pre-list workflow", /users=\$\(ano users list --agent\)/],
  ["old name-resolution invariant", /Resolve by name before acting/],
  [
    "old list-before-send guidance",
    /Post in #[^`]*list channels|DM [^`]*list users/,
  ],
];

const failures = [];

for (const [name, pattern] of required) {
  if (!pattern.test(skill)) failures.push(`missing required policy: ${name}`);
}

for (const [name, pattern] of forbidden) {
  if (pattern.test(skill)) failures.push(`forbidden slow guidance: ${name}`);
}

if (failures.length > 0) {
  console.error("agent skill policy check failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("agent skill policy check passed");
