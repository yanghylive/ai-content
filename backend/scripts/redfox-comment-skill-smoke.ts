import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuthRequestContextService } from '../src/common/auth-request-context.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { IntelligenceMonitorRunnerService } from '../src/modules/intelligence/intelligence-monitor-runner.service';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types';
import { KaypalAuthClient } from '../src/modules/auth/kaypal-auth.client';

type Platform = 'douyin' | 'xiaohongshu' | 'bilibili';

function readPlatform(): Platform {
  const value = (process.env.REDFOX_COMMENT_SMOKE_PLATFORM || 'douyin').trim();
  if (value === 'douyin' || value === 'xiaohongshu' || value === 'bilibili') {
    return value;
  }
  throw new Error(
    'REDFOX_COMMENT_SMOKE_PLATFORM must be douyin, xiaohongshu, or bilibili',
  );
}

function readPositiveInt(name: string, fallback: number, max: number) {
  const parsed = Number(process.env[name] || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function hasServerBillingKey() {
  return Boolean(
    (process.env.KAYPAL_API_KEY || process.env.KAYPAL_AI_PROXY_API_KEY || '')
      .trim(),
  );
}

async function resolveActor(
  prisma: PrismaService,
  kaypalClient: KaypalAuthClient,
): Promise<{
  actor: AuthenticatedUser;
  sessionId: string;
}> {
  const sessions = await prisma.userSession.findMany({
    where: {
      expiresAt: { gt: new Date() },
      user: {
        status: 'active',
        kaypalUserId: { not: null },
      },
    },
    include: { user: true },
    orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
    take: 20,
  });
  const sessionWithToken = sessions.find((candidate) => {
    const metadata = readRecord(candidate.metadata);
    return Boolean(
      readString(metadata, 'kaypalDesktopAccessToken') ||
        readString(metadata, 'kaypalAccessToken'),
    );
  });
  const session = sessionWithToken || sessions[0];

  if (!session) {
    throw new Error('没有找到带 Kaypal 用户 ID 的有效本地会话，无法验证云端扣积分。');
  }

  let metadata = readRecord(session.metadata);
  let accessToken =
    readString(metadata, 'kaypalDesktopAccessToken') ||
    readString(metadata, 'kaypalAccessToken');
  if (!accessToken && !hasServerBillingKey()) {
    throw new Error(
      '当前会话没有 Kaypal 桌面 access token，且未配置服务端 billing key，无法验证云端扣积分。',
    );
  }
  const refreshToken =
    readString(metadata, 'kaypalDesktopRefreshToken') ||
    readString(metadata, 'kaypalRefreshToken');
  const deviceId =
    readString(metadata, 'kaypalDesktopDeviceId') ||
    readString(metadata, 'kaypalDeviceId');

  if (refreshToken && deviceId) {
    try {
      const refreshed = await kaypalClient.refreshDesktopAuthToken({
        refreshToken,
        deviceId,
      });
      metadata = {
        ...metadata,
        kaypalDesktopAccessToken: refreshed.access_token,
        kaypalDesktopRefreshToken: refreshed.refresh_token,
        kaypalDesktopTokenExpiresAt: new Date(
          Date.now() + refreshed.expires_in * 1000,
        ).toISOString(),
        kaypalDesktopDeviceId: refreshed.device_id || deviceId,
      };
      await prisma.userSession.update({
        where: { id: session.id },
        data: { metadata: metadata as never },
      });
      accessToken = refreshed.access_token;
    } catch (error) {
      if (process.env.REDFOX_COMMENT_SMOKE_REQUIRE_TOKEN_REFRESH === 'true') {
        throw error;
      }
      console.warn(
        JSON.stringify({
          status: 'warning',
          message:
            'Kaypal desktop token refresh failed; continuing to verify server-key billing fallback.',
        }),
      );
    }
  }

  return {
    sessionId: session.id,
    actor: {
      id: session.user.id,
      username: session.user.username,
      email: session.user.email,
      name: session.user.name,
      status: session.user.status,
      lastLoginAt: session.user.lastLoginAt,
      kaypalUserId: session.user.kaypalUserId,
      kaypalPlan: readString(metadata, 'kaypalSubscriptionPlan') || 'UNKNOWN',
      kaypalRole: readString(metadata, 'kaypalRole'),
      kaypalPlatformRole: readString(metadata, 'kaypalPlatformRole'),
      kaypalPermissionNames: Array.isArray(metadata.kaypalPermissionNames)
        ? metadata.kaypalPermissionNames.filter(
            (item): item is string => typeof item === 'string',
          )
        : [],
      kaypalDesktopAccessToken: accessToken || undefined,
      kaypalDesktopRefreshToken: readString(
        metadata,
        'kaypalDesktopRefreshToken',
      ),
      kaypalDesktopTokenExpiresAt: readString(
        metadata,
        'kaypalDesktopTokenExpiresAt',
      ),
      kaypalDesktopDeviceId: readString(metadata, 'kaypalDesktopDeviceId'),
      kaypalLocalOnly: metadata.localOnly === true,
      role: (session.user as { role?: string }).role || 'operator',
      commercialExecutionAllowed:
        (session.user as { commercialExecutionAllowed?: boolean })
          .commercialExecutionAllowed ?? true,
      planMode: (session.user as { planMode?: string }).planMode || 'commercial',
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt,
    },
  };
}

function candidateText(item: {
  sourceExternalId?: string | null;
  sourceUrl?: string | null;
  raw?: unknown;
}) {
  const raw = readRecord(item.raw);
  return [
    item.sourceExternalId,
    item.sourceUrl,
    readString(raw, 'id'),
    readString(raw, 'awemeId'),
    readString(raw, 'noteId'),
    readString(raw, 'bvid'),
    readString(raw, 'url'),
    readString(raw, 'link'),
    JSON.stringify(raw).slice(0, 2000),
  ]
    .filter(Boolean)
    .join(' ');
}

function extractWorkId(platform: Platform, text: string) {
  if (platform === 'bilibili') {
    return text.match(/\b(BV[a-zA-Z0-9]+)\b/)?.[1] || '';
  }
  if (platform === 'xiaohongshu') {
    return (
      text.match(/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/)?.[1] ||
      text.match(/\b([0-9a-fA-F]{16,32})\b/)?.[1] ||
      ''
    );
  }
  return (
    text.match(/(?:video|note)\/(\d{8,})/)?.[1] ||
    text.match(/\b(\d{8,})\b/)?.[1] ||
    ''
  );
}

function shortText(value: string | null | undefined) {
  const text = value?.trim() || '';
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
}

async function main() {
  if (process.env.REDFOX_COMMENT_SMOKE_ALLOW_LIVE !== 'true') {
    console.log(
      JSON.stringify(
        {
          status: 'skipped',
          reason:
            'Set REDFOX_COMMENT_SMOKE_ALLOW_LIVE=true to run live RedFox + billing verification.',
          example:
            'REDFOX_COMMENT_SMOKE_ALLOW_LIVE=true REDFOX_COMMENT_SMOKE_PLATFORM=douyin REDFOX_COMMENT_SMOKE_KEYWORD=AI创业 npx ts-node -r tsconfig-paths/register scripts/redfox-comment-skill-smoke.ts',
        },
        null,
        2,
      ),
    );
    return;
  }

  const platform = readPlatform();
  const keyword = (process.env.REDFOX_COMMENT_SMOKE_KEYWORD || 'AI创业').trim();
  const limit = readPositiveInt('REDFOX_COMMENT_SMOKE_LIMIT', 5, 20);
  const configuredWork = (process.env.REDFOX_COMMENT_SMOKE_WORK || '').trim();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const kaypalClient = app.get(KaypalAuthClient);
    const authContext = app.get(AuthRequestContextService);
    const runner = app.get(IntelligenceMonitorRunnerService);
    const { actor, sessionId } = await resolveActor(prisma, kaypalClient);

    await authContext.run({ sessionId, user: actor }, async () => {
      let work = configuredWork;
      let searchSummary:
        | {
            received: number;
            created: number;
            updated: number;
            selectedTitle: string;
          }
        | undefined;

      if (!work) {
        const searchResult = await runner.runSearch(actor, {
          keyword,
          platform,
          target: 'post',
          limit: 3,
        });
        const candidate = searchResult.items.find((item) =>
          extractWorkId(platform, candidateText(item)),
        );
        if (!candidate) {
          throw new Error(
            `RedFox 作品搜索返回了 ${searchResult.items.length} 条，但没有提取到可用于评论 Skill 的作品 ID。`,
          );
        }
        work = extractWorkId(platform, candidateText(candidate));
        searchSummary = {
          received: searchResult.received,
          created: searchResult.created,
          updated: searchResult.updated,
          selectedTitle: candidate.title,
        };
      }

      const commentResult = await runner.runSearch(actor, {
        keyword: work,
        workId: work,
        platform,
        target: 'comment',
        limit,
      });

      console.log(
        JSON.stringify(
          {
            status: 'passed',
            platform,
            keyword,
            work,
            search: searchSummary,
            comment: {
              received: commentResult.received,
              normalized: commentResult.normalized,
              created: commentResult.created,
              updated: commentResult.updated,
              endpoint: commentResult.endpoints[0]?.endpoint,
              callLogId: commentResult.endpoints[0]?.callLogId || null,
              sample: commentResult.items.slice(0, 2).map((item) => ({
                id: item.id,
                title: item.title,
                content: shortText(item.content),
                author: item.author,
                sourceUrl: item.sourceUrl,
              })),
            },
          },
          null,
          2,
        ),
      );
    });
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        stack:
          process.env.REDFOX_COMMENT_SMOKE_DEBUG === 'true' &&
          error instanceof Error
            ? error.stack
            : undefined,
      },
      null,
      2,
    ),
  );
  process.exit(2);
});
