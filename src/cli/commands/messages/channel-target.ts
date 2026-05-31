import { ExitCode } from "../../types.js";
import type { AnoApiClient, Channel } from "../../../core/api-client.js";
import { AnoCliError } from "../../../core/errors.js";
import { listChannelsViaZero } from "../../../zero/reads.js";

export type ChannelRef =
  | { kind: "id"; value: string }
  | { kind: "name"; value: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const channelIdByScopeAndName = new Map<string, string>();

export function channelRefFromTarget(target: string): ChannelRef {
  const value = target.trim();
  if (value.startsWith("#")) {
    return { kind: "name", value: value.slice(1) };
  }
  if (UUID_RE.test(value)) return { kind: "id", value };
  return { kind: "name", value };
}

export function cleanChannelName(name: string): string {
  return name.trim().replace(/^#/, "");
}

export function isChannelId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function parseSingleChannelRef(opts: {
  target?: string;
  channel?: string;
  channelName?: string;
}): ChannelRef {
  const provided = [opts.target, opts.channel, opts.channelName].filter(
    Boolean,
  );
  if (provided.length === 0) {
    throw new AnoCliError(
      "Pass a channel target: #general, --channel <id>, or --channel-name <name>.",
      ExitCode.USAGE,
    );
  }
  if (provided.length > 1) {
    throw new AnoCliError("Pass only one channel target.", ExitCode.USAGE);
  }
  if (opts.channelName) {
    return { kind: "name", value: cleanChannelName(opts.channelName) };
  }
  if (opts.channel) {
    return isChannelId(opts.channel)
      ? { kind: "id", value: opts.channel }
      : { kind: "name", value: cleanChannelName(opts.channel) };
  }
  return channelRefFromTarget(opts.target!);
}

export async function resolveChannelId(opts: {
  ref: ChannelRef;
  workspaceId?: string;
  client: AnoApiClient;
}): Promise<string> {
  if (opts.ref.kind === "id") return opts.ref.value;

  const normalized = opts.ref.value.toLowerCase();
  const cacheKey = `${opts.workspaceId ?? ""}\0${normalized}`;
  const cached = channelIdByScopeAndName.get(cacheKey);
  if (cached) return cached;

  const zero = await listChannelsViaZero({ workspace_id: opts.workspaceId });
  const channels =
    zero?.channels ??
    (await opts.client.listChannels({ workspace_id: opts.workspaceId }))
      .channels;
  const matches = channels.filter((c) => c.name.toLowerCase() === normalized);
  if (matches.length === 1) {
    channelIdByScopeAndName.set(cacheKey, matches[0]!.id);
    return matches[0]!.id;
  }
  if (matches.length > 1) {
    throw new AnoCliError(
      `Channel "${opts.ref.value}" is ambiguous. Pass --workspace <id> or --channel <id>.\n${formatChannelMatches(matches)}`,
      ExitCode.USAGE,
    );
  }
  throw new AnoCliError(
    `Channel "${opts.ref.value}" was not found.`,
    ExitCode.NOT_FOUND,
    "Run `ano channels list --agent` to see accessible channels.",
  );
}

function formatChannelMatches(channels: Channel[]): string {
  return channels
    .map(
      (c) =>
        `  ${c.id}  #${c.name}${c.workspace_id ? `  ${c.workspace_id}` : ""}`,
    )
    .join("\n");
}

export function _clearChannelRefCacheForTests(): void {
  channelIdByScopeAndName.clear();
}
