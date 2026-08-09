# Weaver Greenline Visual System

## Brand Intent

Communicate practical AI engineering through green signals, black structure, and white space. Make the article feel like a precise technology publication, not an AI stock-art campaign.

Use the stable profile ID `green-black-white-tech`. Verify the visible public account name before placing it inside an asset. Add exact Chinese typography deterministically after image generation; do not ask an image model to render labels.

## Core Palette

| Token | Value | Role |
|-------|-------|------|
| Signal green | `#159A62` | Active path, verified state, section marker, and rating accent |
| Deep forest | `#0B2A1F` | Dark field, code, architecture boundary, and strong title bar |
| Ink black | `#101713` | Primary type, module outlines, and high-contrast structure |
| Paper white | `#F7FAF8` | Dominant canvas and negative space |
| Pure white | `#FFFFFF` | Cards, screenshots, and light surfaces |
| Mint wash | `#DDF3E7` | Quiet callout, selected region, and secondary state |
| Line gray | `#CBD8D0` | Dividers, grids, inactive paths, and secondary structure |
| Muted ink | `#5B6B62` | Captions and supporting labels |

Let black and white carry at least 75 percent of the composition. Use signal green for 10-20 percent and mint only as a quiet supporting tint. Do not introduce orange, cyan, blue-purple gradients, or multiple competing accent colors unless a real screenshot or source chart requires them.

### Light Treatment

- Use paper white as the dominant field.
- Use ink black for type, module boundaries, and hierarchy.
- Use signal green for the one active path, selected region, or editorial verdict.
- Use a faint technical grid only when it improves alignment or scale.

### Dark Treatment

- Use ink black or deep forest as the field.
- Use white for primary type and module surfaces.
- Use signal green for sparse active paths and status marks.
- Avoid neon glow, pure hacker-terminal cosplay, glass effects, lens flare, and decorative circuit noise.

## Visual Grammar

- Prefer flat two-dimensional editorial graphics, deterministic diagrams, real evidence, and typographic composition.
- Use an 8 px layout rhythm, 1.5-2 px structural lines, square or lightly rounded corners, and generous white space.
- Use arrows only for a real request, data, control, or state transition. State the arrow semantics in the legend.
- Keep one dominant idea per image. A cover may intrigue; a body visual must explain.
- Use large black type and one green signal rather than many floating cards, glowing nodes, or decorative objects.

## Cover Selection

Choose one value from each axis:

| Axis | Choices | Default |
|------|---------|---------|
| Concept | architecture crop, verified workflow, project capability, comparison decision, result-first evidence | category-specific reader decision |
| Palette | white-led, black-led | white-led for most articles; black-led for a major release |
| Rendering | flat editorial vector, technical schematic, annotated evidence, restrained data graphic | flat editorial vector |
| Text | none from the image model; deterministic title or qualifier after selection | short deterministic title |
| Mood | precise, analytical, direct | precise |

Verify the current cover crop in the WeChat backend. Keep the core symbol and any essential text inside the central safe area so both wide and compact previews remain usable.

### Category Treatments

**`architecture-map`**

- Use a white or paper-white canvas, black module boundaries, gray inactive connections, and one green end-to-end path.
- Make the complete architecture overview the first body image. Use numbered regions, a small legend, stable arrow semantics, and no shadows.
- Derive detail figures from the overview by dimming unrelated regions and highlighting the current region in green.
- Prefer SVG, Mermaid-derived SVG, or another deterministic diagram route over ImageGen.

**`open-source-recommendation`**

- Combine one real project screenshot or verified workflow with a black editorial frame and restrained green verdict badge.
- Use green for `S`, `A`, or verified strengths; use neutral gray for unknowns and black for risks. Do not turn risk into alarm-red decoration.
- Prefer capability maps, same-job comparisons, evidence strips, and rating cards over a generated project mascot or launch poster.

## In-Article Visual Types

| Type | Use for | Preferred treatment |
|------|---------|---------------------|
| Architecture | components, boundaries, data or tool flow | deterministic black-line schematic with one green active path |
| Workflow | steps, agent loops, review gates | flat white canvas with black nodes and green verified states |
| Comparison | two to four alternatives | black-and-white editorial grid with one green decision signal |
| Evidence | UI, terminal, errors, outputs | real annotated screenshot or terminal capture |
| Data | measured results and costs | restrained editorial chart with units and method note |
| Timeline | releases, migration, lifecycle | horizontal editorial timeline |
| Concept | abstract mental model only when a diagram cannot explain it | two-dimensional editorial symbol with deterministic labels |

## Style Rules

- Use only the `green-black-white-tech` family unless the user explicitly changes the brand system.
- Use thick, simple geometry that remains legible on a phone.
- Avoid photorealistic people unless the article genuinely requires a real person or event.
- Keep generated images free of brand logos and evidence-looking UI.
- Put long explanations in the article, not inside the image.
- Use exact Chinese text only when text is essential; preserve English project names and technical identifiers verbatim.
- Treat screenshots as evidence: show version, command, state, or context when relevant, and redact private data.
- Add a concise `▲` caption that states what the reader should notice rather than repeating the alt text.

## Hard Rejections

Reject and regenerate or redesign any asset that uses:

- Photorealistic studio product still lifes, paper craft, miniature machines, clay models, toy-like isometric scenes, or beige lifestyle staging.
- Generic AI networks, glowing brains, floating cubes, particle graphs, decorative circuitry, or blue-purple gradients.
- Dashboard-like card piles, excessive rounded rectangles, large soft shadows, glassmorphism, or presentation-slide composition.
- A metaphor that could illustrate any AI article and does not expose the current article's real system, workflow, evidence, or decision.
- Generated interfaces, terminals, charts, logos, benchmarks, or architecture labels presented as evidence.

## Content-Driven Asset Count

- Short update: cover plus at least one explanatory or evidence visual.
- Deep project tutorial: cover plus at least four purposeful body visuals; include an overview and real screenshots for the critical operating phases.
- Comparison: cover plus at least three body visuals, including a comparison or decision visual and the evidence needed to support the judgment.
- `architecture-map`: cover plus at least three body visuals; the first body image is the complete numbered overview, followed by highlight or zoom derivatives bound to that same map's difficult regions or flows.
- Opinion: cover plus at least two explanatory body visuals.
- Review or retrospective: cover plus at least three body visuals, including a chart when a measured performance claim is made.

Do not allow two consecutive H2 sections to remain text-only without an approved, recorded waiver. These are minimum explanatory floors, not maximums and not permission to add decorative filler. The detailed gate and exception rules live in `visual-quality-gate.md`.

## Rejection Checks

Reject an asset when it:

- Fabricates a product screen, terminal output, benchmark, quote, or logo.
- Places required content near a crop edge.
- Becomes unreadable at a small mobile thumbnail.
- Uses more than one dominant accent or mixes unrelated rendering styles.
- Includes private data, unclear rights, or an unverified claim.
- Looks decorative but does not improve understanding or navigation.
