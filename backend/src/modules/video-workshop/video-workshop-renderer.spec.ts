import {
  resolveVideoWorkshopClipSettings,
  VideoWorkshopRenderer,
} from './video-workshop-renderer';

describe('VideoWorkshopRenderer', () => {
  const renderer = new VideoWorkshopRenderer();

  it('maps each supported template to settings that change the rendered clip', () => {
    expect(
      resolveVideoWorkshopClipSettings(undefined, '产品卖点模板'),
    ).toMatchObject({
      aspectRatio: '9:16 竖版',
      musicPreset: '轻快节奏',
      filterPreset: '自然清晰',
    });
    expect(
      resolveVideoWorkshopClipSettings(undefined, '门店探店模板'),
    ).toMatchObject({
      titleStyle: '标题：高亮重点',
      fontPreset: '圆体',
      filterPreset: '暖调生活',
    });
    expect(
      resolveVideoWorkshopClipSettings(undefined, '客户案例模板'),
    ).toMatchObject({
      aspectRatio: '16:9 横版',
      musicPreset: '温和叙述',
      transitionPreset: '淡入淡出',
    });
    expect(
      resolveVideoWorkshopClipSettings(undefined, '知识口播模板'),
    ).toMatchObject({
      aspectRatio: '1:1 方形',
      fontPreset: '宋体',
      transitionPreset: '不使用转场',
    });
  });

  it('rejects unsupported clip settings instead of silently ignoring them', () => {
    expect(() =>
      resolveVideoWorkshopClipSettings(
        { filterPreset: '不存在的滤镜' },
        '产品卖点模板',
      ),
    ).toThrow(
      expect.objectContaining({
        reasonCode: 'invalid_input',
        message: '滤镜不受支持，请重新选择',
      }),
    );
  });

  it('builds FFmpeg arguments from saved music, text, font, filter, and transition settings', () => {
    const args = renderer.buildFfmpegArgs({
      material: { path: '/tmp/source.mp4', kind: 'video' },
      outputPath: '/tmp/output.partial.mp4',
      durationSeconds: 30,
      settings: {
        musicPreset: '温和叙述',
        titleStyle: '标题：高亮重点',
        subtitleStyle: '字幕：重点高亮',
        fontPreset: '宋体',
        filterPreset: '暖调生活',
        transitionPreset: '淡入淡出',
        aspectRatio: '16:9 横版',
      },
      titleTextPath: '/tmp/title.txt',
      subtitleTextPath: '/tmp/subtitle.txt',
      hasAudio: true,
      drawtextSupported: true,
    });

    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(args).toEqual(
      expect.arrayContaining([
        '-f',
        'lavfi',
        '-map',
        '[aout]',
        '-progress',
        'pipe:1',
      ]),
    );
    expect(args.join(' ')).toContain('aevalsrc=exprs=');
    expect(graph).toContain('scale=1920:1080');
    expect(graph).toContain('eq=contrast=1.02:saturation=1.08');
    expect(graph).toContain('fade=t=in:st=0:d=0.65');
    expect(graph).toContain("textfile='/tmp/title.txt'");
    expect(graph).toContain("textfile='/tmp/subtitle.txt'");
    expect(graph).toContain('fontcolor=yellow');
    expect(graph).toContain('amix=inputs=2');
    expect(graph.match(/drawtext=/g)).toHaveLength(2);
  });

  it('omits optional FFmpeg filters when each setting is disabled', () => {
    const args = renderer.buildFfmpegArgs({
      material: { path: '/tmp/source.mp4', kind: 'video' },
      outputPath: '/tmp/output.partial.mp4',
      durationSeconds: 10,
      settings: {
        musicPreset: '不使用音乐',
        titleStyle: '不加标题',
        subtitleStyle: '不加字幕',
        fontPreset: '系统黑体',
        filterPreset: '不使用滤镜',
        transitionPreset: '不使用转场',
        aspectRatio: '9:16 竖版',
      },
      titleTextPath: '/tmp/title.txt',
      subtitleTextPath: '/tmp/subtitle.txt',
      hasAudio: false,
      drawtextSupported: true,
    });

    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(args.join(' ')).not.toContain('aevalsrc');
    expect(graph).not.toContain('drawtext=');
    expect(graph).not.toContain('eq=');
    expect(graph).not.toContain('fade=');
    expect(graph).toContain('scale=1080:1920');
  });

  it('uses local PNG overlays when FFmpeg lacks drawtext support', () => {
    const args = renderer.buildFfmpegArgs({
      material: { path: '/tmp/source.mp4', kind: 'video' },
      outputPath: '/tmp/output.partial.mp4',
      durationSeconds: 10,
      settings: {
        musicPreset: '轻快节奏',
        titleStyle: '标题：简洁加粗',
        subtitleStyle: '字幕：白字黑边',
        fontPreset: '系统黑体',
        filterPreset: '自然清晰',
        transitionPreset: '自然切换',
        aspectRatio: '9:16 竖版',
      },
      titleTextPath: '/tmp/title.txt',
      subtitleTextPath: '/tmp/subtitle.txt',
      titleOverlayPath: '/tmp/title.png',
      subtitleOverlayPath: '/tmp/subtitle.png',
      hasAudio: false,
      drawtextSupported: false,
    });

    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(args).toEqual(
      expect.arrayContaining([
        '-i',
        '/tmp/title.png',
        '-i',
        '/tmp/subtitle.png',
      ]),
    );
    expect(graph).toContain('[1:v]format=rgba[titlelayer]');
    expect(graph).toContain('[2:v]format=rgba[subtitlelayer]');
    expect(graph).toContain('[3:a]atrim=duration=10');
    expect(graph).toContain("enable='between(t,0,4)'");
  });
});
