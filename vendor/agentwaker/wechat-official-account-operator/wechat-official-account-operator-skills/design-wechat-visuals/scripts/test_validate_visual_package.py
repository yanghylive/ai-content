#!/usr/bin/env python3
"""Regression tests for the WeChat visual-package quality gate."""

from __future__ import annotations

import base64
import hashlib
import json
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from validate_visual_package import validate_package


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def png_bytes(width: int, height: int) -> bytes:
    rows = b"".join(b"\x00" + (b"\x18\x2a\x44" * width) for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(rows, level=9))
        + png_chunk(b"IEND", b"")
    )


class VisualPackageTests(unittest.TestCase):
    def build_package(self, root: Path, *, embedded: bool = True) -> tuple[Path, dict]:
        assets_dir = root / "assets"
        assets_dir.mkdir()
        files = {
            "cover": ("assets/cover.png", 1200, 500, "cover", "generated_concept", False),
            "figure-01": ("assets/figure-01.png", 720, 360, "architecture", "original_diagram", False),
            "figure-02": ("assets/figure-02.png", 720, 360, "workflow", "original_diagram", False),
            "figure-03": ("assets/figure-03.png", 720, 360, "evidence", "real_screenshot", True),
            "figure-04": ("assets/figure-04.png", 720, 360, "data", "data_chart", True),
        }
        file_bytes: dict[str, bytes] = {}
        for asset_id, (relative, width, height, *_rest) in files.items():
            data = png_bytes(width, height)
            (root / relative).write_bytes(data)
            file_bytes[asset_id] = data

        markdown_parts: list[str] = []
        body_ids = ["figure-01", "figure-02", "figure-03", "figure-04"]
        for order, asset_id in enumerate(body_ids, start=1):
            markdown_parts.extend(
                [
                    f"## 0{order}. Section {order}",
                    "",
                    f"![Alt {order}](assets/{asset_id}.png)",
                    "",
                    f"▲ Caption {order}.",
                    "",
                ]
            )
        (root / "article.md").write_text("\n".join(markdown_parts), encoding="utf-8")

        html_images: list[str] = []
        for order, asset_id in enumerate(body_ids, start=1):
            ref = f"assets/{asset_id}.png"
            if embedded:
                encoded = base64.b64encode(file_bytes[asset_id]).decode("ascii")
                html_images.append(
                    f'<img src="data:image/png;base64,{encoded}" alt="Alt {order}" '
                    f'data-preview-embedded="true" data-source-image="{ref}" />'
                )
            else:
                html_images.append(f'<img src="{ref}" alt="Alt {order}" data-local-image="true" />')
        (root / "article.jpage.html").write_text(
            "<!doctype html><html><body>" + "".join(html_images) + "</body></html>",
            encoding="utf-8",
        )

        assets: list[dict] = []
        for order, (asset_id, values) in enumerate(files.items()):
            relative, width, height, role, source_type, evidence = values
            is_cover = role == "cover"
            review = {
                "status": "approved",
                "sha256": hashlib.sha256(file_bytes[asset_id]).hexdigest(),
                "reviewer": "wechat-operator",
                "reviewed_at": "2026-07-11T10:00:00+08:00",
                "content_accurate": True,
                "mobile_legible": True,
                "crop_safe": True,
                "contrast_passed": True,
                "style_consistent": True,
                "no_fabricated_evidence": True,
                "no_watermark": True,
                "text_checked": True,
                "green_black_white_profile_passed": True,
                "no_generic_3d_still_life": True,
                "scores": {
                    "relevance": 4,
                    "clarity": 4,
                    "composition": 4,
                    "brand_consistency": 4,
                    "mobile_legibility": 4,
                },
            }
            asset = {
                "id": asset_id,
                "role": role,
                "path": relative,
                "html_ref": relative,
                "purpose": f"Purpose for {asset_id}",
                "source_type": source_type,
                "evidence": evidence,
                "required": True,
                "rights": {"status": "original", "source": "local fixture"},
                "privacy_status": "cleared",
                "requirements": {
                    "min_width": width,
                    "min_height": height,
                    "aspect_min": 1.0,
                    "aspect_max": 3.0,
                },
                "review": review,
            }
            if not is_cover:
                asset.update(
                    {
                        "alt": f"Alt {order}",
                        "caption": f"▲ Caption {order}.",
                        "placement": {"after_h2": f"0{order}. Section {order}", "order": order},
                    }
                )
            assets.append(asset)

        manifest = {
            "schema_version": 1,
            "article": {
                "slug": "article",
                "revision": "2026-07-11-r1",
                "type": "tutorial",
                "category": "open-source-recommendation",
                "brand_profile": "green-black-white-tech",
                "visual_family": "flat-vector",
                "markdown": "article.md",
                "html": "article.jpage.html",
            },
            "policy": {"min_inline_assets": 4, "max_consecutive_text_only_sections": 1},
            "sections": [
                {
                    "heading": f"0{order}. Section {order}",
                    "decision": "asset",
                    "reason": "A visual explains this section faster.",
                    "asset_ids": [asset_id],
                }
                for order, asset_id in enumerate(body_ids, start=1)
            ],
            "assets": assets,
            "review": {
                "asset_gate": "pass",
                "integrated_render_gate": "pass",
                "reviewer": "wechat-operator",
                "reviewed_at": "2026-07-11T10:05:00+08:00",
            },
        }
        manifest_path = root / "visual-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        return manifest_path, manifest

    def rewrite_manifest(self, path: Path, manifest: dict) -> None:
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    def configure_architecture_package(self, root: Path, manifest: dict) -> None:
        manifest["article"].update(
            {
                "type": "architecture",
                "category": "architecture-map",
                "architecture_overview_asset_id": "figure-01",
            }
        )
        manifest["policy"]["min_inline_assets"] = 3
        manifest["assets"][1]["architecture_binding"] = {
            "kind": "overview",
            "region_ids": ["01", "02", "03"],
        }
        manifest["assets"][2]["architecture_binding"] = {
            "kind": "detail",
            "overview_asset_id": "figure-01",
            "region_ids": ["02"],
            "treatment": "highlight-and-zoom",
        }
        body = [
            "# 一张架构图讲透测试系统",
            "",
            "先看完整架构图，再沿着 01 到 03 的主链路逐层拆解。",
            "",
            "![Alt 1](assets/figure-01.png)",
            "",
            "▲ Caption 1.",
            "",
            "## 01. Section 1",
            "",
            "## 02. Section 2",
            "",
            "![Alt 2](assets/figure-02.png)",
            "",
            "▲ Caption 2.",
            "",
            "## 03. Section 3",
            "",
            "![Alt 3](assets/figure-03.png)",
            "",
            "▲ Caption 3.",
            "",
            "## 04. Section 4",
            "",
            "![Alt 4](assets/figure-04.png)",
            "",
            "▲ Caption 4.",
            "",
        ]
        (root / "article.md").write_text("\n".join(body), encoding="utf-8")

    def test_complete_tutorial_passes_jpage_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path, _ = self.build_package(Path(directory))
            report = validate_package(manifest_path, "jpage-preview")
            self.assertEqual(report["gate"], "pass", report["errors"])
            self.assertEqual(len(report["assets"]), 5)

    def test_rejects_wrong_brand_profile(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            manifest["article"]["brand_profile"] = "beige-toy-studio"
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertEqual(report["gate"], "fail")
            self.assertTrue(any("article.brand_profile" in error for error in report["errors"]))

    def test_rejects_unreviewed_generic_3d_still_life(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            manifest["assets"][0]["review"]["no_generic_3d_still_life"] = False
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertEqual(report["gate"], "fail")
            self.assertTrue(any("no_generic_3d_still_life" in error for error in report["errors"]))

    def test_architecture_map_overview_first_and_bound_details_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            self.configure_architecture_package(root, manifest)
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertEqual(report["gate"], "pass", report["errors"])

    def test_architecture_map_rejects_unbound_detail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            self.configure_architecture_package(root, manifest)
            del manifest["assets"][2]["architecture_binding"]
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertEqual(report["gate"], "fail")
            self.assertTrue(any("architecture binding kind must be detail" in error for error in report["errors"]))

    def test_architecture_map_rejects_overview_after_h2(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            self.configure_architecture_package(root, manifest)
            article = root / "article.md"
            article.write_text("## Premature section\n\n" + article.read_text(encoding="utf-8"), encoding="utf-8")
            manifest["sections"].insert(
                0,
                {"heading": "Premature section", "decision": "text", "reason": "Invalid opening under test.", "asset_ids": []},
            )
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertEqual(report["gate"], "fail")
            self.assertTrue(any("before the first H2" in error for error in report["errors"]))

    def test_local_relative_preview_only_passes_local_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path, _ = self.build_package(Path(directory), embedded=False)
            local = validate_package(manifest_path, "local-render")
            remote = validate_package(manifest_path, "jpage-preview")
            self.assertEqual(local["gate"], "pass", local["errors"])
            self.assertEqual(remote["gate"], "fail")
            self.assertTrue(any("unresolved local image" in error for error in remote["errors"]))

    def test_changed_image_fails_review_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, _ = self.build_package(root)
            (root / "assets" / "figure-01.png").write_bytes(png_bytes(800, 400))
            report = validate_package(manifest_path, "jpage-preview")
            self.assertEqual(report["gate"], "fail")
            self.assertTrue(any("changed after review" in error for error in report["errors"]))

    def test_corrupt_image_fails_file_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            corrupt = b"not-a-png"
            (root / "assets" / "figure-01.png").write_bytes(corrupt)
            manifest["assets"][1]["review"]["sha256"] = hashlib.sha256(corrupt).hexdigest()
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertTrue(any("invalid image file" in error for error in report["errors"]))

    def test_low_resolution_image_fails_requirements(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            small = png_bytes(100, 100)
            (root / "assets" / "figure-01.png").write_bytes(small)
            manifest["assets"][1]["review"]["sha256"] = hashlib.sha256(small).hexdigest()
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertTrue(any("dimensions 100x100" in error for error in report["errors"]))

    def test_generated_asset_cannot_be_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            manifest["assets"][1]["role"] = "evidence"
            manifest["assets"][1]["source_type"] = "generated_concept"
            manifest["assets"][1]["evidence"] = True
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertTrue(any("cannot be evidence" in error for error in report["errors"]))

    def test_visual_density_floor_cannot_be_lowered(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            manifest["policy"]["min_inline_assets"] = 2
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertTrue(any("must be at least 4" in error for error in report["errors"]))

    def test_long_article_raises_density_floor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, _ = self.build_package(root)
            article = root / "article.md"
            article.write_text(article.read_text(encoding="utf-8") + "\n" + ("字" * 5000), encoding="utf-8")
            report = validate_package(manifest_path, "jpage-preview")
            self.assertGreater(report["article_character_count"], 5000)
            self.assertTrue(any("policy.min_inline_assets must be at least" in error for error in report["errors"]))

    def test_two_consecutive_text_sections_require_waiver(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            for section in manifest["sections"][:2]:
                section["decision"] = "text"
                section["reason"] = "The prose is intentionally primary."
                section["asset_ids"] = []
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertTrue(any("approved waiver" in error for error in report["errors"]))

    def test_failed_subjective_review_blocks_preview(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            manifest["assets"][1]["review"]["mobile_legible"] = False
            manifest["assets"][1]["review"]["scores"]["composition"] = 2
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertTrue(any("mobile_legible must be true" in error for error in report["errors"]))
            self.assertTrue(any("composition is below 3" in error for error in report["errors"]))

    def test_path_escape_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, manifest = self.build_package(root)
            manifest["assets"][1]["path"] = "../outside.png"
            self.rewrite_manifest(manifest_path, manifest)
            report = validate_package(manifest_path, "jpage-preview")
            self.assertTrue(any("stay inside" in error for error in report["errors"]))

    def test_embedded_image_must_match_reviewed_asset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path, _ = self.build_package(root)
            html_path = root / "article.jpage.html"
            html_path.write_text(
                html_path.read_text(encoding="utf-8").replace(
                    "data:image/png;base64,",
                    "data:image/png;base64," + base64.b64encode(png_bytes(720, 360)).decode("ascii"),
                    1,
                ),
                encoding="utf-8",
            )
            report = validate_package(manifest_path, "jpage-preview")
            self.assertTrue(any("differs from the reviewed asset" in error for error in report["errors"]))


if __name__ == "__main__":
    unittest.main()
