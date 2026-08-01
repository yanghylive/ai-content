import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { resolveProjectDataPath } from '../../common/project-paths';
import { resolveMediaToolPath } from '../runtime/platforms/video/media-tool-paths';
import type {
  VideoWorkshopClipSettings,
  VideoWorkshopFailureCode,
  VideoWorkshopTemplateClipInput,
} from './video-workshop.types';

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.avi',
  '.mkv',
  '.webm',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

type ResolvedMaterial = {
  path: string;
  kind: 'video' | 'image';
};

type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  timedOut: boolean;
  errorCode?: string;
};

const DEFAULT_CLIP_SETTINGS: Required<VideoWorkshopClipSettings> = {
  musicPreset: '轻快节奏',
  titleStyle: '标题：简洁加粗',
  subtitleStyle: '字幕：白字黑边',
  fontPreset: '系统黑体',
  filterPreset: '自然清晰',
  transitionPreset: '自然切换',
  aspectRatio: '9:16 竖版',
};

const TEMPLATE_CLIP_SETTINGS: Record<
  string,
  Required<VideoWorkshopClipSettings>
> = {
  产品卖点模板: DEFAULT_CLIP_SETTINGS,
  门店探店模板: {
    musicPreset: '轻快节奏',
    titleStyle: '标题：高亮重点',
    subtitleStyle: '字幕：简洁留白',
    fontPreset: '圆体',
    filterPreset: '暖调生活',
    transitionPreset: '自然切换',
    aspectRatio: '9:16 竖版',
  },
  客户案例模板: {
    musicPreset: '温和叙述',
    titleStyle: '标题：知识卡片',
    subtitleStyle: '字幕：简洁留白',
    fontPreset: '系统黑体',
    filterPreset: '冷调质感',
    transitionPreset: '淡入淡出',
    aspectRatio: '16:9 横版',
  },
  知识口播模板: {
    musicPreset: '氛围留白',
    titleStyle: '标题：简洁加粗',
    subtitleStyle: '字幕：白字黑边',
    fontPreset: '宋体',
    filterPreset: '自然清晰',
    transitionPreset: '不使用转场',
    aspectRatio: '1:1 方形',
  },
};

export interface VideoWorkshopRenderOptions {
  taskId: string;
  signal: AbortSignal;
  onProgress: (progress: number, stage: string) => Promise<void> | void;
}

export interface VideoWorkshopRenderResult {
  outputPath: string;
  args: string[];
  settings: VideoWorkshopClipSettings;
  unsupportedSettings: string[];
}

export class VideoWorkshopRenderCancelledError extends Error {
  constructor() {
    super('视频任务已取消');
    this.name = 'VideoWorkshopRenderCancelledError';
  }
}

export class VideoWorkshopRenderError extends Error {
  constructor(
    readonly reasonCode: Exclude<VideoWorkshopFailureCode, 'cancelled'>,
    message: string,
    readonly technicalDetail?: string,
  ) {
    super(message);
    this.name = 'VideoWorkshopRenderError';
  }
}

function clipSetting(
  value: string | undefined,
  values: readonly string[],
  fallback: string,
  label: string,
) {
  const selected = value?.trim();
  if (!selected) return fallback;
  if (values.includes(selected)) return selected;
  throw new VideoWorkshopRenderError(
    'invalid_input',
    `${label}不受支持，请重新选择`,
  );
}

export function resolveVideoWorkshopClipSettings(
  settings: VideoWorkshopClipSettings | undefined,
  templateName?: string,
): Required<VideoWorkshopClipSettings> {
  const defaults =
    TEMPLATE_CLIP_SETTINGS[templateName?.trim() || ''] || DEFAULT_CLIP_SETTINGS;
  return {
    musicPreset: clipSetting(
      settings?.musicPreset,
      ['轻快节奏', '温和叙述', '氛围留白', '不使用音乐'],
      defaults.musicPreset,
      '背景音乐',
    ),
    titleStyle: clipSetting(
      settings?.titleStyle,
      ['标题：简洁加粗', '标题：高亮重点', '标题：知识卡片', '不加标题'],
      defaults.titleStyle,
      '标题样式',
    ),
    subtitleStyle: clipSetting(
      settings?.subtitleStyle,
      ['字幕：白字黑边', '字幕：重点高亮', '字幕：简洁留白', '不加字幕'],
      defaults.subtitleStyle,
      '字幕样式',
    ),
    fontPreset: clipSetting(
      settings?.fontPreset,
      ['系统黑体', '圆体', '宋体'],
      defaults.fontPreset,
      '文字字体',
    ),
    filterPreset: clipSetting(
      settings?.filterPreset,
      ['自然清晰', '暖调生活', '冷调质感', '不使用滤镜'],
      defaults.filterPreset,
      '滤镜',
    ),
    transitionPreset: clipSetting(
      settings?.transitionPreset,
      ['自然切换', '节奏快切', '淡入淡出', '不使用转场'],
      defaults.transitionPreset,
      '转场',
    ),
    aspectRatio: clipSetting(
      settings?.aspectRatio,
      ['9:16 竖版', '16:9 横版', '1:1 方形'],
      defaults.aspectRatio,
      '画幅比例',
    ),
  };
}

@Injectable()
export class VideoWorkshopRenderer {
  async render(
    input: VideoWorkshopTemplateClipInput,
    options: VideoWorkshopRenderOptions,
  ): Promise<VideoWorkshopRenderResult> {
    if (options.signal.aborted) throw new VideoWorkshopRenderCancelledError();
    const materialPath = this.readText(input.materialPath);
    if (!materialPath) {
      throw new VideoWorkshopRenderError('invalid_input', '请选择要剪辑的素材');
    }
    const material = this.resolveMaterial(materialPath);
    if (!material) {
      throw new VideoWorkshopRenderError(
        'missing_asset',
        '找不到可用素材，请重新选择后再试',
      );
    }

    await options.onProgress(3, '正在检查剪辑环境');
    const health = await this.runProcess(
      resolveMediaToolPath('ffmpeg'),
      ['-hide_banner', '-version'],
      4000,
      options.signal,
    );
    this.throwForProcessFailure(
      health,
      'runtime_unavailable',
      '当前设备暂时无法剪辑视频',
    );

    const settings = resolveVideoWorkshopClipSettings(
      input.settings,
      input.templateName,
    );
    const durationSeconds = this.readDurationSeconds(input.durationSeconds);
    const source =
      input.source === 'ai-employee' ? 'ai-employee' : 'video-workshop';
    const outputDir = resolve(
      this.readText(input.outputDir) ||
        resolveProjectDataPath(
          'video-workshop',
          source === 'ai-employee' ? 'ai-employee' : 'workbench',
        ),
    );
    await mkdir(outputDir, { recursive: true });
    const outputPath = this.uniqueOutputPath(
      outputDir,
      this.normalizeOutputName(
        this.readText(input.outputName) ||
          `${this.readText(input.templateName) || 'video-workshop'}-${Date.now()}.mp4`,
      ),
    );
    const partialPath = join(
      dirname(outputPath),
      `.${basename(outputPath)}.${options.taskId}.partial.mp4`,
    );
    const taskDir = resolveProjectDataPath(
      'video-workshop',
      'task-work',
      options.taskId,
    );
    await mkdir(taskDir, { recursive: true });

    const titleText = this.wrapOverlayText(
      this.readText(input.titleText) ||
        this.readText(input.productName) ||
        basename(outputPath, '.mp4'),
      18,
      2,
    );
    const subtitleText = this.wrapOverlayText(
      this.readText(input.subtitleText) || this.readText(input.titlePrompt),
      24,
      4,
    );
    const titleTextPath = join(taskDir, 'title.txt');
    const subtitleTextPath = join(taskDir, 'subtitle.txt');
    await writeFile(titleTextPath, titleText, 'utf8');
    await writeFile(subtitleTextPath, subtitleText, 'utf8');

    const hasAudio =
      material.kind === 'video'
        ? await this.probeHasAudio(material.path, options.signal)
        : false;
    const drawtextSupported =
      settings.titleStyle === '不加标题' &&
      settings.subtitleStyle === '不加字幕'
        ? false
        : await this.supportsDrawtext(options.signal);
    const unsupportedSettings: string[] = [];
    let titleOverlayPath = '';
    let subtitleOverlayPath = '';
    if (!drawtextSupported && settings.titleStyle !== '不加标题') {
      titleOverlayPath = join(taskDir, 'title-overlay.png');
      try {
        await this.writeTextOverlay(
          titleOverlayPath,
          titleText,
          settings,
          'title',
        );
      } catch (error) {
        throw new VideoWorkshopRenderError(
          'runtime_unavailable',
          '当前设备无法应用所选标题样式',
          error instanceof Error ? error.message : undefined,
        );
      }
    }
    if (!drawtextSupported && settings.subtitleStyle !== '不加字幕') {
      subtitleOverlayPath = join(taskDir, 'subtitle-overlay.png');
      try {
        await this.writeTextOverlay(
          subtitleOverlayPath,
          subtitleText,
          settings,
          'subtitle',
        );
      } catch (error) {
        throw new VideoWorkshopRenderError(
          'runtime_unavailable',
          '当前设备无法应用所选字幕样式',
          error instanceof Error ? error.message : undefined,
        );
      }
    }

    const args = this.buildFfmpegArgs({
      material,
      outputPath: partialPath,
      durationSeconds,
      settings,
      titleTextPath,
      subtitleTextPath,
      hasAudio,
      drawtextSupported,
      titleOverlayPath,
      subtitleOverlayPath,
    });

    await options.onProgress(8, '正在准备画面和声音');
    let lastProgress = 8;
    const rendered = await this.runProcess(
      resolveMediaToolPath('ffmpeg'),
      args,
      10 * 60 * 1000,
      options.signal,
      (stdout) => {
        const seconds = this.readProgressSeconds(stdout);
        if (seconds === null) return;
        const progress = Math.min(
          96,
          Math.max(8, Math.round(8 + (seconds / durationSeconds) * 88)),
        );
        if (progress <= lastProgress) return;
        lastProgress = progress;
        void options.onProgress(progress, '正在合成视频');
      },
    );

    try {
      this.throwForProcessFailure(
        rendered,
        this.processFailureCode(rendered),
        '视频处理未完成，请检查素材后重试',
      );
      if (!existsSync(partialPath)) {
        throw new VideoWorkshopRenderError(
          'processing_failure',
          '视频处理未生成成片文件，请重试',
        );
      }
      await rename(partialPath, outputPath);
      await options.onProgress(99, '正在完成成片');
      return { outputPath, args, settings, unsupportedSettings };
    } finally {
      await rm(partialPath, { force: true }).catch(() => undefined);
      await rm(taskDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  buildFfmpegArgs(input: {
    material: ResolvedMaterial;
    outputPath: string;
    durationSeconds: number;
    settings: VideoWorkshopClipSettings;
    titleTextPath: string;
    subtitleTextPath: string;
    hasAudio: boolean;
    drawtextSupported: boolean;
    titleOverlayPath?: string;
    subtitleOverlayPath?: string;
  }) {
    const duration = String(input.durationSeconds);
    const args = ['-y', '-hide_banner'];
    if (input.material.kind === 'image') {
      args.push('-loop', '1', '-framerate', '30');
    }
    args.push('-i', input.material.path);

    let nextInputIndex = 1;
    let titleOverlayIndex: number | null = null;
    let subtitleOverlayIndex: number | null = null;
    if (input.titleOverlayPath) {
      titleOverlayIndex = nextInputIndex;
      nextInputIndex += 1;
      args.push('-loop', '1', '-framerate', '30', '-i', input.titleOverlayPath);
    }
    if (input.subtitleOverlayPath) {
      subtitleOverlayIndex = nextInputIndex;
      nextInputIndex += 1;
      args.push(
        '-loop',
        '1',
        '-framerate',
        '30',
        '-i',
        input.subtitleOverlayPath,
      );
    }
    const musicSource = this.musicSource(input.settings.musicPreset);
    const musicInputIndex = musicSource ? nextInputIndex : null;
    if (musicSource) {
      args.push('-f', 'lavfi', '-t', duration, '-i', musicSource);
    }

    const videoFilters = [
      'setpts=PTS-STARTPTS',
      ...this.aspectRatioFilters(input.settings.aspectRatio),
      ...this.visualPresetFilters(input.settings.filterPreset),
      ...this.transitionFilters(
        input.settings.transitionPreset,
        input.durationSeconds,
      ),
    ];
    if (input.drawtextSupported && input.settings.titleStyle !== '不加标题') {
      videoFilters.push(
        this.titleFilter(
          input.settings.titleStyle,
          input.settings.fontPreset,
          input.titleTextPath,
        ),
      );
    }
    if (
      input.drawtextSupported &&
      input.settings.subtitleStyle !== '不加字幕'
    ) {
      videoFilters.push(
        this.subtitleFilter(
          input.settings.subtitleStyle,
          input.settings.fontPreset,
          input.subtitleTextPath,
        ),
      );
    }

    const filterGraph = [`[0:v]${videoFilters.join(',')}[vbase]`];
    let currentVideoLabel = 'vbase';
    if (titleOverlayIndex !== null) {
      filterGraph.push(
        `[${titleOverlayIndex}:v]format=rgba[titlelayer]`,
        `[${currentVideoLabel}][titlelayer]overlay=x=(W-w)/2:y=H*0.08:eof_action=repeat:enable='between(t,0,4)'[vtitle]`,
      );
      currentVideoLabel = 'vtitle';
    }
    if (subtitleOverlayIndex !== null) {
      filterGraph.push(
        `[${subtitleOverlayIndex}:v]format=rgba[subtitlelayer]`,
        `[${currentVideoLabel}][subtitlelayer]overlay=x=(W-w)/2:y=H-h-H*0.06:eof_action=repeat[vsubtitle]`,
      );
      currentVideoLabel = 'vsubtitle';
    }
    filterGraph.push(`[${currentVideoLabel}]null[vout]`);
    let audioMap: string[] = [];
    if (musicSource && musicInputIndex !== null) {
      filterGraph.push(
        `[${musicInputIndex}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.4,afade=t=out:st=${Math.max(0, input.durationSeconds - 0.8).toFixed(2)}:d=0.8,volume=0.42[music]`,
      );
      if (input.hasAudio) {
        filterGraph.push(
          `[0:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=1[sourceaudio]`,
          '[sourceaudio][music]amix=inputs=2:duration=first:dropout_transition=2[aout]',
        );
        audioMap = ['-map', '[aout]'];
      } else {
        audioMap = ['-map', '[music]'];
      }
    } else if (input.hasAudio) {
      audioMap = ['-map', '0:a:0'];
    }

    args.push(
      '-t',
      duration,
      '-filter_complex',
      filterGraph.join(';'),
      '-map',
      '[vout]',
      ...audioMap,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
    );
    if (audioMap.length) args.push('-c:a', 'aac', '-b:a', '160k');
    args.push(
      '-movflags',
      '+faststart',
      '-shortest',
      '-progress',
      'pipe:1',
      '-nostats',
      input.outputPath,
    );
    return args;
  }

  private aspectRatioFilters(value: string | undefined) {
    if (value?.startsWith('16:9')) {
      return [
        'scale=1920:1080:force_original_aspect_ratio=increase',
        'crop=1920:1080',
      ];
    }
    if (value?.startsWith('1:1')) {
      return [
        'scale=1080:1080:force_original_aspect_ratio=increase',
        'crop=1080:1080',
      ];
    }
    return [
      'scale=1080:1920:force_original_aspect_ratio=increase',
      'crop=1080:1920',
    ];
  }

  private visualPresetFilters(value: string | undefined) {
    switch (value) {
      case '暖调生活':
        return ['eq=contrast=1.02:saturation=1.08:gamma_r=1.04:gamma_b=0.97'];
      case '冷调质感':
        return ['eq=contrast=1.06:saturation=0.92:gamma_r=0.96:gamma_b=1.05'];
      case '不使用滤镜':
        return [];
      default:
        return ['eq=contrast=1.03:saturation=1.05'];
    }
  }

  private transitionFilters(value: string | undefined, duration: number) {
    if (value === '不使用转场') return [];
    const fadeDuration =
      value === '淡入淡出' ? 0.65 : value === '节奏快切' ? 0.08 : 0.25;
    const fadeOutStart = Math.max(0, duration - fadeDuration);
    return [
      `fade=t=in:st=0:d=${fadeDuration}`,
      `fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeDuration}`,
    ];
  }

  private musicSource(value: string | undefined) {
    switch (value) {
      case '不使用音乐':
        return '';
      case '温和叙述':
        return 'aevalsrc=exprs=0.025*(sin(2*PI*196*t)+0.6*sin(2*PI*246.94*t)+0.45*sin(2*PI*293.66*t)):s=44100';
      case '氛围留白':
        return 'aevalsrc=exprs=0.018*(sin(2*PI*130.81*t)+0.55*sin(2*PI*196*t)):s=44100';
      default:
        return 'aevalsrc=exprs=0.022*(sin(2*PI*261.63*t)+0.65*sin(2*PI*329.63*t)+0.5*sin(2*PI*392*t))*(0.72+0.28*sin(2*PI*2*t)):s=44100';
    }
  }

  private titleFilter(
    style: string | undefined,
    font: string | undefined,
    path: string,
  ) {
    const common = [
      `textfile='${this.escapeFilterPath(path)}'`,
      'expansion=none',
      this.fontFilter(font),
      'fontsize=72',
      'x=(w-text_w)/2',
      'y=h*0.10',
      "enable='between(t,0,4)'",
    ];
    if (style === '标题：高亮重点') {
      common.push(
        'fontcolor=black',
        'box=1',
        'boxcolor=yellow@0.88',
        'boxborderw=20',
      );
    } else if (style === '标题：知识卡片') {
      common.push(
        'fontcolor=white',
        'box=1',
        'boxcolor=black@0.68',
        'boxborderw=20',
      );
    } else {
      common.push('fontcolor=white', 'borderw=4', 'bordercolor=black@0.78');
    }
    return `drawtext=${common.join(':')}`;
  }

  private subtitleFilter(
    style: string | undefined,
    font: string | undefined,
    path: string,
  ) {
    const common = [
      `textfile='${this.escapeFilterPath(path)}'`,
      'expansion=none',
      this.fontFilter(font),
      'fontsize=46',
      'x=(w-text_w)/2',
      'y=h-text_h-h*0.09',
    ];
    if (style === '字幕：重点高亮') {
      common.push(
        'fontcolor=yellow',
        'box=1',
        'boxcolor=black@0.72',
        'boxborderw=12',
      );
    } else if (style === '字幕：简洁留白') {
      common.push(
        'fontcolor=white',
        'box=1',
        'boxcolor=black@0.42',
        'boxborderw=10',
      );
    } else {
      common.push('fontcolor=white', 'borderw=3', 'bordercolor=black@0.9');
    }
    return `drawtext=${common.join(':')}`;
  }

  private async writeTextOverlay(
    path: string,
    text: string,
    settings: VideoWorkshopClipSettings,
    kind: 'title' | 'subtitle',
  ) {
    const landscape = settings.aspectRatio?.startsWith('16:9');
    const width = landscape ? 1920 : 1080;
    const height = kind === 'title' ? (landscape ? 230 : 260) : 330;
    const fontSize = kind === 'title' ? (landscape ? 80 : 68) : 44;
    const lines = text.split('\n').filter(Boolean);
    const lineHeight = Math.round(fontSize * 1.28);
    const totalHeight = Math.max(lineHeight, lines.length * lineHeight);
    const startY = Math.round((height - totalHeight) / 2 + fontSize);
    const family = this.svgFontFamily(settings.fontPreset);

    let box = '';
    let fill = '#ffffff';
    const stroke = '#111827';
    let strokeWidth = kind === 'title' ? 8 : 6;
    const style =
      kind === 'title' ? settings.titleStyle : settings.subtitleStyle;
    if (style === '标题：高亮重点') {
      box = `<rect x="${Math.round(width * 0.09)}" y="18" width="${Math.round(width * 0.82)}" height="${height - 36}" rx="8" fill="#fde047" fill-opacity="0.92"/>`;
      fill = '#111827';
      strokeWidth = 0;
    } else if (style === '标题：知识卡片') {
      box = `<rect x="${Math.round(width * 0.08)}" y="16" width="${Math.round(width * 0.84)}" height="${height - 32}" rx="8" fill="#111827" fill-opacity="0.76"/>`;
      strokeWidth = 0;
    } else if (style === '字幕：重点高亮') {
      box = `<rect x="${Math.round(width * 0.06)}" y="12" width="${Math.round(width * 0.88)}" height="${height - 24}" rx="8" fill="#111827" fill-opacity="0.78"/>`;
      fill = '#fde047';
      strokeWidth = 0;
    } else if (style === '字幕：简洁留白') {
      box = `<rect x="${Math.round(width * 0.06)}" y="12" width="${Math.round(width * 0.88)}" height="${height - 24}" rx="8" fill="#111827" fill-opacity="0.48"/>`;
      strokeWidth = 0;
    }

    const textNodes = lines
      .map(
        (line, index) =>
          `<text x="50%" y="${startY + index * lineHeight}" text-anchor="middle" font-family="${family}" font-size="${fontSize}" font-weight="700" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill" stroke-linejoin="round">${this.escapeXml(line)}</text>`,
      )
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="none"/>${box}${textNodes}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path);
  }

  private svgFontFamily(preset: string | undefined) {
    if (preset === '圆体') {
      return "'Yuanti SC','YouYuan','Noto Sans CJK SC',sans-serif";
    }
    if (preset === '宋体') {
      return "'Songti SC','SimSun','Noto Serif CJK SC',serif";
    }
    return "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif";
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private fontFilter(preset: string | undefined) {
    const candidates: Record<string, string[]> = {
      系统黑体: [
        '/System/Library/Fonts/PingFang.ttc',
        'C:\\Windows\\Fonts\\msyh.ttc',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      ],
      圆体: [
        '/System/Library/Fonts/Supplemental/Yuanti.ttc',
        'C:\\Windows\\Fonts\\simhei.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      ],
      宋体: [
        '/System/Library/Fonts/Supplemental/Songti.ttc',
        'C:\\Windows\\Fonts\\simsun.ttc',
        '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
      ],
    };
    const path = (
      candidates[preset || '系统黑体'] || candidates['系统黑体']
    ).find((candidate) => existsSync(candidate));
    return path
      ? `fontfile='${this.escapeFilterPath(path)}'`
      : "font='sans-serif'";
  }

  private resolveMaterial(value: string): ResolvedMaterial | null {
    if (!value.trim()) return null;
    const path = resolve(value);
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    if (stat.isFile()) return this.classifyMaterial(path);
    if (!stat.isDirectory()) return null;
    const children = readdirSync(path)
      .map((name) => join(path, name))
      .filter((child) => existsSync(child) && statSync(child).isFile())
      .sort((left, right) => basename(left).localeCompare(basename(right)));
    for (const child of children) {
      const material = this.classifyMaterial(child);
      if (material) return material;
    }
    return null;
  }

  private classifyMaterial(path: string): ResolvedMaterial | null {
    const extension = extname(path).toLowerCase();
    if (VIDEO_EXTENSIONS.has(extension)) return { path, kind: 'video' };
    if (IMAGE_EXTENSIONS.has(extension)) return { path, kind: 'image' };
    return null;
  }

  private async supportsDrawtext(signal: AbortSignal) {
    const result = await this.runProcess(
      resolveMediaToolPath('ffmpeg'),
      ['-hide_banner', '-h', 'filter=drawtext'],
      5000,
      signal,
    );
    if (result.cancelled) throw new VideoWorkshopRenderCancelledError();
    const output = `${result.stdout}\n${result.stderr}`;
    return (
      result.exitCode === 0 &&
      /Filter drawtext/i.test(output) &&
      !/Unknown filter/i.test(output)
    );
  }

  private async probeHasAudio(path: string, signal: AbortSignal) {
    const result = await this.runProcess(
      resolveMediaToolPath('ffprobe'),
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        path,
      ],
      5000,
      signal,
    );
    if (result.cancelled) throw new VideoWorkshopRenderCancelledError();
    return result.exitCode === 0 && Boolean(result.stdout.trim());
  }

  private runProcess(
    command: string,
    args: string[],
    timeoutMs: number,
    signal: AbortSignal,
    onStdout?: (stdout: string) => void,
  ): Promise<ProcessResult> {
    return new Promise((resolveProcess) => {
      if (signal.aborted) {
        resolveProcess({
          exitCode: null,
          stdout: '',
          stderr: '',
          cancelled: true,
          timedOut: false,
        });
        return;
      }
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let cancelled = false;
      let timedOut = false;
      let forceKill: ReturnType<typeof setTimeout> | undefined;

      const stop = (reason: 'cancelled' | 'timeout') => {
        if (settled) return;
        cancelled = reason === 'cancelled';
        timedOut = reason === 'timeout';
        child.kill('SIGTERM');
        forceKill = setTimeout(() => child.kill('SIGKILL'), 1500);
      };
      const abort = () => stop('cancelled');
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => stop('timeout'), timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = this.appendChunk(stdout, chunk);
        onStdout?.(stdout);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = this.appendChunk(stderr, chunk);
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceKill) clearTimeout(forceKill);
        signal.removeEventListener('abort', abort);
        resolveProcess({
          exitCode: 1,
          stdout,
          stderr: this.appendText(stderr, error.message),
          cancelled,
          timedOut,
          errorCode: (error as NodeJS.ErrnoException).code,
        });
      });
      child.on('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceKill) clearTimeout(forceKill);
        signal.removeEventListener('abort', abort);
        resolveProcess({ exitCode, stdout, stderr, cancelled, timedOut });
      });
    });
  }

  private throwForProcessFailure(
    result: ProcessResult,
    reasonCode: Exclude<VideoWorkshopFailureCode, 'cancelled'>,
    message: string,
  ) {
    if (result.cancelled) throw new VideoWorkshopRenderCancelledError();
    if (result.exitCode === 0 && !result.timedOut) return;
    const detail = this.truncate(
      result.timedOut
        ? `${result.stderr}\nprocess timed out`
        : result.stderr || result.stdout,
    );
    throw new VideoWorkshopRenderError(
      reasonCode,
      message,
      detail || undefined,
    );
  }

  private processFailureCode(
    result: ProcessResult,
  ): Exclude<VideoWorkshopFailureCode, 'cancelled'> {
    const detail = `${result.errorCode || ''}\n${result.stderr}\n${result.stdout}`;
    if (
      /ENOENT|Unknown encoder|Encoder .* not found|No such filter|Error initializing output stream/i.test(
        detail,
      )
    ) {
      return 'runtime_unavailable';
    }
    if (
      /No such file|Permission denied|Invalid data found|moov atom not found|could not find codec parameters/i.test(
        detail,
      )
    ) {
      return 'missing_asset';
    }
    return 'processing_failure';
  }

  private readProgressSeconds(stdout: string) {
    const matches = Array.from(
      stdout.matchAll(/out_time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g),
    );
    const match = matches[matches.length - 1];
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  private wrapOverlayText(value: string, width: number, maxLines: number) {
    const cleaned = value.replace(/\0/g, '').replace(/\r/g, '').trim();
    if (!cleaned) return '';
    const characters = Array.from(cleaned.replace(/\s*\n\s*/g, ' '));
    const lines: string[] = [];
    for (
      let index = 0;
      index < characters.length && lines.length < maxLines;
      index += width
    ) {
      lines.push(characters.slice(index, index + width).join(''));
    }
    return lines.join('\n').slice(0, width * maxLines + maxLines - 1);
  }

  private escapeFilterPath(path: string) {
    return path
      .replace(/\\/g, '\\\\')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");
  }

  private normalizeOutputName(value: string) {
    const base = basename(value)
      .trim()
      .replace(/[\\/:"*?<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 80);
    const name = base || `video-workshop-${Date.now()}`;
    return name.toLowerCase().endsWith('.mp4') ? name : `${name}.mp4`;
  }

  private uniqueOutputPath(outputDir: string, outputName: string) {
    const direct = join(outputDir, outputName);
    if (!existsSync(direct)) return direct;
    const extension = extname(outputName);
    const stem = basename(outputName, extension);
    return join(outputDir, `${stem}-${Date.now()}${extension}`);
  }

  private readDurationSeconds(value: unknown) {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN;
    if (!Number.isFinite(numeric)) return 30;
    return Math.min(180, Math.max(1, Math.round(numeric)));
  }

  private readText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private appendChunk(current: string, chunk: Buffer) {
    return this.appendText(current, chunk.toString('utf8'));
  }

  private appendText(current: string, next: string) {
    return this.truncate(`${current}${next}`, 16000);
  }

  private truncate(value: string, max = 4000) {
    if (value.length <= max) return value;
    return `${value.slice(value.length - max)}...`;
  }
}
