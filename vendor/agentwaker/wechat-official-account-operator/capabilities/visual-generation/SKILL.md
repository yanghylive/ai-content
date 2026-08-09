---
name: visual-generation
description: Shared visual production and inspection capability driven by structured requests. Consuming role skills retain platform art direction, quantity, approval, publication, and acceptance policy.
---

# Visual Generation

## Contract

Accept a request conforming to `schemas/visual-request.schema.json`. Produce actual local assets and a manifest conforming to `schemas/visual-manifest.schema.json`; a prompt or brief alone is not a completed result.

## Routing

Select the smallest suitable adapter among generated raster images, evidence screenshots, diagrams, and charts. Preserve source data, prompts or render inputs, dimensions, hashes, and inspection results.

## Boundaries

This capability may write local artifacts but does not upload, publish, mutate an account, choose a platform-specific editorial strategy, or declare a consuming workflow complete. The role wrapper owns those decisions and approvals.

## Failure

Report missing adapters, failed generation, unreadable text, unsupported claims, and absent evidence. Do not replace a required real asset with a placeholder or mark an uninspected asset as passed.
