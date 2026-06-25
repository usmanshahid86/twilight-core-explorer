# Security Policy

## Supported Versions

This repository is in active pre-release development. Security fixes are applied to the `main`
branch unless otherwise noted.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately through GitHub Security Advisories for this
repository, or by contacting the repository maintainers through the project’s preferred private
channel.

Do not open a public issue for vulnerabilities that expose secrets, enable data corruption, or
could affect a live explorer deployment.

## Scope

Security-sensitive areas include:

- Indexer persistence and cursor/idempotency behavior.
- Projection rebuild/reset safety.
- Chain RPC/REST transport handling.
- Raw transaction and protobuf decoding.
- Any future public API or web surface.

This explorer should never require validator private keys, operator mnemonics, or privileged chain
credentials. Do not commit secrets, local `.env` files, database dumps, or localnet key material.
