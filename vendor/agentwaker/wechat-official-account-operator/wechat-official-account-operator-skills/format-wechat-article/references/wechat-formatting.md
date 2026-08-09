# WeChat Formatting Guide

## Supported Bundled Renderer Syntax

- Headings levels 1 through 4
- Paragraphs and explicit line breaks
- Ordered and unordered lists
- Blockquotes
- Fenced code blocks and inline code
- Bold and emphasis
- Links and images
- Horizontal rules
- Numbered level-two headings written as `## 01. Section title` when using the `green-tech` theme
- Standalone image captions whose first non-space character is `▲`

Raw HTML is escaped by default. Complex tables, footnotes, mathematical notation, Mermaid, PlantUML, interactive widgets, nested lists, and arbitrary embedded media require a manual conversion or a reviewed editor.

## Technical Article Rules

- Keep one article title in platform metadata; begin the body with a short reader promise rather than another oversized title.
- Keep paragraphs short enough for a narrow mobile viewport.
- Use section headings to expose the learning path.
- Split long shell commands and explain destructive or costly flags before the code block.
- Avoid wide tables. Convert a necessary comparison to stacked cards, bullets, or an approved image.
- Give every screenshot and diagram an explanatory caption and rights status.
- Put `▲` captions on their own line. State what the reader should notice instead of repeating the alt text.
- Use `## 01. Section title` only when a numbered learning path improves scanning. Do not use the non-standard `##. 01.` form and do not auto-number headings.
- Do not reference a local path in final HTML. Upload approved content images through the official content-image endpoint and replace the placeholder with the returned URL.
- For private JPage review, generate a separate standalone HTML file with `--embed-local-images`; it must embed the exact reviewed local bytes and retain `data-source-image` bindings for the visual validator.
- Upload a cover through the permanent-material endpoint and use its media identifier in the draft payload.
- Treat ordinary external links as potentially non-clickable in the article body. Keep a source ledger and use the configured source URL or an explicit copyable address when necessary.
- Inspect dark mode, code contrast, long lines, and image scale in an actual WeChat draft or equivalent preview.

## Package Layout

```text
article-slug/
|-- article.md
|-- article.wechat.html
|-- article.jpage.html
|-- article.json
|-- source-ledger.md
|-- image-map.json
|-- visual-manifest.json
|-- visual-quality-report.json
`-- assets/
    |-- cover.png
    `-- figure-01.png
```

Keep real credentials and access tokens outside the package.

`article.wechat.html` remains the fragment whose local image references will later be replaced by approved WeChat content-image URLs. `article.jpage.html` is the self-contained visual review surface. Both must come from the same Markdown and visual-manifest revision, and only the JPage form may embed local image bytes.

## Manual Alternatives

- Doocs WeChat Markdown Editor: https://github.com/doocs/md
- mdnice: https://product.mdnice.com/

Review the current license, deployment, credential behavior, and privacy boundary before using any third-party editor. Never enter AppSecret into an untrusted browser instance.
