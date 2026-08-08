import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AutoUploadService } from './auto-upload.service';
import {
  PublishRecordStore,
  type DurablePublishRecord,
} from './publish-record.store';

const POLL_INTERVAL_MS = 5_000;
const LEASE_DURATION_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 3;

@Injectable()
export class DurablePublishWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DurablePublishWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  private running = false;

  constructor(
    private readonly publishRecordStore: PublishRecordStore,
    private readonly autoUploadService: AutoUploadService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    for (const hb of this.heartbeatTimers.values()) clearInterval(hb);
    this.heartbeatTimers.clear();
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.reenqueueDueScheduled();
      await this.reclaimStaleTasks();
      await this.processOneTask();
    } catch (error) {
      this.logger.error(
        `Worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** 到点的改期任务重新入队（与正常认领同循环，天然有序） */
  private async reenqueueDueScheduled() {
    try {
      const count =
        await this.autoUploadService.reenqueueDueScheduledPublishes();
      if (count > 0) {
        this.logger.log(`Re-enqueued ${count} due scheduled publish task(s).`);
      }
    } catch (error) {
      this.logger.error(
        `Scheduled re-enqueue failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async reclaimStaleTasks() {
    try {
      const { reclaimed, deadLettered } =
        await this.publishRecordStore.reclaimStaleClaims(
          new Date(),
          MAX_ATTEMPTS,
        );
      if (reclaimed > 0) {
        this.logger.log(`Reclaimed ${reclaimed} stale claimed task(s).`);
      }
      if (deadLettered > 0) {
        this.logger.warn(
          `Dead-lettered ${deadLettered} task(s) exceeding max attempts (${MAX_ATTEMPTS}).`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Stale reclaim failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async processOneTask() {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);
    const claimToken = randomUUID();

    const record = await this.publishRecordStore.claimNextQueued(
      now,
      leaseExpiresAt,
      claimToken,
    );
    if (!record) return;

    this.logger.log(
      `Claimed durable task #${record.publicId} (db=${record.databaseId}).`,
    );

    const heartbeat = setInterval(() => {
      void this.renewLease(record.databaseId, claimToken);
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimers.set(record.databaseId, heartbeat);

    try {
      await this.executeWithAuthContext(record);
      const completed = await this.publishRecordStore.completeClaimedTask(
        record.databaseId,
        claimToken,
        'completed',
        'success',
        '发布任务已完成。',
      );
      if (!completed) {
        this.logger.warn(
          `Task #${record.publicId} could not be marked completed (lease lost?).`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '发布执行失败';
      const failed = await this.publishRecordStore.completeClaimedTask(
        record.databaseId,
        claimToken,
        'failed',
        'execution_failed',
        `发布失败：${message}`,
      );
      if (!failed) {
        this.logger.warn(
          `Task #${record.publicId} could not be marked failed (lease lost?).`,
        );
      }
      this.logger.error(`Task #${record.publicId} failed: ${message}`);
    } finally {
      clearInterval(heartbeat);
      this.heartbeatTimers.delete(record.databaseId);
    }
  }

  private async renewLease(databaseId: string, claimToken: string) {
    const newLease = new Date(Date.now() + LEASE_DURATION_MS);
    const renewed = await this.publishRecordStore.renewLease(
      databaseId,
      claimToken,
      newLease,
    );
    if (!renewed) {
      this.logger.warn(`Lease renewal failed for ${databaseId} (claim lost?).`);
    }
  }

  private async executeWithAuthContext(record: DurablePublishRecord) {
    const context = {
      user: { id: record.userId },
      sessionId: record.authSessionId || '',
    };
    await this.authRequestContext.run(context, async () => {
      await this.autoUploadService.executeClaimedDurableTask(record);
    });
  }
}
