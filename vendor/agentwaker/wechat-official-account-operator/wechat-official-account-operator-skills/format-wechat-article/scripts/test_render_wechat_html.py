#!/usr/bin/env python3
"""Regression tests for the conservative WeChat Markdown renderer."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from render_wechat_html import THEMES, local_image_resolver, render, safe_url


class RenderWechatHtmlTests(unittest.TestCase):
    def test_green_tech_theme_is_available_without_replacing_legacy_themes(self) -> None:
        self.assertIn("green-tech", THEMES)
        self.assertIn("navy-orange", THEMES)
        self.assertTrue({"teal", "indigo", "graphite"}.issubset(THEMES))

    def test_numbered_h2_is_branded_and_escaped(self) -> None:
        fragment, warnings = render("## 01. <script> & **Title**", "green-tech")
        self.assertFalse(warnings)
        self.assertIn('data-wechat-heading="numbered"', fragment)
        self.assertIn("&lt;script&gt; &amp; <strong>Title</strong>", fragment)
        self.assertNotIn("<script>", fragment)

    def test_legacy_theme_keeps_normal_h2(self) -> None:
        fragment, _ = render("## 01. Section", "teal")
        self.assertNotIn('data-wechat-heading="numbered"', fragment)
        self.assertIn("border-left:4px solid", fragment)

    def test_caption_is_separate_with_or_without_blank_line(self) -> None:
        for markdown in (
            "![Figure](figure.png)\n▲ Notice the verified state.",
            "![Figure](figure.png)\n\n▲ Notice the verified state.",
        ):
            with self.subTest(markdown=markdown):
                fragment, _ = render(markdown, "navy-orange")
                self.assertEqual(fragment.count('data-wechat-caption="true"'), 1)
                self.assertIn("▲ Notice the verified state.", fragment)
                self.assertIn('data-local-image="true"', fragment)

    def test_caption_escapes_html_and_blocks_javascript_link(self) -> None:
        fragment, _ = render(
            "▲ <script> [unsafe](javascript:alert(1)) [safe](https://example.com)",
            "navy-orange",
        )
        self.assertIn("&lt;script&gt;", fragment)
        self.assertNotIn("javascript:", fragment)
        self.assertIn('href="https://example.com"', fragment)

    def test_safe_url_rejects_unsafe_and_parent_paths(self) -> None:
        for value in (
            "javascript:alert(1)",
            "data:text/plain,x",
            "file:///tmp/x",
            "../x.png",
            "assets/../../x.png",
            "/x.png",
        ):
            with self.subTest(value=value):
                self.assertEqual(safe_url(value, image=True), ("", False))
        self.assertEqual(safe_url("figure.png", image=True), ("figure.png", True))
        self.assertEqual(
            safe_url("https://example.com/a?x=1&y=2"),
            ("https://example.com/a?x=1&amp;y=2", False),
        )

    def test_local_image_can_be_embedded_for_self_contained_preview(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "assets").mkdir()
            (root / "assets" / "figure.png").write_bytes(b"\x89PNG\r\n\x1a\npreview")
            warnings: list[str] = []
            fragment, render_warnings = render(
                "![Verified figure](assets/figure.png)",
                "navy-orange",
                local_image_resolver(root, warnings),
            )
            self.assertFalse(warnings)
            self.assertFalse(render_warnings)
            self.assertIn('src="data:image/png;base64,', fragment)
            self.assertIn('data-preview-embedded="true"', fragment)
            self.assertIn('data-source-image="assets/figure.png"', fragment)
            self.assertNotIn('data-local-image="true"', fragment)

    def test_missing_local_image_is_blocked_and_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            warnings: list[str] = []
            fragment, _ = render(
                "![Missing](assets/missing.png)",
                "navy-orange",
                local_image_resolver(Path(directory), warnings),
            )
            self.assertIn("[blocked image: Missing]", fragment)
            self.assertTrue(any("not found" in warning for warning in warnings))


if __name__ == "__main__":
    unittest.main()
