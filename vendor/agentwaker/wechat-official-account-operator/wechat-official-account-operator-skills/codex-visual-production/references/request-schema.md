# Visual request protocol v1

Create `input/visual-request.json` inside a valid Workdir v1 run.

```json
{
  "schema_version": "1.0",
  "request_id": "stable-id",
  "status": "pending_codex",
  "requester": "kimi",
  "platform": "wechat",
  "article": {"slug": "article-slug", "revision": "r1"},
  "visual_contract": {
    "placements": [{"id": "cover", "role": "cover", "aspect_ratio": "2.35:1"}],
    "brand_profile": "green-black-white-tech",
    "reader_job": "Make the HTML-file-to-public-mobile-page transformation clear at a glance",
    "single_visual_idea": "One precise green path connects an input file to a verified public mobile page across a black technical field",
    "primary_subject": ["input file silhouette", "green verified path", "mobile page outline"],
    "visual_metaphor": "A restrained signal path across an editorial technology canvas",
    "platform_style": "Green-black-white technology editorial cover with flat two-dimensional geometry and durable brand memory",
    "composition": "Ultra-wide landscape with a single left-to-right path, large simple shapes, and a crop-safe central verification event",
    "headline_safe_area": "The central crop preserves the input, verification event, and output without relying on small text",
    "camera": "Straight-on orthographic editorial composition with no perspective scene",
    "lighting": "Flat high-contrast graphic treatment with no studio lighting or photorealistic shadows",
    "materials": ["flat vector fields", "fine technical linework"],
    "palette": ["signal green #159A62", "ink black #101713", "paper white #F7FAF8"],
    "exact_overlay_copy": [],
    "avoid": ["generic AI network", "generated evidence UI", "paper craft or miniature machine", "beige product staging", "toy-like isometric scene"],
    "rejection_reasons": ["relationship to the article is not specific", "central crop breaks the transformation", "asset leaves the green-black-white system", "asset resembles a 3D product still life"],
    "evidence_policy": "generated_concept_only"
  },
  "generation": {"executor": "codex", "candidate_budget": 2},
  "handoff": {"final_dir": "output/assets", "result_path": "evidence/visual-result.json"}
}
```

Describe one visible event, concrete subjects, camera, light, material, composition, and rejection rules. `brand_profile` must be `green-black-white-tech`. Adjectives such as “premium” or “modern” are not a visual idea. Paths must be run-relative and cannot contain `..`. `candidate_budget` must be between 1 and 8. Never include credentials. Run `compile` before `claim`; only a current passing compiler receipt may continue to ImageGen. This request route is for conceptual raster assets only; architecture overview and detail diagrams use the deterministic architecture infographic system.
