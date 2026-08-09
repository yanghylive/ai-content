#!/usr/bin/env python3
"""Validate a WeChat article visual package before a JPage preview is shared."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import re
import struct
import sys
import zlib
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


ARTICLE_MIN_INLINE = {
    "short-update": 1,
    "tutorial": 4,
    "comparison": 3,
    "architecture": 3,
    "opinion": 2,
    "review": 3,
}
ARTICLE_CATEGORIES = {"architecture-map", "open-source-recommendation"}
BRAND_PROFILE = "green-black-white-tech"
BODY_EXTENSIONS = {".jpg", ".jpeg", ".png"}
COVER_EXTENSIONS = BODY_EXTENSIONS | {".bmp", ".gif"}
ASSET_ROLES = {
    "cover",
    "architecture",
    "workflow",
    "comparison",
    "evidence",
    "data",
    "concept",
    "decorative",
}
SOURCE_TYPES = {
    "generated_concept",
    "original_diagram",
    "real_screenshot",
    "data_chart",
    "licensed_asset",
}
HARD_REVIEW_FLAGS = {
    "content_accurate",
    "mobile_legible",
    "crop_safe",
    "contrast_passed",
    "style_consistent",
    "no_fabricated_evidence",
    "no_watermark",
    "text_checked",
    "green_black_white_profile_passed",
    "no_generic_3d_still_life",
}
SCORE_FIELDS = {
    "relevance",
    "clarity",
    "composition",
    "brand_consistency",
    "mobile_legibility",
}
IMAGE_LINE = re.compile(r"^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$")
H2_LINE = re.compile(r"^\s*##\s+(.+?)\s*#*\s*$")
DATA_URI = re.compile(r"^data:(image/(?:png|jpeg|gif|bmp));base64,([A-Za-z0-9+/=]+)$")


class PackageError(RuntimeError):
    """Raised when the package cannot be read at all."""


class PreviewHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images: list[dict[str, str]] = []
        self.has_script = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.lower()
        if lowered == "script":
            self.has_script = True
        if lowered == "img":
            self.images.append({key.lower(): value or "" for key, value in attrs})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate image files, visual review evidence, Markdown references, and preview HTML."
    )
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--target", choices=("local-render", "jpage-preview"), required=True)
    parser.add_argument("--report", required=True, type=Path)
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PackageError(f"cannot read JSON manifest {path}: {error}") from error
    if not isinstance(value, dict):
        raise PackageError("visual manifest must be a JSON object")
    return value


def object_value(value: Any, label: str, errors: list[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        errors.append(f"{label} must be an object")
        return {}
    return value


def list_value(value: Any, label: str, errors: list[str]) -> list[Any]:
    if not isinstance(value, list):
        errors.append(f"{label} must be an array")
        return []
    return value


def safe_package_path(root: Path, raw: Any, label: str, errors: list[str]) -> Path | None:
    if not isinstance(raw, str) or not raw.strip():
        errors.append(f"{label} must be a non-empty relative path")
        return None
    relative = Path(raw)
    if relative.is_absolute() or ".." in relative.parts:
        errors.append(f"{label} must stay inside the article package: {raw}")
        return None
    resolved = (root / relative).resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        errors.append(f"{label} escapes the article package: {raw}")
        return None
    if not resolved.is_file():
        errors.append(f"{label} does not exist: {raw}")
        return None
    return resolved


def png_dimensions(data: bytes) -> tuple[int, int]:
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("invalid PNG signature")
    offset = 8
    width = height = 0
    saw_idat = False
    saw_iend = False
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError("truncated PNG chunk")
        payload = data[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack(">I", data[offset + 8 + length : end])[0]
        actual_crc = zlib.crc32(kind + payload) & 0xFFFFFFFF
        if expected_crc != actual_crc:
            raise ValueError("invalid PNG chunk CRC")
        if kind == b"IHDR":
            if length != 13 or width or height:
                raise ValueError("invalid PNG IHDR")
            width, height = struct.unpack(">II", payload[:8])
        if kind == b"IDAT":
            saw_idat = True
        if kind == b"IEND":
            saw_iend = True
            break
        offset = end
    if width <= 0 or height <= 0 or not saw_idat or not saw_iend:
        raise ValueError("PNG is missing dimensions, image data, or IEND")
    return width, height


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
        raise ValueError("invalid JPEG SOI or EOI")
    offset = 2
    sof_markers = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    while offset + 4 <= len(data):
        while offset < len(data) and data[offset] != 0xFF:
            offset += 1
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            break
        marker = data[offset]
        offset += 1
        if marker in {0x01, *range(0xD0, 0xDA)}:
            continue
        if offset + 2 > len(data):
            break
        length = struct.unpack(">H", data[offset : offset + 2])[0]
        if length < 2 or offset + length > len(data):
            raise ValueError("truncated JPEG segment")
        if marker in sof_markers:
            if length < 7:
                raise ValueError("invalid JPEG SOF")
            height, width = struct.unpack(">HH", data[offset + 3 : offset + 7])
            if width <= 0 or height <= 0:
                raise ValueError("invalid JPEG dimensions")
            return width, height
        offset += length
    raise ValueError("JPEG dimensions not found")


def gif_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 10 or data[:6] not in {b"GIF87a", b"GIF89a"}:
        raise ValueError("invalid GIF signature")
    width, height = struct.unpack("<HH", data[6:10])
    if width <= 0 or height <= 0:
        raise ValueError("invalid GIF dimensions")
    return width, height


def bmp_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 26 or not data.startswith(b"BM"):
        raise ValueError("invalid BMP signature")
    dib_size = struct.unpack("<I", data[14:18])[0]
    if dib_size == 12:
        width, height = struct.unpack("<HH", data[18:22])
    elif dib_size >= 40 and len(data) >= 26:
        width, height = struct.unpack("<ii", data[18:26])
        height = abs(height)
    else:
        raise ValueError("unsupported BMP DIB header")
    if width <= 0 or height <= 0:
        raise ValueError("invalid BMP dimensions")
    return width, height


def inspect_image(path: Path) -> tuple[str, int, int, bytes]:
    data = path.read_bytes()
    if not data:
        raise ValueError("image is empty")
    suffix = path.suffix.lower()
    if suffix == ".png":
        width, height = png_dimensions(data)
        return "png", width, height, data
    if suffix in {".jpg", ".jpeg"}:
        width, height = jpeg_dimensions(data)
        return "jpeg", width, height, data
    if suffix == ".gif":
        width, height = gif_dimensions(data)
        return "gif", width, height, data
    if suffix == ".bmp":
        width, height = bmp_dimensions(data)
        return "bmp", width, height, data
    raise ValueError(f"unsupported image extension: {suffix or '<none>'}")


def markdown_images(markdown: str, errors: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    lines = markdown.splitlines()
    images: list[dict[str, Any]] = []
    headings: list[str] = []
    image_tokens = len(re.findall(r"!\[[^\]]*\]\(", markdown))
    for index, line in enumerate(lines):
        heading = H2_LINE.match(line)
        if heading:
            headings.append(heading.group(1))
        match = IMAGE_LINE.match(line)
        if not match:
            continue
        cursor = index + 1
        while cursor < len(lines) and not lines[cursor].strip():
            cursor += 1
        caption = lines[cursor].strip() if cursor < len(lines) and lines[cursor].lstrip().startswith("▲") else ""
        images.append({"alt": match.group(1), "ref": match.group(2), "caption": caption, "line": index})
    if image_tokens != len(images):
        errors.append("every Markdown image must be a standalone image line with a simple package-relative path")
    return images, headings


def valid_waiver(section: dict[str, Any]) -> bool:
    waiver = section.get("waiver")
    return bool(
        isinstance(waiver, dict)
        and isinstance(waiver.get("reason"), str)
        and waiver.get("reason", "").strip()
        and isinstance(waiver.get("approved_by"), str)
        and waiver.get("approved_by", "").strip()
        and isinstance(waiver.get("approval_evidence"), str)
        and waiver.get("approval_evidence", "").strip()
    )


def validate_package(manifest_path: Path, target: str) -> dict[str, Any]:
    manifest_path = manifest_path.resolve()
    manifest = read_object(manifest_path)
    root = manifest_path.parent
    errors: list[str] = []
    warnings: list[str] = []
    article = object_value(manifest.get("article"), "article", errors)
    policy = object_value(manifest.get("policy"), "policy", errors)
    assets = list_value(manifest.get("assets"), "assets", errors)
    sections = list_value(manifest.get("sections"), "sections", errors)

    if manifest.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    for key in ("slug", "revision", "type", "category", "brand_profile", "visual_family", "markdown", "html"):
        if not isinstance(article.get(key), str) or not article.get(key, "").strip():
            errors.append(f"article.{key} must be a non-empty string")
    if article.get("brand_profile") != BRAND_PROFILE:
        errors.append(f"article.brand_profile must be {BRAND_PROFILE}")
    article_category = article.get("category")
    if article_category not in ARTICLE_CATEGORIES:
        errors.append(f"article.category must be one of: {', '.join(sorted(ARTICLE_CATEGORIES))}")
    article_type = article.get("type")
    type_minimum = ARTICLE_MIN_INLINE.get(article_type)
    if type_minimum is None:
        errors.append(f"article.type must be one of: {', '.join(sorted(ARTICLE_MIN_INLINE))}")
        type_minimum = 1
    configured_minimum = policy.get("min_inline_assets")
    if not isinstance(configured_minimum, int):
        errors.append("policy.min_inline_assets must be an integer")
        configured_minimum = type_minimum
    max_text_sections = policy.get("max_consecutive_text_only_sections")
    if max_text_sections != 1:
        errors.append("policy.max_consecutive_text_only_sections must be 1; use an approved waiver for exceptions")
        max_text_sections = 1

    markdown_path = safe_package_path(root, article.get("markdown"), "article.markdown", errors)
    html_path = safe_package_path(root, article.get("html"), "article.html", errors)
    markdown = markdown_path.read_text(encoding="utf-8") if markdown_path else ""
    html_text = html_path.read_text(encoding="utf-8") if html_path else ""
    if target == "jpage-preview" and html_path and html_path.stat().st_size > 45 * 1024 * 1024:
        errors.append("self-contained JPage HTML exceeds the 45 MiB safety limit")
    plain_markdown = re.sub(r"```.*?```", "", markdown, flags=re.DOTALL)
    plain_markdown = re.sub(r"https?://\S+|[\s#>*_`\[\]()!-]", "", plain_markdown)
    character_count = len(plain_markdown)
    length_minimum = (character_count + 999) // 1000 if character_count > 4000 else (3 if character_count >= 2500 else 1)
    effective_minimum = max(type_minimum, length_minimum)
    if configured_minimum < effective_minimum:
        errors.append(
            f"policy.min_inline_assets must be at least {effective_minimum} for {article_type} at {character_count} content characters"
        )
        configured_minimum = effective_minimum
    md_images, md_headings = markdown_images(markdown, errors)

    ids: set[str] = set()
    paths: set[str] = set()
    body_records: list[dict[str, Any]] = []
    cover_count = 0
    receipt_assets: list[dict[str, Any]] = []
    asset_by_id: dict[str, dict[str, Any]] = {}
    asset_by_ref: dict[str, dict[str, Any]] = {}

    for index, raw_asset in enumerate(assets):
        label = f"assets[{index}]"
        asset = object_value(raw_asset, label, errors)
        asset_id = asset.get("id")
        raw_path = asset.get("path")
        if not isinstance(asset_id, str) or not asset_id.strip():
            errors.append(f"{label}.id must be a non-empty string")
            continue
        if asset_id in ids:
            errors.append(f"duplicate asset id: {asset_id}")
        ids.add(asset_id)
        asset_by_id[asset_id] = asset
        if not isinstance(raw_path, str) or not raw_path.strip():
            errors.append(f"{label}.path must be a non-empty string")
            continue
        if raw_path in paths:
            errors.append(f"duplicate asset path: {raw_path}")
        paths.add(raw_path)
        asset_by_ref[str(asset.get("html_ref") or raw_path)] = asset

        role = asset.get("role")
        source_type = asset.get("source_type")
        if role not in ASSET_ROLES:
            errors.append(f"{label}.role is invalid: {role}")
        if source_type not in SOURCE_TYPES:
            errors.append(f"{label}.source_type is invalid: {source_type}")
        if not isinstance(asset.get("purpose"), str) or not asset.get("purpose", "").strip():
            errors.append(f"{label}.purpose must be non-empty")
        if asset.get("evidence") is True and source_type not in {"real_screenshot", "data_chart"}:
            errors.append(f"{asset_id}: evidence must be a real screenshot or data chart")
        if role == "evidence" and source_type not in {"real_screenshot", "data_chart"}:
            errors.append(f"{asset_id}: generated or illustrative assets cannot be evidence")

        extension_set = COVER_EXTENSIONS if role == "cover" else BODY_EXTENSIONS
        if Path(raw_path).suffix.lower() not in extension_set:
            errors.append(f"{asset_id}: unsupported {'cover' if role == 'cover' else 'body'} image extension")
        path = safe_package_path(root, raw_path, f"{label}.path", errors)
        if role == "cover":
            cover_count += 1
        elif role != "decorative" and asset.get("required") is True:
            body_records.append(asset)

        rights = object_value(asset.get("rights"), f"{label}.rights", errors)
        if rights.get("status") not in {"original", "licensed", "user-owned", "verified-public"}:
            errors.append(f"{asset_id}: rights.status is not cleared")
        if not isinstance(rights.get("source"), str) or not rights.get("source", "").strip():
            errors.append(f"{asset_id}: rights.source must be recorded")
        if asset.get("privacy_status") != "cleared":
            errors.append(f"{asset_id}: privacy_status must be cleared")

        review = object_value(asset.get("review"), f"{label}.review", errors)
        if review.get("status") != "approved":
            errors.append(f"{asset_id}: review.status must be approved")
        for field in ("reviewer", "reviewed_at", "sha256"):
            if not isinstance(review.get(field), str) or not review.get(field, "").strip():
                errors.append(f"{asset_id}: review.{field} must be recorded")
        for flag in sorted(HARD_REVIEW_FLAGS):
            if review.get(flag) is not True:
                errors.append(f"{asset_id}: review.{flag} must be true")
        scores = object_value(review.get("scores"), f"{label}.review.scores", errors)
        score_values: list[float] = []
        for field in sorted(SCORE_FIELDS):
            value = scores.get(field)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not 1 <= value <= 5:
                errors.append(f"{asset_id}: review.scores.{field} must be between 1 and 5")
            else:
                score_values.append(float(value))
                if value < 3:
                    errors.append(f"{asset_id}: review.scores.{field} is below 3")
        quality_average = sum(score_values) / len(score_values) if score_values else 0.0
        if quality_average < 4.0:
            errors.append(f"{asset_id}: average visual quality score must be at least 4.0")

        requirements = object_value(asset.get("requirements"), f"{label}.requirements", errors)
        min_width = requirements.get("min_width")
        min_height = requirements.get("min_height")
        aspect_min = requirements.get("aspect_min")
        aspect_max = requirements.get("aspect_max")
        floor_width = 1200 if role == "cover" else 720
        floor_height = 500 if role == "cover" else 360
        if not isinstance(min_width, int) or min_width < floor_width:
            errors.append(f"{asset_id}: requirements.min_width must be at least {floor_width}")
            min_width = floor_width
        if not isinstance(min_height, int) or min_height < floor_height:
            errors.append(f"{asset_id}: requirements.min_height must be at least {floor_height}")
            min_height = floor_height
        if not isinstance(aspect_min, (int, float)) or not isinstance(aspect_max, (int, float)) or aspect_min <= 0 or aspect_max <= aspect_min:
            errors.append(f"{asset_id}: invalid aspect range")
            aspect_min, aspect_max = 0.1, 10.0

        actual_sha = ""
        image_format = ""
        width = height = 0
        if path:
            try:
                image_format, width, height, data = inspect_image(path)
                actual_sha = sha256_bytes(data)
            except (OSError, ValueError, struct.error) as error:
                errors.append(f"{asset_id}: invalid image file: {error}")
            if actual_sha and review.get("sha256") != actual_sha:
                errors.append(f"{asset_id}: image SHA-256 changed after review")
            if width < min_width or height < min_height:
                errors.append(f"{asset_id}: image dimensions {width}x{height} are below {min_width}x{min_height}")
            if width and height:
                aspect = width / height
                if not aspect_min <= aspect <= aspect_max:
                    errors.append(f"{asset_id}: aspect ratio {aspect:.3f} is outside {aspect_min}..{aspect_max}")
        receipt_assets.append(
            {
                "id": asset_id,
                "path": raw_path,
                "sha256": actual_sha,
                "format": image_format,
                "width": width,
                "height": height,
                "quality_average": round(quality_average, 2),
            }
        )

        if role != "cover":
            if not isinstance(asset.get("alt"), str) or not asset.get("alt", "").strip():
                errors.append(f"{asset_id}: alt text is required")
            if not isinstance(asset.get("caption"), str) or not asset.get("caption", "").lstrip().startswith("▲"):
                errors.append(f"{asset_id}: caption must begin with ▲")

    if cover_count != 1:
        errors.append(f"exactly one cover is required; found {cover_count}")
    if len(body_records) < configured_minimum:
        errors.append(f"article requires at least {configured_minimum} required non-decorative body visuals; found {len(body_records)}")

    section_headings: list[str] = []
    consecutive_text = 0
    for index, raw_section in enumerate(sections):
        section = object_value(raw_section, f"sections[{index}]", errors)
        heading = section.get("heading")
        if not isinstance(heading, str) or not heading.strip():
            errors.append(f"sections[{index}].heading must be non-empty")
            continue
        section_headings.append(heading)
        decision = section.get("decision")
        asset_ids = section.get("asset_ids")
        if decision == "asset":
            consecutive_text = 0
            if not isinstance(asset_ids, list) or not asset_ids:
                errors.append(f"section {heading}: asset decision requires asset_ids")
            else:
                for asset_id in asset_ids:
                    if asset_id not in asset_by_id:
                        errors.append(f"section {heading}: unknown asset id {asset_id}")
        elif decision == "text":
            consecutive_text += 1
            if not isinstance(section.get("reason"), str) or not section.get("reason", "").strip():
                errors.append(f"section {heading}: text decision requires a reason")
            if consecutive_text > max_text_sections:
                if valid_waiver(section):
                    consecutive_text = 0
                else:
                    errors.append(f"section {heading}: consecutive text-only sections require an approved waiver")
        else:
            errors.append(f"section {heading}: decision must be asset or text")
    if section_headings != md_headings:
        errors.append("manifest sections must match Markdown H2 headings in order")

    expected_body = sorted(
        (asset for asset in assets if isinstance(asset, dict) and asset.get("role") not in {"cover", "decorative"}),
        key=lambda asset: object_value(asset.get("placement"), "asset.placement", errors).get("order", 0),
    )
    expected_refs = [str(asset.get("html_ref") or asset.get("path") or "") for asset in expected_body]
    md_refs = [item["ref"] for item in md_images]
    if md_refs != expected_refs:
        errors.append("Markdown image paths and order must match the visual manifest")
    for item, asset in zip(md_images, expected_body):
        asset_id = str(asset.get("id") or "asset")
        if item["alt"] != asset.get("alt"):
            errors.append(f"{asset_id}: Markdown alt text does not match the manifest")
        if item["caption"] != asset.get("caption"):
            errors.append(f"{asset_id}: Markdown caption does not match the manifest")

    if article_category == "architecture-map":
        if article_type != "architecture":
            errors.append("architecture-map category requires article.type architecture")
        overview_id = article.get("architecture_overview_asset_id")
        if not isinstance(overview_id, str) or not overview_id.strip():
            errors.append("architecture-map category requires article.architecture_overview_asset_id")
        elif not expected_body or expected_body[0].get("id") != overview_id:
            errors.append("architecture overview must be the first body asset")
        overview = asset_by_id.get(overview_id) if isinstance(overview_id, str) else None
        overview_regions: set[str] = set()
        if overview:
            if overview.get("role") != "architecture":
                errors.append("architecture overview asset must use role architecture")
            binding = object_value(overview.get("architecture_binding"), f"{overview_id}.architecture_binding", errors)
            regions = binding.get("region_ids")
            if binding.get("kind") != "overview":
                errors.append("architecture overview binding kind must be overview")
            if not isinstance(regions, list) or len(regions) < 2 or not all(isinstance(item, str) and item.strip() for item in regions):
                errors.append("architecture overview must declare at least two non-empty region_ids")
            else:
                overview_regions = set(regions)
                if len(overview_regions) != len(regions):
                    errors.append("architecture overview region_ids must be unique")
        detail_count = 0
        for asset in expected_body[1:]:
            if asset.get("role") not in {"architecture", "workflow"}:
                continue
            asset_id = str(asset.get("id") or "asset")
            binding = object_value(asset.get("architecture_binding"), f"{asset_id}.architecture_binding", errors)
            regions = binding.get("region_ids")
            if binding.get("kind") != "detail":
                errors.append(f"{asset_id}: architecture binding kind must be detail")
            if binding.get("overview_asset_id") != overview_id:
                errors.append(f"{asset_id}: architecture detail must bind to the declared overview")
            if binding.get("treatment") not in {"highlight", "zoom", "highlight-and-zoom"}:
                errors.append(f"{asset_id}: architecture detail treatment is invalid")
            if not isinstance(regions, list) or not regions or not all(isinstance(item, str) and item.strip() for item in regions):
                errors.append(f"{asset_id}: architecture detail requires non-empty region_ids")
            elif overview_regions and not set(regions).issubset(overview_regions):
                errors.append(f"{asset_id}: architecture detail region_ids must come from the overview")
            else:
                detail_count += 1
        if detail_count < 1:
            errors.append("architecture-map category requires at least one overview-bound detail visual")
        if not md_images:
            errors.append("architecture-map category requires the complete overview as the first Markdown image")
        else:
            first_image_line = int(md_images[0]["line"])
            prefix_lines = markdown.splitlines()[:first_image_line]
            if any(H2_LINE.match(line) for line in prefix_lines):
                errors.append("architecture overview must appear before the first H2 section")
            orientation_lines = [line for line in prefix_lines if not re.match(r"^\s*#\s+", line)]
            orientation = "\n".join(orientation_lines)
            orientation = re.sub(r"https?://\S+|[\s#>*_`\[\]()!-]", "", orientation)
            if len(orientation) > 300:
                errors.append("architecture opening orientation must stay within 300 content characters before the overview")

    parser = PreviewHTMLParser()
    try:
        parser.feed(html_text)
    except Exception as error:  # HTMLParser errors are uncommon but should fail closed.
        errors.append(f"cannot parse preview HTML: {error}")
    if parser.has_script:
        errors.append("preview HTML must not contain scripts")
    if len(parser.images) != len(expected_body):
        errors.append(f"preview HTML image count must be {len(expected_body)}; found {len(parser.images)}")
    for image, asset in zip(parser.images, expected_body):
        asset_id = str(asset.get("id") or "asset")
        ref = str(asset.get("html_ref") or asset.get("path") or "")
        if image.get("alt") != asset.get("alt"):
            errors.append(f"{asset_id}: preview HTML alt text does not match the manifest")
        src = image.get("src", "")
        if target == "local-render":
            if src != ref or image.get("data-local-image") != "true":
                errors.append(f"{asset_id}: local render must preserve the reviewed relative image reference")
        else:
            if image.get("data-local-image"):
                errors.append(f"{asset_id}: JPage preview contains an unresolved local image")
            if image.get("data-source-image") != ref or image.get("data-preview-embedded") != "true":
                errors.append(f"{asset_id}: JPage preview is missing its reviewed source-image binding")
            match = DATA_URI.match(src)
            if not match:
                errors.append(f"{asset_id}: JPage preview must embed the reviewed image as a data URI")
            else:
                try:
                    embedded = base64.b64decode(match.group(2), validate=True)
                except (binascii.Error, ValueError):
                    errors.append(f"{asset_id}: invalid embedded image data")
                else:
                    asset_path = safe_package_path(root, asset.get("path"), f"{asset_id}.path", errors)
                    if asset_path and sha256_bytes(embedded) != sha256_file(asset_path):
                        errors.append(f"{asset_id}: embedded preview image differs from the reviewed asset")
    if target == "jpage-preview" and ("[blocked image:" in html_text or 'data-local-image="true"' in html_text):
        errors.append("JPage preview contains a blocked or unresolved image")

    review = object_value(manifest.get("review"), "review", errors)
    if review.get("asset_gate") != "pass":
        errors.append("review.asset_gate must be pass")
    if review.get("integrated_render_gate") != "pass":
        errors.append("review.integrated_render_gate must be pass")
    for key in ("reviewer", "reviewed_at"):
        if not isinstance(review.get(key), str) or not review.get(key, "").strip():
            errors.append(f"review.{key} must be recorded")

    digests = {
        "manifest": sha256_file(manifest_path),
        "markdown": sha256_file(markdown_path) if markdown_path else "",
        "html": sha256_file(html_path) if html_path else "",
    }
    return {
        "schema_version": 1,
        "gate": "pass" if not errors else "fail",
        "target": target,
        "article_slug": article.get("slug", ""),
        "article_revision": article.get("revision", ""),
        "article_type": article.get("type", ""),
        "article_category": article.get("category", ""),
        "article_character_count": character_count,
        "validated_at": datetime.now(timezone.utc).isoformat(),
        "visual_gates": {
            "asset_gate": review.get("asset_gate", "fail"),
            "integrated_render_gate": review.get("integrated_render_gate", "fail"),
        },
        "digests": digests,
        "assets": receipt_assets,
        "errors": sorted(set(errors)),
        "warnings": sorted(set(warnings)),
    }


def main() -> int:
    args = parse_args()
    try:
        report = validate_package(args.manifest, args.target)
    except PackageError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    try:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OSError as error:
        print(f"error: cannot write report: {error}", file=sys.stderr)
        return 2
    if report["gate"] == "pass":
        print(f"PASS: visual package {report['article_revision']} ({args.target})")
        return 0
    print(f"FAIL: visual package has {len(report['errors'])} error(s); see {args.report}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
