---
name: xiaohongshu-visuals
description: Create publication-ready, Xiaohongshu-native flat visual packages with traceable evidence and pre-publish QA. Use for note covers, first images, carousel cards, explanatory diagrams, evidence screenshots, visual variants, asset manifests, or final image handoffs; confirm current platform and user constraints before choosing any dimensions or crop.
---

# Xiaohongshu Visuals

## Purpose

Turn an approved note angle, verified facts, and lawful source assets into finished Xiaohongshu flat visuals. Own the cover, first image, carousel cards, explanatory diagrams, evidence-screenshot treatment, export package, and visual handoff; do not stop at an image brief when production tools and inputs are available.

Keep factual evidence visibly separate from generated concept imagery. Never imply that a generated scene, reconstructed interface, illustrative chart, or mock screenshot is observed proof.

## Trigger Conditions

Use this skill when the request needs one or more of:

- A cover or first image for a Xiaohongshu note.
- A multi-card carousel with a coherent reading sequence.
- A comparison, process, architecture, timeline, annotated screenshot, or other explanatory graphic.
- An evidence-screenshot list, redaction plan, citation treatment, or provenance review.
- Brand-consistent visual variants or a complete file package for publishing.
- Visual QA for copy accuracy, crop resilience, mobile readability, rights, privacy, or evidence integrity.

Do not trigger it for a custom-coded interactive demo, web page, component, or reusable visual application. Hand those implementations to FrontDeveloper while retaining the Xiaohongshu copy, audience intent, and acceptance constraints.

## Required Inputs

- Note goal, target audience, approved angle, and intended reader action.
- Final or versioned copy, factual claims, sources, and any mandatory qualifiers.
- Brand guidance: logo rules, colors, typography, tone, prohibited treatments, and reference examples when available.
- Provided asset paths plus origin, ownership, license, consent, and reuse limits.
- Target placement for every image: cover, first image, carousel position, explanation, evidence, or backup variant.
- Current platform and user constraints for the exact publishing surface, including the currently accepted file types, dimensions or aspect ratios, count, crop behavior, and size limits.

Before execution, verify and record the current constraints from the user's brief, a current authoritative platform source, or an observed current publishing surface. Do not reuse remembered or fixed Xiaohongshu dimensions. If constraints cannot be confirmed, create an adaptable layout plan or editable source and label final export dimensions as blocked.

## Workflow

### 1. Lock the visual contract

1. Map each visual to one reader job and one note section.
2. Separate final copy from draft copy; freeze the text version used for visual production.
3. Record the current platform constraints and their source or confirmation state.
4. Define the brand tokens and required visual hierarchy before producing variants.

### 2. Build the asset and evidence ledger

Classify every input as one of:

- `EVIDENCE`: an authentic screenshot, photograph, document excerpt, or captured result that supports a claim.
- `USER_PROVIDED`: supplied by the user, with ownership or permission still recorded.
- `LICENSED`: reusable under a known license or permission, with attribution requirements recorded.
- `GENERATED_CONCEPT`: AI-generated or reconstructed imagery used only as illustration.
- `UNVERIFIED`: provenance, permission, or factual status is unresolved and therefore cannot enter the publish-ready set.

For each evidence screenshot, record:

- Source URL, application, document, account, or local file.
- Capture or access time when relevant to the claim.
- The exact claim it supports and any limitation or qualifier visible in the source.
- Whether it was cropped, annotated, or redacted; preserve an original when available.
- Rights, permission, personal-data exposure, account identifiers, and required redactions.
- A caption or source label that prevents the crop from changing the meaning.

Never place a `GENERATED_CONCEPT` item in an evidence slot. Label generated or reconstructed imagery where a reasonable reader could mistake it for proof, a real interface, a real person, or an actual result.

### 3. Design the sequence

- **Cover:** express one truthful promise with enough contrast and hierarchy to survive a reduced mobile preview; do not use a hook the note cannot fulfill.
- **First image:** establish context, value, or a useful summary without assuming the cover crop remains unchanged.
- **Carousel cards:** give every card one main idea, maintain numbering or progression, and make the sequence understandable without hidden transitions.
- **Explanatory diagrams:** preserve causal direction, units, labels, legends, and uncertainty; simplify decoration before simplifying meaning.
- **Evidence cards:** keep source identity, timestamp or freshness where relevant, qualifiers, and redactions readable; distinguish annotation from original content.

### 4. Produce the visual files

1. Use the best available local or connected raster, vector, layout, screenshot, or image-generation tool.
2. Keep editable sources when the tool supports them and export only after the current target constraints are confirmed.
3. Apply brand colors, typography, spacing, illustration style, logo rules, and disclosure treatments consistently.
4. Copy text from the frozen copy source; do not retype critical names, numbers, commands, dates, or claims from memory.
5. Use generated imagery only for concepts or decoration unless the user explicitly requests another lawful use; never generate false evidence.
6. When the current runtime lacks a suitable image generator but Codex is available as a separate task surface, write a v1 request for `codex-visual-production` inside the current run and stop at `pending_codex`. Do not request or invent an OpenAI API key and do not describe the asynchronous handoff as an MCP or API call.

### 5. Run visual QA

Check every final candidate for:

- Exact spelling, punctuation, names, numbers, dates, units, code, URLs, source labels, and claim qualifiers.
- Readability at a reduced mobile preview, not only at authoring scale.
- Safe hierarchy under the currently observed crop behavior; keep essential meaning away from uncertain crop edges.
- Contrast, information density, card-to-card consistency, and a clear reading order.
- Brand consistency across colors, type, logo use, photography, illustration, and disclosure labels.
- Copyright, license, attribution, portrait rights, privacy, personal data, confidential information, and screenshot permissions.
- Clear separation of authentic evidence, annotations, mockups, and generated concepts.
- File integrity, predictable names, correct ordering, and absence of obsolete variants in the publish-ready directory.

If a visual cannot be inspected at realistic mobile scale or against current crop behavior, mark that check as pending instead of claiming it passed.

### 6. Package and hand off

Create a manifest with at least:

| Field | Meaning |
|-------|---------|
| `id` | Stable visual identifier and carousel order. |
| `path` | Exact final file path; include editable-source path when available. |
| `role` | Cover, first image, carousel card, explanation, evidence, or alternate. |
| `target_constraint` | The currently verified placement, format, dimensions or ratio, and crop note; never a remembered default. |
| `copy_version` | The frozen text version used in the file. |
| `asset_class` | Evidence, user-provided, licensed, generated concept, or unresolved. |
| `source_rights` | Source, permission or license, attribution, privacy, and redaction state. |
| `qa_status` | Text, mobile, crop, brand, evidence, rights, and file checks. |
| `publish_status` | Ready, blocked, alternate, or excluded, with the reason. |

Hand the final ordered paths, manifest, frozen copy, evidence ledger, unresolved risks, current constraint source, and approval state to `publishing-checklist`. Do not claim publication merely because the files are ready.

## Outputs

- Finished cover, first image, carousel, explanatory, or evidence visual files when suitable production tools and inputs are available.
- Editable sources or reproducible instructions when supported by the chosen tool.
- A visual sequence map and file manifest with exact paths and order.
- An evidence-screenshot checklist and asset-provenance ledger.
- A QA report covering text, brand, crop, mobile readability, evidence integrity, copyright, privacy, and remaining blockers.
- A pre-publish handoff package for `publishing-checklist`.

If production tools or required assets are unavailable, return an executable visual specification and blocker list. Do not describe a brief, prompt, or uninspected placeholder as a finished visual.

## Approval Gates

- Local visual drafting, generation, editing, inspection, and export do not by themselves authorize an account or remote write.
- Require explicit user approval for the exact ordered image paths, title, body, topics, privacy state, target account, and command before any `xhs post` or other account write.
- Require explicit user approval for the exact base, source paths, target file or template ID, visibility, overwrite behavior, and command before any JPage upload, overwrite, rename, delete, visibility change, template instantiation, or remote skill synchronization.
- Reconfirm approval if a visual, payload, target, visibility state, or command changes after approval.
- Never place secrets, private tokens, hidden personal data, or unapproved account identifiers in a visual or tracked manifest.

## Failure Handling

- If current platform constraints are unavailable, keep the design adaptable, record the missing confirmation, and stop before final dimension-specific export.
- If text is not final, create a clearly marked draft layout and block publish-ready status.
- If provenance, permission, consent, or privacy is unresolved, exclude the asset from the ready set and identify a lawful replacement.
- If evidence is unreadable after crop or redaction, use a different evidence treatment; never enlarge or reconstruct it in a way that changes meaning.
- If a generation or editing tool fails, preserve source inputs, commands or prompts, and intermediate outputs; report the exact failure and use a safe alternate tool or production brief.
- If account or JPage state is uncertain after a write failure, verify remote state before retrying.

## Handoff Rules

- Ruby owns Xiaohongshu flat visual production: covers, first images, carousel cards, explanatory diagrams, evidence-screenshot treatment, visual QA, and the final file manifest.
- Hand only custom-coded interactive demos, pages, components, or reusable visual tools to FrontDeveloper. Include the approved copy, current target constraints, brand rules, evidence ledger, interaction behavior, and acceptance checks.
- Hand multi-week campaign scheduling, owner coordination, dependencies, cadence, and shared status to ProjectAdministrator. Include the visual inventory, readiness states, blockers, approvals, and due dates.
- Hand independent public-artifact verification to QAEngineer after publication when creator and verifier separation is required.
- Hand a verified source-and-asset package to WeChatOfficialAccountOperator only when the user explicitly requests a WeChat-native derivative; do not assume the Xiaohongshu layout is reusable there.
- Keep all JPage work behind the Xiaohongshu-scoped `jpage-official` wrapper and `jpage-publishing` approval rules.
