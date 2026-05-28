# Security

## Reporting a vulnerability

Email `security@ano.dev` with reproduction details. We respond within 2
business days. Please don't open a public issue for security reports.

## Known advisories (transitive — not exploitable in CLI usage)

`npm audit` and third-party scanners (e.g. npmx.dev) flag a handful of
advisories on transitive dependencies pulled in by `@rocicorp/zero`.
Each one is **dead code in our distribution** — the affected modules
are part of Zero's server-side observability bundle that the CLI ships
but never executes. They're listed here so users can review and decide
for themselves.

| Severity | Package                                               | Advisory                                                                                                                                  | Why it can't fire in the CLI                                                                                                                     |
| -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| High     | `@opentelemetry/auto-instrumentations-node` <= 0.74.0 | [GHSA-q7rr-3cgh-j5r3](https://github.com/advisories/GHSA-q7rr-3cgh-j5r3) — Prometheus exporter process crash via malformed HTTP request   | The CLI never starts a Prometheus HTTP listener. Reachable only if a user runs Zero's server-side telemetry, which the CLI doesn't expose.       |
| High     | `@opentelemetry/exporter-prometheus` < 0.217.0        | Same CVE (`GHSA-q7rr-3cgh-j5r3`)                                                                                                          | Same — no exporter ever instantiated.                                                                                                            |
| Moderate | `uuid` < 11.1.1                                       | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — missing buffer bounds check in v3/v5/v6 when `buf` is provided | Zero uses `uuid` v4 (random), which is not affected. The vulnerable code paths (`v3`/`v5`/`v6` with a caller-supplied buffer) are never invoked. |

The "fix" `npm audit fix --force` proposes is to downgrade Zero to
`0.20.x` — a breaking major version change. We don't take it; the
risk reduction is zero (no real exploit surface) and the rollback
would lose every Zero feature shipped since v0.20.

The right long-term fix is upstream — `@rocicorp/zero` bumping their
pin of `@opentelemetry/*` and `uuid`. We track that in
[`rocicorp/mono#TBD`](https://github.com/rocicorp/mono) (no issue
filed yet — open if you need it). When Zero ships a release with
clean dep pins we bump and the advisories drop off.

## What the CLI actually executes from the Zero bundle

Reading from a local SQLite replica via `@rocicorp/zero/sqlite`,
WebSocket to `sync-*.ano.dev`, and the named-query / mutator
protocol. None of the OpenTelemetry server modules are loaded at
runtime; they're carried as code in the bundle solely because Zero
publishes one package for both client and server consumers.

If a future Zero release splits these into separate entry points,
the CLI's npm tarball gets smaller and these advisories disappear
from the dependency graph entirely.
