# Architecture Infographic System

Use this system for `architecture-map` articles. The target look is a clean technology editorial infographic: a white canvas, black information structure, restrained green state cues, modular numbered regions, and compact vector flow diagrams. It is a structured diagram product, not generated illustration.

## Generation Model

Build the visual from structured architecture data, reusable components, and deterministic layout:

1. Freeze the system boundary and evidence-backed nodes and relationships.
2. Define stable region IDs, node IDs, node types, labels, edges, and semantic states in an editable source.
3. Lay out the complete overview with SVG, HTML/CSS, Mermaid-derived SVG, Graphviz, Figma components, or another code-native vector route.
4. Export a reviewed PNG for the article while retaining the editable source.
5. Derive detail figures from the same source by highlighting or zooming regions. Do not redraw them as unrelated illustrations.

Image generation may support an abstract cover background, but it must not generate the architecture overview, workflow details, labels, evidence, or diagrams.

## Page Anatomy

- Paper-white canvas with generous outer margins.
- One large ink-black headline and one short muted subtitle.
- A modular grid of numbered panels or a single system boundary divided into numbered regions.
- Consistent node, connector, boundary, note, and legend components.
- Short labels, direct arrows, and one visible reading direction.
- A compact legend only when color, line style, or node shape carries meaning.
- No decorative scene, product still life, device mockup, or atmospheric background behind the diagram.

The reference composition may use four columns on a wide master canvas, but the WeChat body export must remain legible at 677 px article width. Prefer one column for dense panels and no more than two columns for simple panels. If a complete overview requires a wide canvas, enlarge labels and reduce node count instead of shrinking text.

## Locked Visual Language

| Element | Treatment |
|---|---|
| Canvas and cards | `#F7FAF8` or `#FFFFFF`, thin `#CBD8D0` boundary |
| Primary type and system boundaries | `#101713` |
| Active path, selected region, verified state | `#159A62` |
| Active wash | `#DDF3E7` |
| Supporting text and inactive edges | `#5B6B62` |
| Deep technical block or code surface | `#0B2A1F` with `#F7FAF8` text |
| Lines | 1.5-2 px, square or gently rounded ends, minimal crossings |
| Corners | 6-10 px; avoid excessive pills |
| Spacing | 8 px base rhythm |

Black and white should carry at least 75 percent of the composition. Green occupies roughly 10-20 percent and communicates meaning rather than decoration.

## Component Semantics

- Input or user: white fill, black boundary.
- Process or agent: white or mint fill, black boundary.
- Active, selected, passed, or recommended: green boundary or green fill with high-contrast text.
- Storage or memory: mint or light gray surface with a conventional database shape when useful.
- Decision: diamond with black boundary; use green only on the chosen branch.
- External dependency: dashed black or gray boundary.
- Group or system boundary: thin gray boundary with a stable numbered label.
- Failure or risk: black label with a restrained warning marker; do not introduce a second saturated brand color unless evidence requires it.

Node color, shape, and line style must preserve the same meaning across the overview and all derivatives.

## Complete-Map-First Contract

The first body image is the complete architecture overview after only a short orientation. It must:

- show the full evidence-supported boundary;
- expose the main input-to-output path;
- assign stable region IDs such as `01`, `02`, and `03`;
- include all relationships later discussed in the article;
- remain understandable before the prose decomposition begins.

Each later architecture or workflow figure must bind to the overview asset ID and a subset of its region IDs. Allowed treatments are highlight, zoom, or highlight-and-zoom. Preserve node names, colors, arrow directions, boundaries, and semantics. End the article by returning to the whole-system path.

## Rejection Rules

Reject the asset when any of these is true:

- It is a photorealistic studio scene, paper craft, miniature machine, clay or toy isometric scene.
- It uses beige lifestyle staging, glassmorphism, card piles, floating cubes, glowing brains, or generic AI networks.
- It looks like a dashboard instead of a system diagram.
- Text is too small at article width or depends on zooming.
- The overview and detail figures use different names, colors, geometry, or relationship semantics.
- Arrows cross excessively, the reading direction is ambiguous, or the legend does not explain a visual encoding.
- A generated image presents invented UI, terminal output, benchmarks, logos, or other evidence-looking content.

## Deliverables

- Editable structured source containing regions, nodes, edges, and semantic states.
- Editable vector or code-native diagram source.
- Reviewed overview PNG and overview-bound detail PNGs.
- Manifest bindings, alt text, captions, SHA-256 values, and original-size plus mobile-width inspection evidence.
