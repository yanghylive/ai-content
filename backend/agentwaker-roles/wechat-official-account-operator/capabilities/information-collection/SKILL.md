---
name: information-collection
description: Shared read-only collection capability for authorized web, repository, feed, and configured platform sources. Consuming role skills retain query policy, source priority, acceptance criteria, and authority boundaries.
---

# Information Collection

## Contract

Accept a request conforming to `schemas/collection-request.schema.json` and return a source ledger conforming to `schemas/source-ledger.schema.json`. Preserve retrieval time, adapter identity, canonical URL, evidence location, verification state, and unresolved gaps.

## Routing

Prefer first-party and purpose-built adapters. Use Agent-Reach only as an optional bootstrap or diagnostic adapter. Adapter availability never upgrades a discovery signal into authoritative evidence.

## Boundaries

This capability is read-only. It does not log in without configured authorization, bypass access controls, operate source-platform identities, rank candidates for a particular role, or approve claims. The consuming role wrapper supplies those policies.

## Failure

Return partial results with explicit adapter failures and evidence gaps. Never fabricate a successful retrieval or silently substitute an unverified secondary source for required primary evidence.
