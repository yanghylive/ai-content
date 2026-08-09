---
name: publishing-checklist
description: Validate a final Xiaohongshu note package and prepare an exact approval-bound xhs post command. Use when a user asks to publish a note, check publishing readiness, verify title-body-assets-topic consistency, or diagnose a failed Xiaohongshu publish attempt.
---

# Publishing Checklist

## Purpose

Validate a publish-ready Xiaohongshu note package and prepare the exact approved `xhs post` command.

## Trigger Conditions

Use this skill when the user asks to publish, prepare to publish, or validate a note before posting.

## Required Inputs

- Final title.
- Final body.
- Image file paths.
- Ordered visual manifest, copy version, source and rights state, and visual QA status when `xiaohongshu-visuals` produced the images.
- Topic or hashtag candidates.
- Privacy state: public or private.
- Explicit approval status.

## Workflow

1. Run `xhs status` to verify login when live publishing is requested.
2. Confirm title, body, ordered image paths, topics, and privacy state.
3. Check image files exist when paths are local and match the approved manifest order.
4. Confirm that current target constraints, copy accuracy, mobile readability, crop behavior, brand consistency, evidence labels, copyright, privacy, and file integrity are passed or explicitly blocked; never treat a pending check as passed.
5. Check for unsupported claims, private data, risky automation, and title-body-image mismatch.
6. Prepare exact `xhs post --title ... --body ... --images ... --topic ...` command.
7. Ask for explicit approval of the exact account, payload, ordered paths, privacy state, and command.
8. Publish only after approval.

## Outputs

- Publish readiness report.
- Exact `xhs post` command.
- Approval prompt.
- Tool result after approved publishing.

## Approval Gates

`xhs post` always requires explicit user approval.

## Failure Handling

If visual evidence, rights, privacy, current constraints, file existence, order, or QA state is unresolved, block publishing and return the package to `xiaohongshu-visuals`. If publishing fails, report the exact command and error, verify remote state, then provide a safe retry path.

## Handoff Rules

- Return visual defects or incomplete manifests to `xiaohongshu-visuals` with the exact failed check.
- Handoff to QAEngineer if public visibility or published note behavior needs independent verification.
