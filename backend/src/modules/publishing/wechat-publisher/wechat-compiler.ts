import { marked } from 'marked';
import * as cheerio from 'cheerio';
import juice from 'juice';
import {
  WECHAT_DEFAULT_CSS,
  WECHAT_HEADER_HTML,
  WECHAT_FOOTER_HTML,
} from './wechat-style';

/**
 * 将 Markdown 转换为符合微信公众号要求的 HTML
 */
export class WechatCompiler {
  static async compile(markdown: string): Promise<string> {
    const rawHtml = await marked.parse(markdown);
    return this.sanitizeHtml(rawHtml);
  }

  static sanitizeHtml(rawHtml: string): string {
    const $ = cheerio.load(rawHtml);

    // Model-authored Markdown may contain raw HTML. Keep the preview and the
    // downstream WeChat payload passive before applying the trusted theme.
    $(
      'script, style, iframe, object, embed, form, input, button, textarea, select, option, link, meta, base, svg, math, template, video, audio, source, track, canvas',
    ).remove();
    $('*').each((_index, element) => {
      if (element.type !== 'tag') return;
      const attributes = { ...element.attribs };
      for (const [name, value] of Object.entries(attributes)) {
        const lowerName = name.toLowerCase();
        if (
          /^on/i.test(name) ||
          lowerName === 'style' ||
          [
            'srcset',
            'xlink:href',
            'formaction',
            'poster',
            'background',
          ].includes(lowerName)
        ) {
          $(element).removeAttr(name);
          continue;
        }
        if (lowerName !== 'href' && lowerName !== 'src') continue;
        const normalized = String(value || '')
          .trim()
          .toLowerCase();
        const allowed =
          normalized.startsWith('https://') ||
          normalized.startsWith('http://') ||
          normalized.startsWith('/') ||
          normalized.startsWith('#') ||
          (lowerName === 'src' &&
            /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(normalized));
        if (!allowed) $(element).removeAttr(name);
      }
    });

    $('.wechat-header, .wechat-footer').remove();

    if (WECHAT_HEADER_HTML) {
      $.root().prepend(WECHAT_HEADER_HTML);
    }
    if (WECHAT_FOOTER_HTML) {
      $.root().append(WECHAT_FOOTER_HTML);
    }

    $('div').each((_index, elem) => {
      if (elem.type === 'tag') {
        elem.tagName = 'section';
      }
    });

    const modifiedHtml = $.html();
    return juice.inlineContent(modifiedHtml, WECHAT_DEFAULT_CSS, {
      inlinePseudoElements: true,
      preserveImportant: true,
      insertPreservedExtraCss: false,
    });
  }

  static extractVisibleText(html: string): string {
    const $ = cheerio.load(html);
    $('script, style, template').remove();
    return $.root().text().replace(/\s+/g, ' ').trim();
  }
}
