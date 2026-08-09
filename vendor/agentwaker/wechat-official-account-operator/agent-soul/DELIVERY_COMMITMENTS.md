# Delivery Commitments

| Task type | Deliverable | Completion evidence |
|-----------|-------------|---------------------|
| Every meaningful run | A `workdir-v1` run containing `run.yaml`, typed input/raw/intermediate/output/evidence directories as used, sanitized diagnostics, and a truthful memory outcome | Both required environment paths were validated; canonical memory was read before planning; the manifest records timestamps, status, memory hash, inputs, outputs, evidence, and `none`, `promoted`, `proposal-only`, or `conflict`. |
| Source landscape | Tiered source registry, collection method, access constraints, and selection policy | URLs and verification dates are present; source roles and risks are explicit. |
| Signal scan | Deduplicated candidates with scores, evidence links, confidence, and recommended disposition | Time window, queries, source mix, and score breakdown are recorded. |
| Editorial backlog | Sequenced article ideas with registered category, reader promise, original angle, supporting format, prerequisites, and evidence needs | Each item maps to a content pillar, category contract, and a next or previous article. |
| Architecture-map article | Complete numbered architecture overview followed by same-map region breakdowns and an end-to-end return | The overview is the first body image before any H2; local architecture or workflow figures bind to the overview asset and its region IDs. |
| Open-source recommendation | Evidence-backed verdict, minimal workflow, same-job alternatives, adoption risks, and final rating | The article ends with a supported `S`, `A`, `B`, or `Watch` decision and separates popularity from adoption evidence. |
| Deep tutorial | Versioned setup, architecture explanation, workflow, examples, limitations, source ledger, and correction risks | Commands and observations are reproducible or explicitly marked as source-derived. |
| WeChat visual package | Cover decision, visual family, image manifest, asset paths, alt text, captions, rights notes, and crop-readiness report | Evidence uses real captures; generated assets are explanatory; mobile and backend crops are checked. |
| WeChat package | Title options, selected title, author, digest, Markdown, inline HTML, cover, image map, CTA, and source ledger | Local files pass the formatting and editorial checklists. |
| JPage pre-draft preview | Private Markdown and HTML files for the same revision plus paired file IDs, authenticated preview locations, hashes, visibility, tags, and approval receipt | Both remote files match the local digests and remain private before any WeChat draft write. |
| Draft operation | Exact account target, payload summary, approval, returned draft identifier, and post-write inspection | The API result and subsequent draft read are recorded without secrets. |
| Publication operation | Final payload summary, distinct approval, publication job identifier, terminal status, and article identifier or URL | Status is terminal and public result is verified; submission alone is insufficient. |
| Performance review | Windowed metrics, normalized comparisons, reader-signal interpretation, uncertainties, and next tests | Observed data is separated from causal hypotheses. |

## Final Response Contract

Every final response should include:

- What was researched, planned, drafted, formatted, written, or verified.
- The current `AGENT_WORK_DIR` run path, final artifact paths, and platform identifier when applicable.
- Which facts and platform states were checked live.
- Which assumptions or access gaps remain.
- Whether any account write occurred and the approval that covered it.
- Whether a durable memory lesson was promoted, retained as a proposal, conflicted, or intentionally omitted.
- The next editorial action, approval, or handoff.

Completion is blocked when the runtime paths were not validated, memory was not read before planning, `run.yaml` is missing or stale, claimed outputs or evidence do not exist, or a memory conflict was overwritten. A run may complete with `memory_update.status: none`; routine task output is not a reason to expand long-term memory.
