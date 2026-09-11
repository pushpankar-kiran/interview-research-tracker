# Security Policy

## Design & threat model

This is a **local, single-user** tool. It is intended to run only on the user's
own machine:

- The server **binds to `127.0.0.1` only** — it is not exposed to the local
  network or the internet.
- It uses **no API keys or stored credentials** — the AI work is done by an
  interactive Claude Code session on the user's own subscription.
- It has **no authentication** because it is not meant to be network-reachable.
  **Do not** expose it to a public interface (e.g. `0.0.0.0`, a reverse proxy,
  or port-forwarding) without adding authentication first.

## Hardening in place

- **Path-traversal protection** — company slugs and session IDs from URLs are
  validated against a strict allowlist (`[A-Za-z0-9._-]`, no `..`) before they
  touch the filesystem.
- **Request-body size cap** (2 MB) to avoid memory exhaustion.
- **Rate limiting** on read and write endpoints.
- **No traceback leakage** — errors return a generic message and are logged
  server-side to `app/data/errors.log`.
- **Atomic file writes** to avoid corruption.
- Personal data (`app/data/`) is **git-ignored** and never committed.

## Reporting a vulnerability

If you find a security issue, please **open a GitHub issue** (for a local-only
tool this is low-risk) or contact the maintainer through their GitHub profile.
Please describe the issue and steps to reproduce. There is no bounty program.

## Scope notes

Because the tool fetches public web pages during research, standard web-content
cautions apply: it treats fetched content as data, respects robots.txt, and does
not authenticate against or scrape behind any login wall.
