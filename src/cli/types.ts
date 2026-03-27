export enum ExitCode {
  OK = 0,
  USAGE = 1,
  NOT_FOUND = 2,
  AUTH = 3,
  FORBIDDEN = 4,
  RATE_LIMIT = 5,
  NETWORK = 6,
  API_ERROR = 7,
}

export interface GlobalOptions {
  key?: string;
  endpoint: string;
  workspace?: string;
  json?: boolean;
  md?: boolean;
  quiet?: boolean;
  agent?: boolean;
  color?: boolean;
  debug?: boolean;
}

export interface Breadcrumb {
  action: string;
  cmd: string;
  description: string;
}

export interface OutputEnvelope<T = unknown> {
  ok: boolean;
  data: T;
  breadcrumbs: Breadcrumb[];
  meta: {
    timestamp: string;
    version: string;
  };
}

export interface CommandMeta {
  command: string;
  path: string[];
  description: string;
  args: ArgMeta[];
  flags: FlagMeta[];
  subcommands: SubcommandMeta[];
  notes?: string[];
}

export interface ArgMeta {
  name: string;
  description: string;
  required: boolean;
}

export interface FlagMeta {
  name: string;
  short?: string;
  description: string;
  required: boolean;
  type: string;
  default?: unknown;
  env?: string;
}

export interface SubcommandMeta {
  name: string;
  description: string;
  path: string;
}
