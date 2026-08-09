# WeChat Visual Brief Template

Use this structure for the human-readable visual brief. Also create the machine-readable `visual-manifest.json` defined in `visual-quality-gate.md`; the brief alone never satisfies the visual gate.

```markdown
# Visual brief

## Article
- Working title:
- Reader promise:
- Editorial category: architecture-map | open-source-recommendation
- Brand profile: green-black-white-tech
- Article type: update | tutorial | comparison | architecture | opinion
- Visual family: deterministic vector infographic | flat vector | editorial data
- Cover treatment: concept / palette / rendering / text / mood
- Current backend cover crop verified: yes | no
- Architecture overview asset ID and numbered regions, when applicable:

## Visual opportunity scan

| H2 section | Reader job | Decision: asset / text | Best visual type | Asset ID or approved waiver |
|------------|------------|------------------------|------------------|-----------------------------|
| | | | | |

- Article revision:
- Required body-visual floor:
- Required visual opportunities found:
- Covered opportunities:
- Consecutive text-only sections: 0 | 1 | approved waiver

## Asset manifest

### cover
- Filename:
- Purpose:
- Source type: generated concept | original diagram | licensed asset
- Composition and safe area:
- Exact text, if any:
- Prompt or production instruction:
- Crop/aspect requirement:
- Alt text:
- Rights status:
- Status: planned | approved | generated | verified | rejected
- Final SHA-256:
- Asset gate: pending | pass | fail

### asset-01
- Placement:
- Claim or step explained:
- Source type: screenshot | diagram | chart | generated concept
- Evidence required:
- Capture or generation instruction:
- Exact labels:
- Alt text:
- Caption beginning with `▲`:
- Rights and privacy status:
- Status:
- Final dimensions and SHA-256:
- Architecture binding, when applicable: overview/detail, overview asset ID, region IDs, highlight/zoom treatment
- Factual / text / mobile / crop / contrast / style / rights / privacy checks:
- Quality scores: relevance / clarity / composition / brand consistency / mobile legibility

## Readiness
- [ ] One visual family is used across the package.
- [ ] Green-black-white brand review passed and no beige, paper-craft, miniature, toy, or generic 3D still-life treatment remains.
- [ ] Evidence uses real captures or measured data.
- [ ] Generated assets contain no fabricated UI, output, benchmark, quote, or logo.
- [ ] Required text is accurate at mobile size.
- [ ] Wide and compact crops preserve the focal point.
- [ ] Alt text and `▲` captions are present where useful.
- [ ] Rights and privacy checks are complete.
- [ ] Local paths exist and are mapped for the formatter.
- [ ] Every required asset is a final file with status `verified`, not only a prompt or plan.
- [ ] The adaptive visual floor is met without counting the cover or decorative filler.
- [ ] An `architecture-map` overview is the first body image and every architecture/workflow detail binds to its region IDs.
- [ ] An `open-source-recommendation` includes workflow evidence and a same-job comparison or decision visual.
- [ ] No two consecutive H2 sections are text-only without an approved waiver.
- [ ] The self-contained JPage HTML embeds the exact reviewed image bytes.
- [ ] `validate_visual_package.py` returned `gate: pass` for the current revision.
```

## Prompt Pattern for Conceptual Assets

```text
Use case: WeChat article visual
Article role: cover concept | abstract workflow concept | comparison concept
Primary request: <one explanatory goal>
Visual family: <one brand-approved style>
Composition: <focal object, hierarchy, crop-safe placement>
Palette: signal green #159A62, deep forest #0B2A1F, ink black #101713, paper white #F7FAF8, mint wash #DDF3E7
Exact text: <verbatim text or none>
Constraints: simple geometry, mobile legibility, generous negative space, no logos, no watermark
Avoid: fabricated UI, terminal output, charts, benchmarks, beige studio staging, paper craft, miniature machines, toy-like isometric scenes, card piles, glowing brains, generic AI networks
```

Do not use this conceptual prompt pattern for an `architecture-map` overview or detail diagram. Build those assets through the deterministic architecture infographic system.

## Screenshot Capture Pattern

Record the product, version, platform, action, expected state, crop, required redactions, and the single detail the caption should call out. Preserve enough context to prove the state without exposing unrelated private information.
