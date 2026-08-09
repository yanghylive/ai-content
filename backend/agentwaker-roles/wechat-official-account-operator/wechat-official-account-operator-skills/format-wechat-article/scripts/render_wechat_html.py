#!/usr/bin/env python3
"""Render a conservative Markdown subset as inline-styled WeChat HTML."""

from __future__ import annotations

import argparse
import base64
import html
import mimetypes
import re
import sys
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit


THEMES = {
    "green-tech": {
        "accent": "#159A62",
        "accent_soft": "#DDF3E7",
        "text": "#101713",
        "muted": "#5B6B62",
        "border": "#CBD8D0",
        "code_bg": "#0B2A1F",
        "code_text": "#F7FAF8",
        "inline_bg": "#EFF8F3",
    },
    "teal": {
        "accent": "#0f766e",
        "accent_soft": "#ccfbf1",
        "text": "#24323d",
        "muted": "#64748b",
        "border": "#99f6e4",
        "code_bg": "#0f172a",
        "code_text": "#e2e8f0",
        "inline_bg": "#f0fdfa",
    },
    "indigo": {
        "accent": "#4f46e5",
        "accent_soft": "#e0e7ff",
        "text": "#27324a",
        "muted": "#64748b",
        "border": "#c7d2fe",
        "code_bg": "#111827",
        "code_text": "#e5e7eb",
        "inline_bg": "#eef2ff",
    },
    "graphite": {
        "accent": "#334155",
        "accent_soft": "#e2e8f0",
        "text": "#1f2937",
        "muted": "#6b7280",
        "border": "#cbd5e1",
        "code_bg": "#111827",
        "code_text": "#f3f4f6",
        "inline_bg": "#f1f5f9",
    },
    "navy-orange": {
        "accent": "#c2410c",
        "accent_soft": "#fff7ed",
        "text": "#07142b",
        "muted": "#64748b",
        "border": "#fdba74",
        "code_bg": "#07142b",
        "code_text": "#f8fafc",
        "inline_bg": "#fff7ed",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a conservative Markdown subset to inline-styled WeChat HTML."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--theme", choices=sorted(THEMES), default="green-tech")
    parser.add_argument("--standalone", action="store_true", help="Wrap the fragment as a preview document")
    parser.add_argument(
        "--embed-local-images",
        action="store_true",
        help="Embed package-local images as data URIs in a standalone JPage preview",
    )
    parser.add_argument("--title", default="WeChat article preview")
    return parser.parse_args()


def safe_url(raw: str, image: bool = False) -> tuple[str, bool]:
    value = html.unescape(raw.strip())
    parts = urlsplit(value)
    if parts.scheme in {"http", "https"}:
        return html.escape(value, quote=True), False
    if parts.scheme:
        return "", False
    if image and value:
        relative = Path(value)
        if not relative.is_absolute() and ".." not in relative.parts:
            return html.escape(value, quote=True), True
    return "", False


def inline_markup(
    text: str,
    theme: dict[str, str],
    image_resolver: Callable[[str], str | None] | None = None,
) -> str:
    tokens: list[str] = []

    def stash(value: str) -> str:
        token = f"@@WECHAT_TOKEN_{len(tokens)}@@"
        tokens.append(value)
        return token

    def code_repl(match: re.Match[str]) -> str:
        value = html.escape(match.group(1))
        style = (
            f"font-family:Menlo,Monaco,Consolas,monospace;font-size:0.88em;"
            f"color:{theme['accent']};background:{theme['inline_bg']};"
            "padding:2px 5px;border-radius:4px;word-break:break-word;"
        )
        return stash(f'<code style="{style}">{value}</code>')

    def image_repl(match: re.Match[str]) -> str:
        alt = html.escape(match.group(1), quote=True)
        raw_url = html.unescape(match.group(2).strip())
        url, local = safe_url(raw_url, image=True)
        if not url:
            return stash(f'<span style="color:#b91c1c;">[blocked image: {alt}]</span>')
        local_attr = ""
        if local and image_resolver is not None:
            embedded = image_resolver(raw_url)
            if not embedded:
                return stash(f'<span style="color:#b91c1c;">[blocked image: {alt}]</span>')
            url = html.escape(embedded, quote=True)
            source = html.escape(raw_url, quote=True)
            local_attr = f' data-preview-embedded="true" data-source-image="{source}"'
        elif local:
            local_attr = ' data-local-image="true"'
        image_html = (
            f'<img src="{url}" alt="{alt}"{local_attr} '
            'style="display:block;width:100%;max-width:100%;height:auto;margin:18px auto 8px;'
            'border-radius:8px;box-sizing:border-box;" />'
        )
        return stash(image_html)

    def link_repl(match: re.Match[str]) -> str:
        label = html.escape(match.group(1))
        url, _ = safe_url(match.group(2))
        if not url:
            return stash(label)
        return stash(
            f'<a href="{url}" style="color:{theme["accent"]};text-decoration:none;'
            f'border-bottom:1px solid {theme["border"]};">{label}</a>'
        )

    working = re.sub(r"`([^`\n]+)`", code_repl, text)
    working = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)\)", image_repl, working)
    working = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link_repl, working)
    escaped = html.escape(working)
    escaped = re.sub(r"\*\*([^*\n]+)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", escaped)
    for index, value in enumerate(tokens):
        escaped = escaped.replace(f"@@WECHAT_TOKEN_{index}@@", value)
    return escaped


def strip_frontmatter(lines: list[str]) -> list[str]:
    if not lines or lines[0].strip() != "---":
        return lines
    for index in range(1, min(len(lines), 200)):
        if lines[index].strip() == "---":
            return lines[index + 1 :]
    return lines


def starts_block(line: str) -> bool:
    stripped = line.lstrip()
    return bool(
        not stripped
        or stripped.startswith("```")
        or re.match(r"^#{1,4}\s+", stripped)
        or re.match(r"^([-*_])\1{2,}\s*$", stripped)
        or stripped.startswith(">")
        or re.match(r"^▲\s*\S", stripped)
        or re.match(r"^[-+*]\s+", stripped)
        or re.match(r"^\d+[.)]\s+", stripped)
    )


def render(
    markdown: str,
    theme_name: str,
    image_resolver: Callable[[str], str | None] | None = None,
) -> tuple[str, list[str]]:
    theme = THEMES[theme_name]
    lines = strip_frontmatter(markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n"))
    output: list[str] = []
    warnings: list[str] = []
    index = 0

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped:
            index += 1
            continue

        fence = re.match(r"^\s*```([^`]*)$", line)
        if fence:
            language = fence.group(1).strip()
            code: list[str] = []
            index += 1
            while index < len(lines) and not re.match(r"^\s*```\s*$", lines[index]):
                code.append(lines[index])
                index += 1
            if index >= len(lines):
                warnings.append("unclosed fenced code block")
            else:
                index += 1
            label = (
                f'<div style="font-size:11px;color:{theme["muted"]};margin:0 0 6px;">'
                f'{html.escape(language)}</div>'
                if language
                else ""
            )
            output.append(
                f'<section style="margin:20px 0;">{label}<pre style="margin:0;padding:16px;'
                f'background:{theme["code_bg"]};color:{theme["code_text"]};border-radius:10px;'
                'overflow-x:auto;white-space:pre;line-height:1.6;font-size:12px;box-sizing:border-box;">'
                f'<code style="font-family:Menlo,Monaco,Consolas,monospace;">{html.escape(chr(10).join(code))}</code>'
                "</pre></section>"
            )
            continue

        caption = re.match(r"^\s*(▲\s*\S.*?)\s*$", line)
        if caption:
            output.append(
                f'<p data-wechat-caption="true" style="margin:0 8px 24px;color:{theme["muted"]};'
                'font-size:12px;line-height:1.75;letter-spacing:0.02em;word-break:break-word;">'
                f'{inline_markup(caption.group(1), theme, image_resolver)}</p>'
            )
            index += 1
            continue

        heading = re.match(r"^\s*(#{1,4})\s+(.+?)\s*#*\s*$", line)
        if heading:
            level = len(heading.group(1))
            heading_text = heading.group(2)
            numbered = (
                re.match(r"^(\d{1,2})[.．]\s+(.+)$", heading_text)
                if level == 2 and theme_name in {"green-tech", "navy-orange"}
                else None
            )
            if numbered:
                output.append(
                    '<h2 data-wechat-heading="numbered" style="margin:34px 0 16px;line-height:1.35;'
                    f'color:{theme["text"]};font-weight:700;text-align:left;">'
                    f'<span style="font-size:34px;color:{theme["text"]};">{numbered.group(1)}</span>'
                    f'<span style="font-size:34px;color:{theme["accent"]};">.</span><br />'
                    f'<span style="font-size:20px;">{inline_markup(numbered.group(2), theme, image_resolver)}</span>'
                    '</h2>'
                )
                index += 1
                continue
            sizes = {1: "24px", 2: "20px", 3: "17px", 4: "15px"}
            margins = {1: "34px 0 18px", 2: "30px 0 14px", 3: "24px 0 10px", 4: "20px 0 8px"}
            border = f"border-left:4px solid {theme['accent']};padding-left:10px;" if level == 2 else ""
            output.append(
                f'<h{level} style="font-size:{sizes[level]};line-height:1.45;color:{theme["text"]};'
                f'font-weight:700;margin:{margins[level]};{border}">'
                f'{inline_markup(heading_text, theme, image_resolver)}</h{level}>'
            )
            index += 1
            continue

        if re.match(r"^\s*([-*_])\1{2,}\s*$", line):
            output.append(f'<hr style="border:0;border-top:1px solid {theme["border"]};margin:28px 0;" />')
            index += 1
            continue

        if line.lstrip().startswith(">"):
            quote: list[str] = []
            while index < len(lines) and lines[index].lstrip().startswith(">"):
                quote.append(re.sub(r"^\s*>\s?", "", lines[index]))
                index += 1
            output.append(
                f'<blockquote style="margin:18px 0;padding:14px 16px;border-left:4px solid {theme["accent"]};'
                f'background:{theme["accent_soft"]};color:{theme["text"]};border-radius:0 8px 8px 0;'
                'font-size:14px;line-height:1.8;">'
                f'{inline_markup(chr(10).join(quote), theme, image_resolver).replace(chr(10), "<br />")}</blockquote>'
            )
            continue

        unordered = re.match(r"^\s*[-+*]\s+(.+)$", line)
        ordered = re.match(r"^\s*\d+[.)]\s+(.+)$", line)
        if unordered or ordered:
            tag = "ul" if unordered else "ol"
            matcher: Callable[[str], re.Match[str] | None]
            if tag == "ul":
                matcher = lambda value: re.match(r"^\s*[-+*]\s+(.+)$", value)
            else:
                matcher = lambda value: re.match(r"^\s*\d+[.)]\s+(.+)$", value)
            items: list[str] = []
            while index < len(lines):
                match = matcher(lines[index])
                if not match:
                    break
                items.append(
                    f'<li style="margin:7px 0;padding-left:2px;">{inline_markup(match.group(1), theme, image_resolver)}</li>'
                )
                index += 1
            output.append(
                f'<{tag} style="margin:14px 0;padding-left:24px;color:{theme["text"]};'
                f'font-size:15px;line-height:1.8;">{"".join(items)}</{tag}>'
            )
            continue

        paragraph = [line.strip()]
        index += 1
        while index < len(lines) and lines[index].strip() and not starts_block(lines[index]):
            paragraph.append(lines[index].strip())
            index += 1
        if len(paragraph) >= 2 and all(part.count("|") >= 2 for part in paragraph[:2]):
            warnings.append("possible Markdown table rendered as a paragraph; convert it manually")
        output.append(
            f'<p style="margin:14px 0;color:{theme["text"]};font-size:15px;line-height:1.85;'
            'letter-spacing:0.01em;text-align:left;word-break:break-word;">'
            f'{inline_markup(chr(10).join(paragraph), theme, image_resolver).replace(chr(10), "<br />")}</p>'
        )

    fragment = (
        f'<section data-wechat-theme="{theme_name}" style="max-width:100%;margin:0 auto;'
        'padding:0 2px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'
        '\'Segoe UI\',\'PingFang SC\',\'Hiragino Sans GB\',\'Microsoft YaHei\',Arial,sans-serif;">'
        + "".join(output)
        + "</section>"
    )
    return fragment, warnings


def standalone(fragment: str, title: str) -> str:
    return (
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(title)}</title></head>"
        '<body style="margin:0;background:#f8fafc;padding:24px 14px;">'
        '<main style="max-width:677px;margin:0 auto;background:#fff;padding:24px 20px;'
        'box-shadow:0 8px 30px rgba(15,23,42,.08);box-sizing:border-box;">'
        f"{fragment}</main></body></html>"
    )


def local_image_resolver(base_dir: Path, warnings: list[str]) -> Callable[[str], str | None]:
    root = base_dir.resolve()
    allowed_mime = {
        ".bmp": "image/bmp",
        ".gif": "image/gif",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".png": "image/png",
    }

    def resolve(raw: str) -> str | None:
        relative = Path(raw)
        if relative.is_absolute() or ".." in relative.parts:
            warnings.append(f"unsafe local image path: {raw}")
            return None
        path = (root / relative).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            warnings.append(f"local image escapes article package: {raw}")
            return None
        if not path.is_file():
            warnings.append(f"local image not found: {raw}")
            return None
        mime = allowed_mime.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0]
        if mime not in allowed_mime.values():
            warnings.append(f"unsupported local image type: {raw}")
            return None
        try:
            data = path.read_bytes()
        except OSError as error:
            warnings.append(f"cannot read local image {raw}: {error}")
            return None
        if not data:
            warnings.append(f"local image is empty: {raw}")
            return None
        if len(data) > 12 * 1024 * 1024:
            warnings.append(f"local image exceeds 12 MiB preview limit: {raw}")
            return None
        encoded = base64.b64encode(data).decode("ascii")
        return f"data:{mime};base64,{encoded}"

    return resolve


def main() -> int:
    args = parse_args()
    if args.embed_local_images and not args.standalone:
        print("error: --embed-local-images requires --standalone", file=sys.stderr)
        return 2
    try:
        source = args.input.read_text(encoding="utf-8")
    except OSError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    warnings: list[str] = []
    resolver = local_image_resolver(args.input.parent, warnings) if args.embed_local_images else None
    fragment, render_warnings = render(source, args.theme, resolver)
    warnings.extend(render_warnings)
    result = standalone(fragment, args.title) if args.standalone else fragment
    try:
        args.output.write_text(result + "\n", encoding="utf-8")
    except OSError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    print(f"rendered: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
