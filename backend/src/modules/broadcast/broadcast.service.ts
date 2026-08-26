import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VoiceTtsService } from '../voice/voice-tts.service';

export type BroadcastStatus =
  | 'DRAFT'
  | 'STARTING'
  | 'LIVE'
  | 'DEGRADED'
  | 'PAUSED'
  | 'ENDED'
  | 'FAILED';

export interface BroadcastSegment {
  id: string;
  text: string;
  audioReady: boolean;
  voiceId: string;
  durationMs?: number;
  createdAt: string;
}

export interface BroadcastJob {
  id: string;
  name: string;
  storeName: string;
  sceneUrl: string;
  outputUrl: string;
  status: BroadcastStatus;
  replyMode: 'observe_only';
  segments: BroadcastSegment[];
  heartbeatAt?: string;
  lastError?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
}

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);
  private readonly jobs = new Map<string, BroadcastJob>();

  constructor(private readonly voiceTts: VoiceTtsService) {}

  list(): BroadcastJob[] {
    return [...this.jobs.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  health() {
    return {
      ok: true,
      workerConfigured: Boolean(process.env.BROADCAST_FFMPEG_BIN),
      workerMode: process.env.BROADCAST_FFMPEG_BIN ? 'configured' : 'blocked',
      replyMode: 'observe_only',
      persistence: 'memory_mvp',
    };
  }

  create(input: {
    name: string;
    storeName: string;
    sceneUrl: string;
    outputUrl?: string;
  }): BroadcastJob {
    const now = new Date().toISOString();
    const job: BroadcastJob = {
      id: randomUUID(),
      name: input.name.trim(),
      storeName: input.storeName.trim(),
      sceneUrl: input.sceneUrl.trim(),
      outputUrl: input.outputUrl?.trim() || '',
      status: 'DRAFT',
      replyMode: 'observe_only',
      segments: [],
      createdAt: now,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): BroadcastJob {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('直播任务不存在');
    return job;
  }

  async addSegment(id: string, input: { text: string; voiceId?: string }) {
    const job = this.get(id);
    const segment: BroadcastSegment = {
      id: randomUUID(),
      text: input.text.trim(),
      voiceId: input.voiceId?.trim() || 'Cherry',
      audioReady: false,
      createdAt: new Date().toISOString(),
    };
    job.segments.push(segment);
    return job;
  }

  async synthesizeSegment(id: string, segmentId: string) {
    const job = this.get(id);
    const segment = job.segments.find((item) => item.id === segmentId);
    if (!segment) throw new NotFoundException('语音片段不存在');

    // 只验证并调用统一 Kaypal TTS 网关；音频落盘/队列由下一阶段 worker 接管。
    const result = await this.voiceTts.synthesize(segment.text, undefined, {
      provider: 'kaypal-gateway',
      voiceId: segment.voiceId,
    });
    result.stream.resume();
    segment.audioReady = true;
    return { job, model: result.model, voiceId: result.voiceId };
  }

  start(id: string): BroadcastJob {
    const job = this.get(id);
    if (!job.sceneUrl) {
      job.status = 'FAILED';
      job.lastError = '未配置实景视频源';
      return job;
    }
    if (!process.env.BROADCAST_FFMPEG_BIN) {
      job.status = 'DEGRADED';
      job.lastError =
        'BROADCAST_FFMPEG_BIN 未配置：已创建直播任务，但尚未启动真实推流 worker';
      return job;
    }
    job.status = 'STARTING';
    job.startedAt = new Date().toISOString();
    job.heartbeatAt = job.startedAt;
    // 真实 FFmpeg/SRS worker 在下一阶段接入；当前状态不会伪装成 LIVE。
    job.status = 'DEGRADED';
    job.lastError = '推流 worker 尚未接入，当前仅完成控制平面校验';
    this.logger.warn(`Broadcast ${id} blocked: worker adapter is not connected`);
    return job;
  }

  transition(id: string, status: 'PAUSED' | 'ENDED') {
    const job = this.get(id);
    job.status = status;
    job.heartbeatAt = new Date().toISOString();
    if (status === 'ENDED') job.endedAt = job.heartbeatAt;
    return job;
  }
}
