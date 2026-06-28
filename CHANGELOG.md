# Changelog

All notable changes to Twilight Core Explorer are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/); the running explorer surfaces its build version + git
SHA at `GET /api/v1/status` (`data.build`).

## [Unreleased]

### Added
- **API transport hardening (Phase 13c):** security headers (`@fastify/helmet`), per-IP rate limiting
  (`@fastify/rate-limit`, production-only by default), ETag validators with a revalidate-only
  `Cache-Control` policy, and build/version metadata (`version`, `gitSha`, `builtAt`, `environment`) on
  `GET /api/v1/status`.
- **List status filters (Phase 13b-filters):** `coreslots?status=` and `txs?status=` URL-synced filters.
- **Workspace linter + static repo guards (Phase 13c-1).**
- **UX & accessibility polish (Phase 13b-ux).**

### Changed
- Structured (pino) request/error logging is enabled in production (off in dev/test).

### Notes
- The API is DB-only; version truthfulness comes from build/env values, never a chain call.
- The only API-contract change is the **additive** `data.build` field on `GET /api/v1/status` (spec +
  client regenerated); caching/headers/rate-limits are transport-only and change no response envelope.
