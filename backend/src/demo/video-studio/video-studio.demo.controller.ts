import { Body, Controller, Get, Logger, Param, Post } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireDemoMode } from '../../lib/demo/demo-mode';

const DEMO_PREFIX = '[DEMO-MODE][NON-COMPLIANT]';

interface VideoStudioFixture {
  demoTitle: string;
  notice: string;
  pipelines: Array<{ value: string; label: string }>;
  stageLabels: Record<string, string>;
  stageOrder: string[];
  completedVideo: {
    url: null;
    bytes: number;
    placeholder: boolean;
    message: string;
  };
}

interface DemoProjectState {
  id: string;
  title: string;
  pipeline: string;
  stageDoneCount: number; // 访问次数驱动进度推进（演示用）
  createdAt: string;
}

function loadFixture(): VideoStudioFixture {
  const path = join(__dirname, '..', 'fixtures', 'video-studio.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as VideoStudioFixture;
}

/**
 * 视频一键成片（演示舱）——能力证明，非产品功能。
 * 模拟 12 流水线编排全流程：全部 mock 数据，不产出真实视频、不调用 LLM/渲染。
 */
@Controller('demo/video-studio')
export class VideoStudioDemoController {
  private readonly logger = new Logger(VideoStudioDemoController.name);
  private readonly fixture: VideoStudioFixture;
  private readonly projects = new Map<string, DemoProjectState>();

  constructor() {
    this.fixture = loadFixture();
  }

  @Get('status')
  getStatus() {
    requireDemoMode();
    return {
      enabled: true,
      title: this.fixture.demoTitle,
      notice: this.fixture.notice,
      mock: true,
    };
  }

  @Get('pipelines')
  getPipelines() {
    requireDemoMode();
    this.logger.warn(`${DEMO_PREFIX} 流水线列表被读取（mock 数据）`);
    return { pipelines: this.fixture.pipelines };
  }

  @Post('generate')
  generate(@Body() input: { pipeline?: string; prompt?: string }) {
    requireDemoMode();
    const id = `demo-video-${Date.now()}`;
    this.projects.set(id, {
      id,
      title: (input.prompt || '').trim() || '（未填写选题）',
      pipeline: input.pipeline || 'news_brief',
      stageDoneCount: 0,
      createdAt: new Date().toISOString(),
    });
    this.logger.warn(`${DEMO_PREFIX} 创建演示项目 ${id}（mock，无真实渲染）`);
    return { project_id: id, status: 'queued', mock: true };
  }

  @Get('projects/:id')
  getProject(@Param('id') id: string) {
    requireDemoMode();
    const state = this.projects.get(id);
    if (!state) {
      return { error: '项目不存在', mock: true };
    }
    // 每次查询推进一个阶段（演示进度变化；第 5 次后完成）
    state.stageDoneCount = Math.min(
      state.stageDoneCount + 1,
      this.fixture.stageOrder.length + 1,
    );
    const done = state.stageDoneCount;
    const stages = this.fixture.stageOrder.map((name, index) => ({
      name,
      status: index < done ? 'done' : index === done ? 'running' : 'pending',
    }));
    const isDone = done >= this.fixture.stageOrder.length;
    return {
      id: state.id,
      title: state.title,
      pipeline: state.pipeline,
      stages,
      video: isDone ? this.fixture.completedVideo : null,
      mock: true,
    };
  }
}
