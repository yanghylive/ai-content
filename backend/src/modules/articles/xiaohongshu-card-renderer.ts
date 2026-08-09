export type XiaohongshuSlideTemplate =
  | 'cover-poster'
  | 'insight-card'
  | 'bullet-list'
  | 'checklist-card'
  | 'summary-card';

export type XiaohongshuSlideRole =
  | 'cover'
  | 'hook'
  | 'problem'
  | 'solution'
  | 'method'
  | 'summary'
  | 'cta';

export type XiaohongshuRenderedSlideInput = {
  role: XiaohongshuSlideRole;
  template: XiaohongshuSlideTemplate;
  title: string;
  body: string;
  bullets: string[];
  highlight: string;
  imageType: 'real' | 'ai' | 'none';
  backgroundImageUrl: string | null;
  pageNumber: number;
  totalPages: number;
};

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1440;

type CardPalette = {
  background: string;
  accent: string;
  accentSoft: string;
  ink: string;
  muted: string;
  panel: string;
};

const TEMPLATE_PALETTES: Record<XiaohongshuSlideTemplate, CardPalette> = {
  'cover-poster': {
    background: '#fff7ef',
    accent: '#f97316',
    accentSoft: '#ffedd5',
    ink: '#1f2937',
    muted: '#6b7280',
    panel: '#fffdf8',
  },
  'insight-card': {
    background: '#fffaf6',
    accent: '#ef4444',
    accentSoft: '#ffe4e6',
    ink: '#172033',
    muted: '#667085',
    panel: '#fffefe',
  },
  'bullet-list': {
    background: '#f8fafc',
    accent: '#0f766e',
    accentSoft: '#ccfbf1',
    ink: '#102a43',
    muted: '#52606d',
    panel: '#ffffff',
  },
  'checklist-card': {
    background: '#fefce8',
    accent: '#ca8a04',
    accentSoft: '#fef3c7',
    ink: '#292524',
    muted: '#78716c',
    panel: '#fffef8',
  },
  'summary-card': {
    background: '#fdf2f8',
    accent: '#db2777',
    accentSoft: '#fce7f3',
    ink: '#3b0a45',
    muted: '#7c3a5a',
    panel: '#fffafc',
  },
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clampText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const chars = Array.from(normalized);
  if (chars.length <= maxChars) {
    return normalized;
  }

  return `${chars
    .slice(0, Math.max(1, maxChars - 1))
    .join('')
    .replace(/[.。…！!？?，,；;：: ]+$/g, '')}…`;
}

function measureCharWidth(char: string): number {
  if (/\s/.test(char)) return 0.35;
  if (/[A-Z0-9]/.test(char)) return 0.72;
  if (/[a-z]/.test(char)) return 0.62;
  if (/[.,!?;:，。！？；：]/.test(char)) return 0.48;
  return 1;
}

function wrapText(value: string, maxUnits: number, maxLines: number): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const lines: string[] = [];
  let currentLine = '';
  let currentUnits = 0;

  for (const char of Array.from(normalized)) {
    const nextUnits = currentUnits + measureCharWidth(char);
    if (currentLine && nextUnits > maxUnits) {
      lines.push(currentLine.trim());
      currentLine = char;
      currentUnits = measureCharWidth(char);
      if (lines.length === maxLines) {
        break;
      }
      continue;
    }

    currentLine += char;
    currentUnits = nextUnits;
  }

  if (lines.length < maxLines && currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  if (
    Array.from(normalized).length > Array.from(lines.join('')).length &&
    lines.length > 0
  ) {
    const tail = lines[maxLines - 1] || lines[lines.length - 1];
    const clipped = `${tail.replace(/[.。…！!？?，,；;：: ]+$/g, '')}…`;
    lines[Math.min(maxLines - 1, lines.length - 1)] = clipped;
  }

  return lines;
}

function renderTextBlock(
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  fontSize: number,
  color: string,
  weight = 700,
): string {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" fill="${color}" font-size="${fontSize}" font-weight="${weight}" font-family="'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif">${escapeXml(line)}</text>`,
    )
    .join('');
}

function renderBulletList(items: string[], palette: CardPalette): string {
  return items
    .slice(0, 4)
    .map((item, index) => {
      const y = 560 + index * 160;
      const lines = wrapText(clampText(item, 30), 13.2, 2);

      return `
<circle cx="140" cy="${y - 18}" r="26" fill="${palette.accentSoft}" />
<text x="140" y="${y - 9}" text-anchor="middle" fill="${palette.accent}" font-size="24" font-weight="900" font-family="'PingFang SC','Microsoft YaHei',sans-serif">${index + 1}</text>
${renderTextBlock(lines, 200, y, 52, 38, palette.ink, 800)}
`;
    })
    .join('');
}

function renderChecklist(items: string[], palette: CardPalette): string {
  return items
    .slice(0, 4)
    .map((item, index) => {
      const y = 560 + index * 160;
      const lines = wrapText(clampText(item, 28), 12.8, 2);

      return `
<rect x="104" y="${y - 52}" width="62" height="62" rx="20" fill="${palette.accent}" />
<path d="M124 ${y - 20} L137 ${y - 6} L157 ${y - 36}" stroke="#ffffff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
${renderTextBlock(lines, 210, y, 50, 37, palette.ink, 800)}
`;
    })
    .join('');
}

function renderFooter(
  input: XiaohongshuRenderedSlideInput,
  palette: CardPalette,
): string {
  return `
<text x="100" y="1320" fill="${palette.muted}" font-size="28" font-weight="700" font-family="'PingFang SC','Microsoft YaHei',sans-serif">${String(input.pageNumber).padStart(2, '0')} / ${String(input.totalPages).padStart(2, '0')}</text>
`;
}

function renderCoverPoster(
  input: XiaohongshuRenderedSlideInput,
  palette: CardPalette,
): string {
  const titleLines = wrapText(clampText(input.title, 22), 8.6, 3);
  const bodyLines = wrapText(clampText(input.body, 46), 13.5, 3);
  const highlight = clampText(input.highlight, 12);

  return `
<defs>
  <linearGradient id="coverGradient" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#fff6ea" />
    <stop offset="55%" stop-color="#fffdf8" />
    <stop offset="100%" stop-color="#ffe7d6" />
  </linearGradient>
</defs>
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#coverGradient)" rx="56" />
${input.backgroundImageUrl ? `<image href="${escapeXml(input.backgroundImageUrl)}" x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" preserveAspectRatio="xMidYMid slice" opacity="0.14" />` : ''}
<rect x="56" y="56" width="${CARD_WIDTH - 112}" height="${CARD_HEIGHT - 112}" rx="46" fill="#fffdfa" fill-opacity="0.90" />
<rect x="88" y="88" width="${CARD_WIDTH - 176}" height="${CARD_HEIGHT - 176}" rx="40" fill="#fffdf9" fill-opacity="0.86" stroke="#ffffff" stroke-width="2" />
<circle cx="908" cy="186" r="168" fill="${palette.accentSoft}" opacity="0.9" />
<circle cx="802" cy="266" r="96" fill="#ffffff" opacity="0.82" />
<circle cx="202" cy="1186" r="118" fill="${palette.accentSoft}" opacity="0.55" />
${
  highlight
    ? `<rect x="104" y="126" width="320" height="58" rx="29" fill="${palette.accent}" />
<text x="136" y="164" fill="#ffffff" font-size="28" font-weight="900" font-family="'PingFang SC','Microsoft YaHei',sans-serif">${escapeXml(highlight)}</text>`
    : ''
}
${renderTextBlock(titleLines, 104, 404, 102, 80, palette.ink, 900)}
<rect x="104" y="840" width="872" height="240" rx="34" fill="#fffaf4" stroke="${palette.accentSoft}" stroke-width="3" />
${renderTextBlock(bodyLines, 146, 918, 58, 38, palette.ink, 700)}
<path d="M104 768 C232 706, 338 726, 456 682" stroke="${palette.accent}" stroke-width="9" stroke-linecap="round" opacity="0.75" />
<circle cx="472" cy="676" r="10" fill="${palette.accent}" />
${renderFooter(input, palette)}
`;
}

function renderInsightCard(
  input: XiaohongshuRenderedSlideInput,
  palette: CardPalette,
): string {
  const titleLines = wrapText(clampText(input.title, 24), 11.8, 2);
  const bodyLines = wrapText(clampText(input.body, 88), 13.2, 5);
  const highlight = clampText(input.highlight, 20);

  return `
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${palette.background}" rx="56" />
<rect x="60" y="60" width="${CARD_WIDTH - 120}" height="${CARD_HEIGHT - 120}" rx="46" fill="${palette.panel}" />
<circle cx="906" cy="182" r="128" fill="${palette.accentSoft}" opacity="0.8" />
<circle cx="842" cy="266" r="54" fill="#ffffff" opacity="0.88" />
${renderTextBlock(titleLines, 100, 284, 80, 60, palette.ink, 900)}
<path d="M100 392 C188 420, 232 382, 306 404" stroke="${palette.accent}" stroke-width="8" stroke-linecap="round" opacity="0.8" />
<rect x="100" y="466" width="880" height="620" rx="40" fill="${palette.accentSoft}" fill-opacity="0.30" />
<rect x="132" y="506" width="816" height="540" rx="30" fill="#ffffff" fill-opacity="0.82" />
${renderTextBlock(bodyLines, 160, 612, 60, 38, palette.ink, 700)}
${highlight ? `<rect x="100" y="1128" width="520" height="88" rx="28" fill="${palette.accent}" /><text x="136" y="1185" fill="#ffffff" font-size="34" font-weight="900" font-family="'PingFang SC','Microsoft YaHei',sans-serif">${escapeXml(highlight)}</text>` : ''}
${renderFooter(input, palette)}
`;
}

function renderBulletListCard(
  input: XiaohongshuRenderedSlideInput,
  palette: CardPalette,
): string {
  const titleLines = wrapText(clampText(input.title, 24), 12.8, 2);
  const summaryLines = wrapText(clampText(input.body, 34), 14.5, 2);
  const highlight = clampText(input.highlight, 16);

  return `
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${palette.background}" rx="56" />
<rect x="66" y="66" width="${CARD_WIDTH - 132}" height="${CARD_HEIGHT - 132}" rx="46" fill="${palette.panel}" />
<circle cx="902" cy="186" r="112" fill="${palette.accentSoft}" opacity="0.72" />
${renderTextBlock(titleLines, 98, 286, 76, 58, palette.ink, 900)}
${renderTextBlock(summaryLines, 98, 404, 48, 32, palette.muted, 700)}
<rect x="92" y="470" width="896" height="636" rx="38" fill="#fdfefe" stroke="${palette.accentSoft}" stroke-width="3" />
${renderBulletList(input.bullets.length > 0 ? input.bullets : [input.body], palette)}
${highlight ? `<rect x="92" y="1140" width="440" height="82" rx="28" fill="${palette.accent}" /><text x="128" y="1193" fill="#ffffff" font-size="32" font-weight="900" font-family="'PingFang SC','Microsoft YaHei',sans-serif">${escapeXml(highlight)}</text>` : ''}
${renderFooter(input, palette)}
`;
}

function renderChecklistCard(
  input: XiaohongshuRenderedSlideInput,
  palette: CardPalette,
): string {
  const titleLines = wrapText(clampText(input.title, 24), 12.8, 2);
  const summaryLines = wrapText(clampText(input.body, 32), 13.8, 2);
  const highlight = clampText(input.highlight, 16);

  return `
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${palette.background}" rx="56" />
<rect x="66" y="66" width="${CARD_WIDTH - 132}" height="${CARD_HEIGHT - 132}" rx="46" fill="${palette.panel}" />
<rect x="92" y="118" width="180" height="14" rx="7" fill="${palette.accent}" opacity="0.88" />
${renderTextBlock(titleLines, 98, 292, 76, 58, palette.ink, 900)}
${renderTextBlock(summaryLines, 98, 408, 48, 32, palette.muted, 700)}
<rect x="92" y="470" width="896" height="636" rx="38" fill="#fffdf5" stroke="${palette.accentSoft}" stroke-width="3" />
${renderChecklist(input.bullets.length > 0 ? input.bullets : [input.body], palette)}
${highlight ? `<rect x="92" y="1142" width="420" height="82" rx="28" fill="${palette.accentSoft}" /><text x="126" y="1195" fill="${palette.accent}" font-size="32" font-weight="900" font-family="'PingFang SC','Microsoft YaHei',sans-serif">${escapeXml(highlight)}</text>` : ''}
${renderFooter(input, palette)}
`;
}

function renderSummaryCard(
  input: XiaohongshuRenderedSlideInput,
  palette: CardPalette,
): string {
  const titleLines = wrapText(clampText(input.title, 22), 11, 2);
  const bodyLines = wrapText(clampText(input.body, 72), 12.6, 4);
  const highlight = clampText(input.highlight, 18);

  return `
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${palette.background}" rx="56" />
<circle cx="872" cy="230" r="204" fill="${palette.accentSoft}" opacity="0.82" />
<rect x="66" y="66" width="${CARD_WIDTH - 132}" height="${CARD_HEIGHT - 132}" rx="46" fill="${palette.panel}" fill-opacity="0.94" />
${renderTextBlock(titleLines, 114, 334, 82, 64, palette.ink, 900)}
<rect x="96" y="468" width="888" height="524" rx="46" fill="${palette.accent}" fill-opacity="0.10" />
<rect x="136" y="516" width="808" height="428" rx="34" fill="#ffffff" fill-opacity="0.82" />
${renderTextBlock(bodyLines, 164, 624, 66, 42, palette.ink, 800)}
${highlight ? `<rect x="96" y="1060" width="888" height="116" rx="34" fill="${palette.accent}" /><text x="540" y="1135" text-anchor="middle" fill="#ffffff" font-size="40" font-weight="900" font-family="'PingFang SC','Microsoft YaHei',sans-serif">${escapeXml(highlight)}</text>` : ''}
${renderFooter(input, palette)}
`;
}

function renderTemplate(
  input: XiaohongshuRenderedSlideInput,
  palette: CardPalette,
): string {
  switch (input.template) {
    case 'cover-poster':
      return renderCoverPoster(input, palette);
    case 'bullet-list':
      return renderBulletListCard(input, palette);
    case 'checklist-card':
      return renderChecklistCard(input, palette);
    case 'summary-card':
      return renderSummaryCard(input, palette);
    case 'insight-card':
    default:
      return renderInsightCard(input, palette);
  }
}

export function renderXiaohongshuCardSvg(
  input: XiaohongshuRenderedSlideInput,
): string {
  const palette =
    TEMPLATE_PALETTES[input.template] || TEMPLATE_PALETTES['insight-card'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
${renderTemplate(input, palette)}
</svg>`;
}

export function renderXiaohongshuCardDataUrl(
  input: XiaohongshuRenderedSlideInput,
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderXiaohongshuCardSvg(input))}`;
}
