# Editorial Category Registry

Assign exactly one primary category before outlining an article. Treat a category as an execution contract: it defines the reader promise, article sequence, visual grammar, and completion evidence. Add future categories here first, then connect them to planning, drafting, visual production, formatting, and validation.

## `architecture-map`

**Display concept:** Explain one system through a complete architecture map.

**Reader promise:** See the complete system first, then understand every important design region without losing its position in the whole.

Use this category only when a defensible complete architecture can be reconstructed from official documentation, code, or clearly labeled inference.

Required sequence:

1. Write only a title and a 50-100 Chinese-character orientation before the first body image.
2. Make the first body image the complete architecture map. Include the system boundary, numbered regions, major modules, external dependencies, storage, principal request or data flow, arrows, and legend.
3. Explain how to read the map and state the main path through its region IDs.
4. Decompose the system in the same region order, using the same names, IDs, colors, and relationship semantics as the overview.
5. For every region, explain its position, inputs, internal responsibility, outputs, design reason, tradeoffs, and failure behavior.
6. Use highlighted or zoomed derivatives of the overview for local explanations. Do not redraw an unrelated second architecture.
7. Return to the complete map and summarize the end-to-end path, bottlenecks, risks, and reusable design ideas.

Evidence rules:

- Classify every material relationship as `official-confirmed`, `source-derived`, or `editorial-inference` in the diagram source or claim ledger.
- Do not invent hidden components or relationships to make the map look complete.
- If the evidence cannot support a complete map, block this category or narrow the stated system boundary.

Manifest rules:

- Set `article.category` to `architecture-map` and `article.type` to `architecture`.
- Set `article.architecture_overview_asset_id` to the first body asset.
- Give the overview asset an `architecture_binding` with `kind: overview` and all region IDs.
- Give every architecture or workflow derivative an `architecture_binding` with `kind: detail`, the same overview asset ID, a non-empty subset of region IDs, and `treatment: highlight`, `zoom`, or `highlight-and-zoom`.

## `open-source-recommendation`

**Display concept:** Open-source project radar.

**Reader promise:** Decide whether a current open-source project deserves the reader's time, trial, or production evaluation.

Required sequence:

1. Lead with a one-sentence editorial verdict.
2. Explain why the project matters now and which real problem it solves.
3. Show the core workflow and a minimal reproducible use case.
4. Explain the implementation advantage that materially changes the user experience.
5. Compare the project with its closest alternatives on the same job.
6. State maturity, activity, license, maintenance, security, privacy, cost, and adoption risks.
7. End with who should use it, who should wait, and one rating: `S`, `A`, `B`, or `Watch`.

Rating meanings:

- `S`: ready for immediate production evaluation, not an unconditional production endorsement.
- `A`: worth trying and tracking now.
- `B`: useful in a narrower scenario or with material caveats.
- `Watch`: promising signal, but current evidence or maturity does not justify adoption effort.

Do not turn this category into a popularity recap. Stars, social repetition, and launch-day attention are discovery signals; the recommendation must rest on primary evidence, current activity, reproduction, limitations, and comparison.
