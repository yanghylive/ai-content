# WeChat Visual Quality Gate

Use this reference after the article draft is stable enough to produce real assets. A brief or prompt is not a finished visual package.

## Required Gates

1. **Asset gate**: every required image exists, is technically valid, and has passed factual, visual, mobile, rights, and privacy review.
2. **Integrated render gate**: the self-contained article preview contains the reviewed assets, matching alt text and captions, with no placeholder or unresolved path.
3. **Remote render gate**: the private JPage HTML loads every image and remains readable at narrow mobile widths before its preview location is shown to the user.

Any article, image, caption, ordering, or layout change invalidates the previous report and requires all affected gates to run again.

## Adaptive Visual Floor

The cover is separate and decorative images do not count toward the floor.

| Article type | Required body visuals |
|--------------|-----------------------|
| Short update | At least 1 explanatory or evidence visual |
| Tutorial | At least 4; include an overview plus real evidence for the critical operating phases |
| Comparison | At least 3; include a comparison or decision visual and supporting evidence |
| Architecture | At least 3; include one system overview and the difficult boundaries or flows |
| Opinion | At least 2 explanatory visuals |
| Review or retrospective | At least 3, including real data when a performance claim is made |

For 2,500 to 4,000 content characters, require at least three body visuals even when the type floor is lower. Above 4,000 characters, require at least one meaningful body visual per 1,000 characters, rounded up, or the higher article-type floor. Do not allow two consecutive H2 sections to remain text-only. An exception requires a concrete reason, an approver, and approval evidence in the manifest. The floor is a quality minimum, not a maximum or a reason to add decorative filler.

## Production Routes

Choose the highest-integrity route that fits the reader job:

1. Use real screenshots for UI, terminal output, errors, commands, measured results, and other evidence.
2. Build original diagrams for architecture, workflows, timelines, and comparisons. Keep an editable source when possible, then export the reviewed publishable image as PNG.
3. Build charts only from recorded source data, with units, method, time window, and source in the article package.
4. Use trusted image generation for covers and conceptual explanation. Generate candidate compositions, choose the strongest, remove accidental text, and add required labels deterministically after generation.
5. Use licensed assets only when their source and permitted use are recorded.

Never mark generated concepts, fabricated UI, synthetic terminal output, or invented charts as evidence.

## Per-Asset Hard Checks

Inspect the actual final file, not only its prompt or source:

- It exists inside the article package and uses a WeChat-supported publishable format.
- Its decoded dimensions and aspect ratio meet the declared requirements without low-resolution upscaling.
- Its current SHA-256 matches the file that was visually reviewed.
- The claim, workflow step, labels, and technical identifiers are accurate.
- Chinese and English text contain no corruption, accidental characters, or spelling errors.
- It is legible at article width and as a narrow mobile thumbnail.
- Its focal point survives the intended crop.
- Contrast, composition, and brand family are coherent with the rest of the article.
- It contains no watermark, fabricated evidence, private data, or unresolved rights issue.
- It has useful alt text and every body image has a `▲` caption.

Score relevance, clarity, composition, brand consistency, and mobile legibility from 1 to 5. Each score must be at least 3 and the average must be at least 4.0. These scores supplement the hard checks; they never override a failed factual, rights, privacy, or evidence check.

## Machine-Readable Manifest

Create `visual-manifest.json` beside the article Markdown. Use `visual-manifest.example.json` as the compact schema example. The manifest must bind:

- article slug, revision, registered editorial category, type, visual family, Markdown path, and JPage HTML path;
- the adaptive visual floor and one visual decision for every H2 section;
- each asset ID, package-relative path, article placement, purpose, evidence status, source type, rights, privacy, minimum dimensions, aspect range, alt text, and caption;
- the reviewer, review time, reviewed SHA-256, hard-check results, and quality scores;
- `asset_gate=pass` and `integrated_render_gate=pass` only after actual inspection.

For `architecture-map`, also bind `article.architecture_overview_asset_id`, the overview's stable region IDs, and every architecture/workflow detail's overview ID, region subset, and highlight or zoom treatment. The validator requires the overview to be the first body image before any H2 and limits the preceding orientation to 300 content characters.

## Local and JPage Validation

Generate the normal WeChat fragment and a separate self-contained JPage review document:

```bash
python3 ../format-wechat-article/scripts/render_wechat_html.py \
  article.md --output article.wechat.html --theme green-tech

python3 ../format-wechat-article/scripts/render_wechat_html.py \
  article.md --output article.jpage.html --theme green-tech \
  --standalone --embed-local-images --title "Article preview"
```

After inspecting the complete page at narrow mobile widths, run:

```bash
python3 scripts/validate_visual_package.py \
  --manifest /absolute/path/to/visual-manifest.json \
  --target jpage-preview \
  --report /absolute/path/to/visual-quality-report.json
```

Exit code `0` and `gate: pass` are required. The validator checks package path containment, file signatures, dimensions, hashes, density, section decisions, review evidence, Markdown ordering, HTML ordering, alt text, captions, and embedded-image equality. It cannot decide whether an image is aesthetically strong; the recorded visual review must come from inspecting the actual image and integrated page.

Keep the self-contained HTML below the validator's 45 MiB safety limit. Compress or resize reviewed assets without changing their meaning, then recompute hashes and repeat the gates; never silently substitute lower-quality files after review.

## Preview Release Rule

Treat `article.jpage.html` as the canonical visual review surface and `article.md` as the same-revision editable source. Store both in JPage. After the approved private upload, inspect the authenticated remote HTML, confirm all images load at mobile width, and record `remote_render_gate=pass`. Only then return the preview location to the user.
