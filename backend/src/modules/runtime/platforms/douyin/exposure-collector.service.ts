import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { safeText } from '../../../../common/text.utils';
import { LocalBrowserEngine } from '../../../local-engine/local-browser-engine.service';

export type DouyinExposureCollectorInput = {
  accountId: string | number;
  links: string[];
  limit?: number;
  filters?: Record<string, unknown>;
};

export type DouyinSearchExposureCollectorInput = {
  accountId: string | number;
  searchKeywords: string[];
  limit?: number;
  filters?: Record<string, unknown>;
};

export type DouyinExposureCandidate = {
  sourceUrl: string;
  text: string;
  index: number;
  kind?:
    | 'comment'
    | 'search-result'
    | 'hot-video-comment'
    | 'targeted-comment'
    | 'retention-comment'
    | 'retention-contact';
  targetName?: string;
  profileUrl?: string;
  commentTime?: string;
  videoTitle?: string;
  videoUrl?: string;
  engagementScore?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
};

export type DouyinExposureCollectorResult = {
  ok: boolean;
  status:
    | 'collected'
    | 'account_not_logged_in'
    | 'captcha_required'
    | 'target_not_found'
    | 'platform_changed'
    | 'runtime_unavailable';
  message: string;
  currentUrl?: string;
  title?: string;
  candidates: DouyinExposureCandidate[];
  evidence?: {
    type: 'screenshot';
    label: string;
    path: string;
    url?: string;
    capturedAt: string;
  };
  raw?: Record<string, unknown>;
};

type RawDouyinVideoLink = {
  href: string;
  text: string;
  videoId?: string;
};

type RawDouyinAccountLink = {
  href: string;
  text: string;
  userId?: string;
};

@Injectable()
export class DouyinExposureCollector {
  private readonly logger = new Logger(DouyinExposureCollector.name);

  constructor(private readonly browser: LocalBrowserEngine) {}

  async collectFromLinks(
    input: DouyinExposureCollectorInput,
  ): Promise<DouyinExposureCollectorResult> {
    const firstLink = input.links[0];
    if (!firstLink) {
      return {
        ok: false,
        status: 'target_not_found',
        message: '缺少抖音视频链接',
        candidates: [],
      };
    }

    try {
      const session = await this.browser.getOrCreateSession({
        platform: 'douyin',
        accountId: input.accountId,
      });
      await this.browser.open(session.key, firstLink, {
        waitUntil: 'domcontentloaded',
      });
      await session.page.waitForTimeout(2500).catch(() => undefined);
      await this.scrollForComments(session.page, input.limit ?? 20);

      const snapshot = await this.browser.readPageSnapshot({
        sessionKey: session.key,
        label: 'douyin-link-exposure-read',
        textLimit: 6000,
      });
      const diagnosis = this.diagnose(snapshot.textSample, snapshot.url);
      if (diagnosis) {
        return {
          ok: false,
          status: diagnosis.status,
          message: diagnosis.message,
          currentUrl: snapshot.url,
          title: snapshot.title,
          candidates: [],
          evidence: {
            type: 'screenshot',
            label: 'douyin-link-exposure-blocked',
            path: snapshot.evidencePath,
            url: snapshot.evidenceUrl,
            capturedAt: new Date().toISOString(),
          },
          raw: {
            textSample: snapshot.textSample.slice(0, 800),
            filters: input.filters ?? {},
          },
        };
      }

      const candidates = this.extractCandidates({
        sourceUrl: snapshot.url || firstLink,
        text: snapshot.textSample,
        limit: input.limit ?? 20,
        filters: input.filters,
        videoTitle: snapshot.title,
        videoUrl: snapshot.url || firstLink,
      });
      const domCandidates = await this.extractDomCommentCandidates(
        session.page,
        {
          sourceUrl: snapshot.url || firstLink,
          limit: input.limit ?? 20,
          filters: input.filters,
          videoTitle: snapshot.title,
          videoUrl: snapshot.url || firstLink,
        },
      );
      const finalCandidates = domCandidates.length ? domCandidates : candidates;

      return {
        ok: finalCandidates.length > 0,
        status: finalCandidates.length > 0 ? 'collected' : 'target_not_found',
        message:
          finalCandidates.length > 0
            ? `已采集 ${finalCandidates.length} 条候选评论`
            : '未从页面文本中识别到候选评论',
        currentUrl: snapshot.url,
        title: snapshot.title,
        candidates: finalCandidates,
        evidence: {
          type: 'screenshot',
          label: 'douyin-link-exposure-read',
          path: snapshot.evidencePath,
          url: snapshot.evidenceUrl,
          capturedAt: new Date().toISOString(),
        },
        raw: {
          textSample: snapshot.textSample.slice(0, 1200),
          filters: input.filters ?? {},
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Douyin link exposure collect failed: ${message}`);
      return {
        ok: false,
        status: 'runtime_unavailable',
        message: `抖音链接曝光采集失败：${message}`,
        candidates: [],
      };
    }
  }

  async collectFromSearch(
    input: DouyinSearchExposureCollectorInput,
  ): Promise<DouyinExposureCollectorResult> {
    const keyword = input.searchKeywords.find((item) => item.trim().length > 0);
    if (!keyword) {
      return {
        ok: false,
        status: 'target_not_found',
        message: '缺少抖音搜索关键词',
        candidates: [],
      };
    }

    const searchUrl = this.buildUserSearchUrl(keyword);

    try {
      const session = await this.browser.getOrCreateSession({
        platform: 'douyin',
        accountId: input.accountId,
      });
      await this.browser.open(session.key, searchUrl, {
        waitUntil: 'domcontentloaded',
      });
      await session.page.waitForTimeout(2500).catch(() => undefined);
      await this.scrollForComments(session.page, input.limit ?? 20);

      const snapshot = await this.browser.readPageSnapshot({
        sessionKey: session.key,
        label: 'douyin-search-exposure-read',
        textLimit: 6000,
      });
      const diagnosis = this.diagnoseSearch(snapshot.textSample, snapshot.url);
      if (diagnosis) {
        return {
          ok: false,
          status: diagnosis.status,
          message: diagnosis.message,
          currentUrl: snapshot.url,
          title: snapshot.title,
          candidates: [],
          evidence: {
            type: 'screenshot',
            label: 'douyin-search-exposure-blocked',
            path: snapshot.evidencePath,
            url: snapshot.evidenceUrl,
            capturedAt: new Date().toISOString(),
          },
          raw: {
            keyword,
            searchUrl,
            textSample: snapshot.textSample.slice(0, 800),
            filters: input.filters ?? {},
          },
        };
      }

      const accountLinks = await this.extractAccountLinks(
        session.page,
        snapshot.url || searchUrl,
        Math.min(input.limit ?? 20, 30),
      );
      const candidates = this.filterSearchAccountCandidates(
        this.extractSearchCandidates({
          sourceUrl: snapshot.url || searchUrl,
          text: snapshot.textSample,
          limit: input.limit ?? 20,
          filters: input.filters,
          accountLinks,
        }),
        input.filters,
      ).slice(0, input.limit ?? 20);

      return {
        ok: candidates.length > 0,
        status: candidates.length > 0 ? 'collected' : 'target_not_found',
        message:
          candidates.length > 0
            ? `已按关键词识别 ${candidates.length} 个候选账号`
            : '未从抖音搜索结果中识别到候选账号',
        currentUrl: snapshot.url,
        title: snapshot.title,
        candidates,
        evidence: {
          type: 'screenshot',
          label: 'douyin-search-exposure-read',
          path: snapshot.evidencePath,
          url: snapshot.evidenceUrl,
          capturedAt: new Date().toISOString(),
        },
        raw: {
          keyword,
          searchUrl,
          accountLinkCount: accountLinks.length,
          textSample: snapshot.textSample.slice(0, 1200),
          filters: input.filters ?? {},
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Douyin search exposure collect failed: ${message}`);
      return {
        ok: false,
        status: 'runtime_unavailable',
        message: `抖音搜索曝光采集失败：${message}`,
        candidates: [],
      };
    }
  }

  async collectHotVideos(
    input: DouyinSearchExposureCollectorInput,
  ): Promise<DouyinExposureCollectorResult> {
    const keyword = input.searchKeywords.find((item) => item.trim().length > 0);
    if (!keyword) {
      return {
        ok: false,
        status: 'target_not_found',
        message: '缺少抖音爆款视频关键词',
        candidates: [],
      };
    }

    const searchUrl = this.buildSearchUrl(keyword);

    try {
      const session = await this.browser.getOrCreateSession({
        platform: 'douyin',
        accountId: input.accountId,
      });
      await this.browser.open(session.key, searchUrl, {
        waitUntil: 'domcontentloaded',
      });
      await session.page.waitForTimeout(2500).catch(() => undefined);
      await this.scrollForComments(session.page, input.limit ?? 20);

      const searchSnapshot = await this.browser.readPageSnapshot({
        sessionKey: session.key,
        label: 'douyin-hot-video-search-read',
        textLimit: 6000,
      });
      const searchDiagnosis = this.diagnoseSearch(
        searchSnapshot.textSample,
        searchSnapshot.url,
      );
      if (searchDiagnosis) {
        return {
          ok: false,
          status: searchDiagnosis.status,
          message: searchDiagnosis.message,
          currentUrl: searchSnapshot.url,
          title: searchSnapshot.title,
          candidates: [],
          evidence: {
            type: 'screenshot',
            label: 'douyin-hot-video-search-blocked',
            path: searchSnapshot.evidencePath,
            url: searchSnapshot.evidenceUrl,
            capturedAt: new Date().toISOString(),
          },
          raw: {
            keyword,
            searchUrl,
            textSample: searchSnapshot.textSample.slice(0, 800),
            filters: input.filters ?? {},
          },
        };
      }

      const requestedLimit = Math.max(1, input.limit ?? 20);
      const videoLinks = await this.extractVideoLinks(
        session.page,
        searchSnapshot.url || searchUrl,
        Math.min(Math.max(requestedLimit, 12), 30),
      );
      if (!videoLinks.length) {
        return {
          ok: false,
          status: 'target_not_found',
          message: '未从抖音搜索结果中识别到可打开的视频。',
          currentUrl: searchSnapshot.url,
          title: searchSnapshot.title,
          candidates: [],
          evidence: {
            type: 'screenshot',
            label: 'douyin-hot-video-search-no-video',
            path: searchSnapshot.evidencePath,
            url: searchSnapshot.evidenceUrl,
            capturedAt: new Date().toISOString(),
          },
          raw: {
            keyword,
            searchUrl,
            textSample: searchSnapshot.textSample.slice(0, 1200),
            filters: input.filters ?? {},
          },
        };
      }

      const selectedVideos = videoLinks.slice(
        0,
        this.resolveHotVideoPoolSize(requestedLimit, input.filters),
      );
      const perVideoLimit = this.resolveHotVideoPerVideoLimit(
        requestedLimit,
        selectedVideos.length,
        input.filters,
      );
      const collectedCandidates: DouyinExposureCandidate[] = [];
      const openedVideos: Array<{
        url: string;
        title?: string;
        engagementScore: number;
        status: 'collected' | DouyinExposureCollectorResult['status'];
        message?: string;
        candidateCount: number;
        snapshotUrl?: string;
        snapshotTitle?: string;
        evidencePath?: string;
        evidenceUrl?: string;
        textSample?: string;
      }> = [];

      for (const video of selectedVideos) {
        await this.browser.open(session.key, video.url, {
          waitUntil: 'domcontentloaded',
        });
        await session.page.waitForTimeout(2500).catch(() => undefined);
        await this.scrollForComments(session.page, perVideoLimit);

        const videoSnapshot = await this.browser.readPageSnapshot({
          sessionKey: session.key,
          label: 'douyin-hot-video-comment-read',
          textLimit: 6000,
        });
        const videoDiagnosis = this.diagnose(
          videoSnapshot.textSample,
          videoSnapshot.url,
        );
        if (videoDiagnosis) {
          openedVideos.push({
            url: video.url,
            title: video.title,
            engagementScore: video.engagementScore,
            status: videoDiagnosis.status,
            message: videoDiagnosis.message,
            candidateCount: 0,
            snapshotUrl: videoSnapshot.url,
            snapshotTitle: videoSnapshot.title,
            evidencePath: videoSnapshot.evidencePath,
            evidenceUrl: videoSnapshot.evidenceUrl,
            textSample: videoSnapshot.textSample.slice(0, 500),
          });
          if (
            videoDiagnosis.status === 'account_not_logged_in' ||
            videoDiagnosis.status === 'captcha_required'
          ) {
            return {
              ok: false,
              status: videoDiagnosis.status,
              message: videoDiagnosis.message,
              currentUrl: videoSnapshot.url,
              title: videoSnapshot.title,
              candidates: [],
              evidence: {
                type: 'screenshot',
                label: 'douyin-hot-video-comment-blocked',
                path: videoSnapshot.evidencePath,
                url: videoSnapshot.evidenceUrl,
                capturedAt: new Date().toISOString(),
              },
              raw: {
                keyword,
                searchUrl,
                selectedVideoUrl: selectedVideos[0]?.url,
                selectedVideoTitle: selectedVideos[0]?.title,
                selectedVideos: selectedVideos.map((item) => ({
                  url: item.url,
                  title: item.title,
                  engagementScore: item.engagementScore,
                })),
                openedVideos,
                videoLinkCount: videoLinks.length,
                filters: input.filters ?? {},
              },
            };
          }
          continue;
        }

        const extractionInput = {
          sourceUrl: videoSnapshot.url || video.url,
          limit: perVideoLimit,
          filters: input.filters,
          videoTitle: video.title || videoSnapshot.title,
          videoUrl: video.url,
          engagementScore: video.engagementScore,
          likeCount: video.likeCount,
          commentCount: video.commentCount,
          shareCount: video.shareCount,
          requireCommentTime: true,
        };
        const candidates = this.extractCandidates({
          ...extractionInput,
          text: videoSnapshot.textSample,
        }).map((candidate) => ({
          ...candidate,
          kind: 'hot-video-comment' as const,
        }));
        const domCandidates = (
          await this.extractDomCommentCandidates(session.page, extractionInput)
        ).map((candidate) => ({
          ...candidate,
          kind: 'hot-video-comment' as const,
        }));
        const videoCandidates = this.filterHotVideoCommentCandidates(
          domCandidates.length ? domCandidates : candidates,
          input.filters,
        );
        collectedCandidates.push(...videoCandidates);
        openedVideos.push({
          url: video.url,
          title: video.title || videoSnapshot.title,
          engagementScore: video.engagementScore,
          status: videoCandidates.length ? 'collected' : 'target_not_found',
          candidateCount: videoCandidates.length,
          snapshotUrl: videoSnapshot.url,
          snapshotTitle: videoSnapshot.title,
          evidencePath: videoSnapshot.evidencePath,
          evidenceUrl: videoSnapshot.evidenceUrl,
          textSample: videoSnapshot.textSample.slice(0, 500),
        });
      }

      const finalCandidates = this.diversifyHotVideoCandidates(
        collectedCandidates,
        requestedLimit,
      );
      const evidenceVideo =
        openedVideos.find((item) => item.candidateCount > 0) ||
        openedVideos[openedVideos.length - 1];
      const candidateVideoCount = new Set(
        finalCandidates.map((item) => item.videoUrl || item.sourceUrl),
      ).size;

      return {
        ok: finalCandidates.length > 0,
        status: finalCandidates.length > 0 ? 'collected' : 'target_not_found',
        message:
          finalCandidates.length > 0
            ? `已打开 ${openedVideos.length} 个爆款视频并采集 ${finalCandidates.length} 条候选评论，覆盖 ${candidateVideoCount} 个视频`
            : `已打开 ${openedVideos.length} 个爆款视频，但未识别到符合时间筛选的候选评论`,
        currentUrl: evidenceVideo?.snapshotUrl || searchSnapshot.url,
        title: evidenceVideo?.snapshotTitle || searchSnapshot.title,
        candidates: finalCandidates,
        evidence: {
          type: 'screenshot',
          label: finalCandidates.length
            ? 'douyin-hot-video-comment-read'
            : 'douyin-hot-video-search-read',
          path: evidenceVideo?.evidencePath || searchSnapshot.evidencePath,
          url: evidenceVideo?.evidenceUrl || searchSnapshot.evidenceUrl,
          capturedAt: new Date().toISOString(),
        },
        raw: {
          keyword,
          searchUrl,
          selectedVideoUrl: selectedVideos[0]?.url,
          selectedVideoTitle: selectedVideos[0]?.title,
          selectedVideoEngagementScore: selectedVideos[0]?.engagementScore,
          selectedVideos: selectedVideos.map((item) => ({
            url: item.url,
            title: item.title,
            engagementScore: item.engagementScore,
            likeCount: item.likeCount,
            commentCount: item.commentCount,
            shareCount: item.shareCount,
          })),
          openedVideoCount: openedVideos.length,
          candidateVideoCount,
          commentsPerVideoLimit: perVideoLimit,
          openedVideos,
          videoLinkCount: videoLinks.length,
          textSample:
            evidenceVideo?.textSample ||
            searchSnapshot.textSample.slice(0, 1200),
          filters: input.filters ?? {},
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Douyin hot video exposure collect failed: ${message}`);
      return {
        ok: false,
        status: 'runtime_unavailable',
        message: `抖音爆款视频获客采集失败：${message}`,
        candidates: [],
      };
    }
  }

  async collectTargetedComments(
    input: DouyinSearchExposureCollectorInput,
  ): Promise<DouyinExposureCollectorResult> {
    const requestedTargets = this.uniqueTextList(
      Array.isArray(input.filters?.targetAccounts)
        ? input.filters.targetAccounts
        : input.searchKeywords,
    );
    if (!requestedTargets.length) {
      return {
        ok: false,
        status: 'target_not_found',
        message: '缺少需要进入作品评论区的目标账号',
        candidates: [],
      };
    }

    const requestedLimit = Math.max(1, input.limit ?? 20);
    const targetLimit = Math.min(requestedTargets.length, 5);
    const perTargetCandidateLimit = Math.min(
      Math.max(Math.floor(Number(input.filters?.perTargetLimit ?? 1)) || 1, 1),
      10,
    );
    const perTargetVideoLimit = Math.min(
      Math.max(perTargetCandidateLimit, 1),
      3,
    );
    const perVideoCommentLimit = Math.min(
      Math.max(Math.ceil(requestedLimit / targetLimit), 2),
      8,
    );

    try {
      const session = await this.browser.getOrCreateSession({
        platform: 'douyin',
        accountId: input.accountId,
      });
      const candidates: DouyinExposureCandidate[] = [];
      const scans: Array<Record<string, unknown>> = [];
      let evidence: DouyinExposureCollectorResult['evidence'] | undefined;
      let currentUrl = '';
      let currentTitle = '';

      for (const target of requestedTargets.slice(0, targetLimit)) {
        if (candidates.length >= requestedLimit) break;
        let profileUrl = this.explicitDouyinUserUrl(target);
        let targetName = target;

        if (!profileUrl) {
          const searchUrl = this.buildUserSearchUrl(target);
          await this.browser.open(session.key, searchUrl, {
            waitUntil: 'domcontentloaded',
          });
          await session.page.waitForTimeout(2500).catch(() => undefined);
          const searchSnapshot = await this.browser.readPageSnapshot({
            sessionKey: session.key,
            label: 'douyin-targeted-account-search-read',
            textLimit: 6000,
          });
          currentUrl = searchSnapshot.url;
          currentTitle = searchSnapshot.title;
          evidence = this.snapshotEvidence(
            searchSnapshot,
            'douyin-targeted-account-search-read',
          );
          const diagnosis = this.diagnoseSearch(
            searchSnapshot.textSample,
            searchSnapshot.url,
          );
          if (diagnosis) {
            scans.push({ target, searchUrl, status: diagnosis.status });
            if (
              diagnosis.status === 'account_not_logged_in' ||
              diagnosis.status === 'captcha_required'
            ) {
              return {
                ok: false,
                status: diagnosis.status,
                message: diagnosis.message,
                currentUrl,
                title: currentTitle,
                candidates: [],
                evidence,
                raw: { requestedTargets, scans, filters: input.filters ?? {} },
              };
            }
            continue;
          }
          const accountLinks = await this.extractAccountLinks(
            session.page,
            searchSnapshot.url || searchUrl,
            20,
          );
          const matchedAccount = accountLinks.find((item) =>
            this.matchesExplicitTargetAccount(item.name || '', target),
          );
          if (!matchedAccount) {
            scans.push({
              target,
              searchUrl,
              status: 'target_not_found',
              accountLinkCount: accountLinks.length,
            });
            continue;
          }
          profileUrl = matchedAccount.url;
          targetName = matchedAccount.name || target;
        }

        await this.browser.open(session.key, profileUrl, {
          waitUntil: 'domcontentloaded',
        });
        await session.page.waitForTimeout(2500).catch(() => undefined);
        const profileSnapshot = await this.browser.readPageSnapshot({
          sessionKey: session.key,
          label: 'douyin-targeted-profile-read',
          textLimit: 6000,
        });
        currentUrl = profileSnapshot.url;
        currentTitle = profileSnapshot.title;
        evidence = this.snapshotEvidence(
          profileSnapshot,
          'douyin-targeted-profile-read',
        );
        const identityGate = this.diagnoseIdentityGate(
          profileSnapshot.textSample,
          profileSnapshot.url,
        );
        if (identityGate) {
          scans.push({ target, profileUrl, status: identityGate.status });
          if (
            identityGate.status === 'account_not_logged_in' ||
            identityGate.status === 'captcha_required'
          ) {
            return {
              ok: false,
              status: identityGate.status,
              message: identityGate.message,
              currentUrl,
              title: currentTitle,
              candidates: [],
              evidence,
              raw: { requestedTargets, scans, filters: input.filters ?? {} },
            };
          }
          continue;
        }

        const videoLinks = await this.extractVideoLinks(
          session.page,
          profileSnapshot.url || profileUrl,
          perTargetVideoLimit,
        );
        if (!videoLinks.length) {
          scans.push({
            target,
            targetName,
            profileUrl,
            status: 'target_not_found',
            reason: 'profile_has_no_visible_video',
          });
          continue;
        }

        let targetCandidateCount = 0;
        for (const video of videoLinks.slice(0, perTargetVideoLimit)) {
          if (
            candidates.length >= requestedLimit ||
            targetCandidateCount >= perTargetCandidateLimit
          )
            break;
          await this.browser.open(session.key, video.url, {
            waitUntil: 'domcontentloaded',
          });
          await session.page.waitForTimeout(2500).catch(() => undefined);
          await this.scrollForComments(session.page, perVideoCommentLimit);
          const videoSnapshot = await this.browser.readPageSnapshot({
            sessionKey: session.key,
            label: 'douyin-targeted-comment-read',
            textLimit: 6000,
          });
          currentUrl = videoSnapshot.url;
          currentTitle = videoSnapshot.title;
          evidence = this.snapshotEvidence(
            videoSnapshot,
            'douyin-targeted-comment-read',
          );
          const diagnosis = this.diagnose(
            videoSnapshot.textSample,
            videoSnapshot.url,
          );
          if (diagnosis) {
            scans.push({
              target,
              targetName,
              profileUrl,
              videoUrl: video.url,
              status: diagnosis.status,
            });
            if (
              diagnosis.status === 'account_not_logged_in' ||
              diagnosis.status === 'captcha_required'
            ) {
              return {
                ok: false,
                status: diagnosis.status,
                message: diagnosis.message,
                currentUrl,
                title: currentTitle,
                candidates: [],
                evidence,
                raw: { requestedTargets, scans, filters: input.filters ?? {} },
              };
            }
            continue;
          }
          const extractionInput = {
            sourceUrl: videoSnapshot.url || video.url,
            limit: Math.min(
              perVideoCommentLimit,
              requestedLimit - candidates.length,
              perTargetCandidateLimit - targetCandidateCount,
            ),
            filters: input.filters,
            videoTitle: video.title || videoSnapshot.title,
            videoUrl: video.url,
            engagementScore: video.engagementScore,
            likeCount: video.likeCount,
            commentCount: video.commentCount,
            shareCount: video.shareCount,
            requireCommentTime: true,
          };
          const domCandidates = await this.extractDomCommentCandidates(
            session.page,
            extractionInput,
          );
          const extracted = domCandidates.length
            ? domCandidates
            : this.extractCandidates({
                ...extractionInput,
                text: videoSnapshot.textSample,
              });
          const publicReplyTargets = extracted
            .filter((candidate) => Boolean(candidate.targetName))
            .slice(0, perTargetCandidateLimit - targetCandidateCount)
            .map((candidate) => ({
              ...candidate,
              kind: 'targeted-comment' as const,
            }));
          candidates.push(...publicReplyTargets);
          targetCandidateCount += publicReplyTargets.length;
        }
        scans.push({
          target,
          targetName,
          profileUrl,
          status: targetCandidateCount ? 'collected' : 'target_not_found',
          candidateCount: targetCandidateCount,
          videoCount: videoLinks.length,
        });
      }

      const finalCandidates = this.diversifyHotVideoCandidates(
        candidates,
        requestedLimit,
      );
      return {
        ok: finalCandidates.length > 0,
        status: finalCandidates.length > 0 ? 'collected' : 'target_not_found',
        message: finalCandidates.length
          ? `已进入指定账号作品并读取 ${finalCandidates.length} 条可公开回复的客户评论`
          : '指定账号没有读取到带作者和时间回读的客户评论，本次未生成触达对象。',
        currentUrl,
        title: currentTitle,
        candidates: finalCandidates,
        evidence,
        raw: {
          requestedTargets,
          scans,
          targetCount: requestedTargets.length,
          filters: input.filters ?? {},
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Douyin targeted exposure collect failed: ${message}`);
      return {
        ok: false,
        status: 'runtime_unavailable',
        message: `抖音定向曝光采集失败：${message}`,
        candidates: [],
      };
    }
  }

  async collectRetentionCandidates(
    input: DouyinSearchExposureCollectorInput & { retentionSourceId?: string },
  ): Promise<DouyinExposureCollectorResult> {
    const retentionSourceId = String(input.retentionSourceId || '').trim();
    if (!retentionSourceId) {
      return {
        ok: false,
        status: 'target_not_found',
        message: '缺少可核验的留资或互动来源',
        candidates: [],
      };
    }

    const videoUrl = this.explicitDouyinVideoUrl(retentionSourceId);
    if (videoUrl) {
      const result = await this.collectFromLinks({
        accountId: input.accountId,
        links: [videoUrl],
        limit: input.limit,
        filters: input.filters,
      });
      const candidates = result.candidates
        .filter((candidate) => Boolean(candidate.targetName))
        .map((candidate) => ({
          ...candidate,
          kind: 'retention-comment' as const,
        }));
      return {
        ...result,
        ok: result.ok && candidates.length > 0,
        status:
          result.ok && candidates.length > 0
            ? 'collected'
            : result.ok
              ? 'target_not_found'
              : result.status,
        message:
          result.ok && candidates.length > 0
            ? `已从明确互动来源读取 ${candidates.length} 条可跟进评论`
            : result.ok
              ? '明确互动来源没有读取到带作者回读的客户评论，本次未生成触达对象。'
              : result.message,
        candidates,
        raw: {
          ...(result.raw ?? {}),
          retentionSourceId,
          retentionSourceType: 'video-interaction',
        },
      };
    }

    const profileUrl = this.explicitDouyinUserUrl(retentionSourceId);
    if (!profileUrl) {
      return {
        ok: false,
        status: 'target_not_found',
        message:
          '留资曝光需要明确的抖音视频互动链接或客户主页链接，不能用普通搜索结果冒充客户。',
        candidates: [],
      };
    }

    try {
      const session = await this.browser.getOrCreateSession({
        platform: 'douyin',
        accountId: input.accountId,
      });
      await this.browser.open(session.key, profileUrl, {
        waitUntil: 'domcontentloaded',
      });
      await session.page.waitForTimeout(2500).catch(() => undefined);
      const snapshot = await this.browser.readPageSnapshot({
        sessionKey: session.key,
        label: 'douyin-retention-contact-read',
        textLimit: 6000,
      });
      const diagnosis = this.diagnoseIdentityGate(
        snapshot.textSample,
        snapshot.url,
      );
      const evidence = this.snapshotEvidence(
        snapshot,
        'douyin-retention-contact-read',
      );
      if (diagnosis) {
        return {
          ok: false,
          status: diagnosis.status,
          message: diagnosis.message,
          currentUrl: snapshot.url,
          title: snapshot.title,
          candidates: [],
          evidence,
          raw: { retentionSourceId, retentionSourceType: 'profile' },
        };
      }
      const targetName =
        this.extractAccountName(snapshot.textSample) ||
        this.cleanProfileTitle(snapshot.title);
      if (!targetName) {
        return {
          ok: false,
          status: 'target_not_found',
          message: '客户主页没有回读到可核验的账号名称，本次未生成触达对象。',
          currentUrl: snapshot.url,
          title: snapshot.title,
          candidates: [],
          evidence,
          raw: { retentionSourceId, retentionSourceType: 'profile' },
        };
      }
      return {
        ok: true,
        status: 'collected',
        message: '已从明确留资来源回读客户主页，可进入受控私信跟进。',
        currentUrl: snapshot.url,
        title: snapshot.title,
        candidates: [
          {
            sourceUrl: retentionSourceId,
            profileUrl,
            text: `明确留资客户：${targetName}`,
            targetName,
            index: 0,
            kind: 'retention-contact',
          },
        ],
        evidence,
        raw: { retentionSourceId, retentionSourceType: 'profile' },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Douyin retention exposure collect failed: ${message}`);
      return {
        ok: false,
        status: 'runtime_unavailable',
        message: `抖音留资曝光采集失败：${message}`,
        candidates: [],
      };
    }
  }

  private resolveHotVideoPoolSize(
    limit: number,
    filters?: Record<string, unknown>,
  ) {
    const explicit = Number(
      filters?.videoPoolSize ?? filters?.maxVideoCount ?? filters?.videoCount,
    );
    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.min(Math.max(Math.floor(explicit), 1), 10);
    }
    if (limit <= 3) return 1;
    return Math.min(Math.max(Math.ceil(limit / 2), 3), 8);
  }

  private resolveHotVideoPerVideoLimit(
    limit: number,
    videoCount: number,
    filters?: Record<string, unknown>,
  ) {
    const explicit = Number(
      filters?.commentsPerVideo ?? filters?.perVideoLimit,
    );
    if (Number.isFinite(explicit) && explicit > 0) {
      return Math.min(Math.max(Math.floor(explicit), 1), 10);
    }
    const denominator = Math.max(videoCount - 1, 1);
    return Math.min(Math.max(Math.ceil(limit / denominator), 2), 5);
  }

  private diversifyHotVideoCandidates(
    candidates: DouyinExposureCandidate[],
    limit: number,
  ) {
    const groups = new Map<string, DouyinExposureCandidate[]>();
    const seen = new Set<string>();
    const keyPart = (value: unknown) =>
      (typeof value === 'string'
        ? value
        : value == null
          ? ''
          : (JSON.stringify(value) ?? '')
      )
        .replace(/\s+/g, '')
        .toLowerCase();
    for (const candidate of candidates) {
      const videoKey =
        candidate.videoUrl ||
        candidate.sourceUrl ||
        `unknown-${candidate.index}`;
      const dedupeKey = [
        videoKey,
        candidate.targetName,
        candidate.profileUrl,
        candidate.text,
      ]
        .map(keyPart)
        .filter(Boolean)
        .join('|');
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const bucket = groups.get(videoKey);
      if (bucket) {
        bucket.push(candidate);
      } else {
        groups.set(videoKey, [candidate]);
      }
    }

    const buckets = Array.from(groups.values());
    const diversified: DouyinExposureCandidate[] = [];
    let cursor = 0;
    while (diversified.length < candidates.length) {
      let picked = false;
      for (const bucket of buckets) {
        const candidate = bucket[cursor];
        if (!candidate) continue;
        diversified.push(candidate);
        picked = true;
      }
      if (!picked) break;
      cursor += 1;
    }

    return diversified.slice(0, limit).map((candidate, index) => ({
      ...candidate,
      index,
    }));
  }

  private filterHotVideoCommentCandidates(
    candidates: DouyinExposureCandidate[],
    filters?: Record<string, unknown>,
  ) {
    const blacklistNicknames = this.readStringArrayFilter(
      filters,
      'blacklistNicknames',
    );
    if (!blacklistNicknames.length) return candidates;
    return candidates.filter((candidate) => {
      const targetText =
        `${candidate.targetName || ''} ${candidate.profileUrl || ''}`.trim();
      if (!targetText) return true;
      return !blacklistNicknames.some((keyword) =>
        targetText.includes(keyword),
      );
    });
  }

  private async scrollForComments(
    page: import('playwright').Page,
    limit: number,
  ): Promise<void> {
    const scrollCount = Math.min(Math.max(Math.ceil(limit / 8), 1), 5);
    for (let index = 0; index < scrollCount; index += 1) {
      await page.mouse.wheel(0, 720).catch(() => undefined);
      await page.waitForTimeout(700).catch(() => undefined);
    }
  }

  private diagnose(
    text: string,
    currentUrl: string,
  ): {
    status: DouyinExposureCollectorResult['status'];
    message: string;
  } | null {
    const hasLoadedVideoSignals =
      /全部评论|留下你的精彩评论吧|发布时间[:：]|\/\s*\d{1,2}:\d{2}|分享\s+回复|点赞|评论/.test(
        text,
      );
    if (
      /login|passport|sso/i.test(currentUrl) ||
      (!hasLoadedVideoSignals &&
        /扫码登录|验证码登录|密码登录|请先登录|登录后/.test(text))
    ) {
      return {
        status: 'account_not_logged_in',
        message: '抖音账号未登录，不能采集评论区。',
      };
    }
    if (/验证码|安全验证|滑块|行为验证|验证通过/.test(text)) {
      return {
        status: 'captcha_required',
        message: '抖音页面出现验证码或安全验证。',
      };
    }
    if (/视频不存在|作品不存在|已删除|无法观看|链接无效/.test(text)) {
      return {
        status: 'target_not_found',
        message: '抖音视频不存在或链接无效。',
      };
    }
    if (!/评论|回复|点赞|分钟前|小时前|昨天|今天/.test(text)) {
      return {
        status: 'platform_changed',
        message: '页面未出现评论区信号，可能页面结构变化或内容未加载。',
      };
    }
    return null;
  }

  private diagnoseSearch(
    text: string,
    currentUrl: string,
  ): {
    status: DouyinExposureCollectorResult['status'];
    message: string;
  } | null {
    if (
      /login|passport|sso/i.test(currentUrl) ||
      /登录|扫码|验证码登录|密码登录|请先登录/.test(text)
    ) {
      return {
        status: 'account_not_logged_in',
        message: '抖音账号未登录，不能读取搜索结果。',
      };
    }
    if (/验证码|安全验证|滑块|行为验证|验证通过/.test(text)) {
      return {
        status: 'captcha_required',
        message: '抖音搜索页出现验证码或安全验证。',
      };
    }
    if (/无搜索结果|没有找到|暂无结果|换个关键词/.test(text)) {
      return {
        status: 'target_not_found',
        message: '抖音搜索没有找到候选结果。',
      };
    }
    if (!/搜索|综合|视频|用户|直播|相关搜索|粉丝|获赞|关注/.test(text)) {
      return {
        status: 'platform_changed',
        message: '页面未出现搜索结果信号，可能页面结构变化或内容未加载。',
      };
    }
    return null;
  }

  private diagnoseIdentityGate(
    text: string,
    currentUrl: string,
  ): {
    status: DouyinExposureCollectorResult['status'];
    message: string;
  } | null {
    if (
      /login|passport|sso/i.test(currentUrl) ||
      /扫码登录|验证码登录|密码登录|请先登录|登录后/.test(text)
    ) {
      return {
        status: 'account_not_logged_in',
        message: '抖音账号未登录，不能读取目标主页。',
      };
    }
    if (/验证码|安全验证|滑块|行为验证|验证通过/.test(text)) {
      return {
        status: 'captcha_required',
        message: '抖音目标主页出现验证码或安全验证。',
      };
    }
    if (/用户不存在|账号不存在|主页不存在|已注销/.test(text)) {
      return {
        status: 'target_not_found',
        message: '抖音目标账号不存在或已注销。',
      };
    }
    return null;
  }

  private snapshotEvidence(
    snapshot: {
      evidencePath: string;
      evidenceUrl?: string;
    },
    label: string,
  ): NonNullable<DouyinExposureCollectorResult['evidence']> {
    return {
      type: 'screenshot',
      label,
      path: snapshot.evidencePath,
      url: snapshot.evidenceUrl,
      capturedAt: new Date().toISOString(),
    };
  }

  private explicitDouyinVideoUrl(value: string) {
    if (!/^https?:\/\//i.test(value)) return null;
    return this.normalizeDouyinVideoUrl(value, 'https://www.douyin.com');
  }

  private explicitDouyinUserUrl(value: string) {
    if (!/^https?:\/\//i.test(value)) return null;
    return this.normalizeDouyinUserUrl(value, 'https://www.douyin.com');
  }

  private uniqueTextList(value: unknown[]) {
    return Array.from(
      new Set(value.map((item) => safeText(item || '').trim()).filter(Boolean)),
    );
  }

  private matchesExplicitTargetAccount(
    actualName: string,
    requestedName: string,
  ) {
    const normalize = (value: string) =>
      value.replace(/^@/, '').replace(/\s+/g, '').toLowerCase();
    return normalize(actualName) === normalize(requestedName);
  }

  private cleanProfileTitle(value: string) {
    return String(value || '')
      .replace(/[-_|｜].*抖音.*$/i, '')
      .replace(/抖音.*$/i, '')
      .trim()
      .slice(0, 40);
  }

  private buildSearchUrl(keyword: string): string {
    return `https://www.douyin.com/search/${encodeURIComponent(keyword)}`;
  }

  private buildUserSearchUrl(keyword: string): string {
    const encoded = encodeURIComponent(keyword);
    return `https://www.douyin.com/search/${encoded}?type=user`;
  }

  private extractCandidates(input: {
    sourceUrl: string;
    text: string;
    limit: number;
    filters?: Record<string, unknown>;
    videoTitle?: string;
    videoUrl?: string;
    engagementScore?: number;
    likeCount?: number;
    commentCount?: number;
    shareCount?: number;
    requireCommentTime?: boolean;
  }): DouyinExposureCandidate[] {
    const normalized = input.text
      .replace(/\s+/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const candidates: DouyinExposureCandidate[] = [];
    const timeMatch = this.resolveCommentTimeMatch(input.filters);

    this.extractInlineTimedCommentsFromText(input.text).forEach((item) => {
      if (candidates.length >= input.limit) return;
      if (!this.commentTimeAllowed(item.time, timeMatch)) return;
      if (seen.has(item.text)) return;
      seen.add(item.text);
      candidates.push({
        sourceUrl: input.sourceUrl,
        text: item.text,
        index: candidates.length,
        kind: 'comment',
        targetName: '',
        commentTime: item.time,
        videoTitle: input.videoTitle,
        videoUrl: input.videoUrl || input.sourceUrl,
        engagementScore: input.engagementScore,
        likeCount: input.likeCount,
        commentCount: input.commentCount,
        shareCount: input.shareCount,
      });
    });

    if (candidates.length > 0) {
      return candidates;
    }

    for (let lineIndex = 0; lineIndex < normalized.length; lineIndex += 1) {
      const line = normalized[lineIndex];
      if (candidates.length >= input.limit) break;
      if (line.length < 2 || line.length > 120) continue;
      if (
        /^(评论|全部评论|回复|点赞|分享|收藏|关注|推荐|精选|朋友|我的|直播|放映厅|短剧|首页|搜索|登录|打开抖音|复制链接|清屏|举报|加载中|广告投放|用户服务协议|隐私政策|账号找回|联系我们|加入我们|营业执照|友情链接|站点地图|下载抖音|抖音电商|客户端|壁纸|通知|私信|投稿)$/.test(
          line,
        )
      )
        continue;
      if (/^\d+$/.test(line)) continue;
      if (/^\d+(?:\.\d+)?万?$/.test(line)) continue;
      if (/^\d{1,2}:\d{2}$/.test(line)) continue;
      if (/^第\d+集/.test(line)) continue;
      if (/^发布时间[:：]/.test(line)) continue;
      if (/^(粉丝|获赞)\d/.test(line)) continue;
      if (
        /^(开启读屏标签|读屏标签已关闭|下载抖音精选|网络谣言曝光台)$/.test(line)
      )
        continue;
      if (
        /^(留下你的精彩评论吧|大家都在搜[:：]?|推荐视频|展开\d+条回复)$/.test(
          line,
        )
      )
        continue;
      if (/^大家都在搜[:：]/.test(line)) continue;
      if (/ICP备|公网安备|许可证|举报|feedback@|sfjubao@/.test(line)) continue;
      if (this.isCommentTimeLine(line)) continue;
      if (/\d+年前|[1-9]\d?月前/.test(line) && !/\s+\d+天前/.test(line))
        continue;
      const inlineComment = this.extractInlineTimedComment(line);
      const candidateText = inlineComment?.text || line;
      if (candidateText.length < 2 || candidateText.length > 120) continue;
      const nearbyTime =
        inlineComment?.time ||
        this.findNearbyCommentTime(normalized, lineIndex);
      if (!nearbyTime && input.requireCommentTime) continue;
      if (!this.commentTimeAllowed(nearbyTime, timeMatch)) continue;
      const targetName = this.findNearbyAuthor(normalized, lineIndex);
      if (seen.has(candidateText)) continue;
      seen.add(candidateText);
      candidates.push({
        sourceUrl: input.sourceUrl,
        text: candidateText,
        index: candidates.length,
        kind: 'comment',
        targetName,
        commentTime: nearbyTime,
        videoTitle: input.videoTitle,
        videoUrl: input.videoUrl || input.sourceUrl,
        engagementScore: input.engagementScore,
        likeCount: input.likeCount,
        commentCount: input.commentCount,
        shareCount: input.shareCount,
      });
    }

    return candidates;
  }

  private async extractDomCommentCandidates(
    page: Page,
    input: {
      sourceUrl: string;
      limit: number;
      filters?: Record<string, unknown>;
      videoTitle?: string;
      videoUrl?: string;
      engagementScore?: number;
      likeCount?: number;
      commentCount?: number;
      shareCount?: number;
      requireCommentTime?: boolean;
    },
  ): Promise<DouyinExposureCandidate[]> {
    if (
      typeof (page as unknown as { evaluate?: unknown }).evaluate !== 'function'
    ) {
      return [];
    }
    type DomCommentRow = {
      targetName: string;
      text: string;
      commentTime: string;
      y: number;
      authorTagged: boolean;
    };
    const rows: DomCommentRow[] = await page
      .evaluate((limit) => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0
          );
        };
        const timePattern =
          '(?:刚刚|今天|昨天|\\d+分钟前|\\d+小时前|\\d+天前|\\d+周前|1月前|[2-9]\\d?月前)(?:[·\\s-][\\u4e00-\\u9fffA-Za-z]{1,12})?';
        const rowPattern = new RegExp(
          `^(.{2,40}?)\\s+\\.\\.\\.\\s+(.{2,160}?)\\s+(${timePattern})\\s+(?:\\d+\\s+)?(?:分享\\s+)?回复`,
        );
        const nodes = Array.from(
          document.querySelectorAll(
            '[class*="J1g_n48Z"], [class*="comment-item"], [class*="CommentItem"], [class*="cmt-item"], li, section, div',
          ),
        )
          .filter((node): node is HTMLElement => visible(node))
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const text = normalize(node.innerText || node.textContent);
            return {
              text,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          })
          .filter(
            (item) =>
              item.width >= 180 && item.height >= 40 && item.height <= 180,
          )
          .filter(
            (item) =>
              /回复/.test(item.text) && new RegExp(timePattern).test(item.text),
          )
          .map((item) => {
            const match = item.text.match(rowPattern);
            if (!match) return null;
            const rawTargetName = normalize(match[1]);
            const authorTagged = /\s作者$/.test(rawTargetName);
            const targetName = rawTargetName.replace(/\s+作者$/, '').trim();
            const text = normalize(match[2]);
            const commentTime = normalize(match[3]);
            return {
              targetName,
              text,
              commentTime,
              y: item.y,
              authorTagged,
            };
          })
          .filter((item): item is DomCommentRow =>
            Boolean(item?.targetName && item.text && item.commentTime),
          )
          .filter((item) => !item.authorTagged)
          .filter((item) => !/作者|商家|客服/.test(item.targetName))
          .sort((a, b) => a.y - b.y);
        const seen = new Set<string>();
        const result: DomCommentRow[] = [];
        for (const item of nodes) {
          const key = `${item.targetName}|${item.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(item);
          if (result.length >= limit) break;
        }
        return result;
      }, input.limit)
      .catch(() => [] as DomCommentRow[]);
    const timeMatch = this.resolveCommentTimeMatch(input.filters);
    return rows
      .filter((item) => !item.authorTagged)
      .filter((item) => this.commentTimeAllowed(item.commentTime, timeMatch))
      .map((item) => ({
        ...item,
        text: this.cleanInlineCommentText(item.text),
      }))
      .filter((item) => Boolean(item.text))
      .slice(0, input.limit)
      .map((item, index) => ({
        sourceUrl: input.sourceUrl,
        text: item.text,
        index,
        kind: 'comment' as const,
        targetName: item.targetName,
        commentTime: item.commentTime,
        videoTitle: input.videoTitle,
        videoUrl: input.videoUrl || input.sourceUrl,
        engagementScore: input.engagementScore,
        likeCount: input.likeCount,
        commentCount: input.commentCount,
        shareCount: input.shareCount,
      }));
  }

  private extractInlineTimedCommentsFromText(
    text: string,
  ): Array<{ text: string; time: string }> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const results: Array<{ text: string; time: string }> = [];
    const pattern =
      /(.{2,120}?)\s+((?:刚刚|今天|昨天|\d+分钟前|\d+小时前|\d+天前|\d+周前|1月前|[2-9]\d?月前)(?:[·\s-][\u4e00-\u9fffA-Za-z]{1,12})?)\s+(?:\d+\s+)?(?:分享\s+)?(?:回复|点赞)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const candidate = this.cleanInlineCommentText(match[1]);
      if (!candidate) continue;
      results.push({ text: candidate, time: match[2].trim() });
    }
    return results;
  }

  private cleanInlineCommentText(value: string): string {
    const text = value
      .replace(/.*?(?:全部评论|留下你的精彩评论吧|展开\d+条回复|回复)\s+/g, '')
      .replace(/^评论\s+/, '')
      .replace(/^.*?\.\.\.\s+/, '')
      .replace(/^\d+\s+/, '')
      .replace(/\s*(?:作者回复过|作者赞过|置顶|翻译)(?:\s|$)/g, ' ')
      .trim();
    if (!text) return '';
    if (this.isCommentTimeLine(text)) return '';
    if (/^(评论|全部评论|回复|分享|展开\d+条回复|加载中)$/.test(text))
      return '';
    if (/ICP备|公网安备|许可证|举报|feedback@|sfjubao@/.test(text)) return '';
    return text;
  }

  private extractInlineTimedComment(
    line: string,
  ): { text: string; time: string } | null {
    const text = line.trim();
    const match = text.match(
      /^(.*?)\s*((?:刚刚|今天|昨天|\d+分钟前|\d+小时前|\d+天前|\d+周前|1月前|[2-9]\d?月前)(?:[·\s-][^·\s]+)?)\s*(?:\d+\s*)?(?:分享\s*)?(?:回复.*)?$/,
    );
    if (!match?.[1] || !match[2]) return null;
    const commentText = this.cleanInlineCommentText(match[1]);
    if (!commentText || this.isCommentTimeLine(commentText)) return null;
    return {
      text: commentText,
      time: match[2].trim(),
    };
  }

  private async extractVideoLinks(
    page: Page,
    baseUrl: string,
    limit: number,
  ): Promise<
    Array<{
      url: string;
      title?: string;
      engagementScore: number;
      likeCount?: number;
      commentCount?: number;
      shareCount?: number;
    }>
  > {
    const rawLinks = await this.readRawVideoLinks(page);
    const seen = new Set<string>();
    const links: Array<{
      url: string;
      title?: string;
      engagementScore: number;
      likeCount?: number;
      commentCount?: number;
      shareCount?: number;
    }> = [];
    for (const item of rawLinks) {
      const normalized = this.normalizeDouyinVideoUrl(
        item.videoId || item.href,
        baseUrl,
      );
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      const metrics = this.extractEngagementMetrics(item.text);
      links.push({
        url: normalized,
        title: this.extractVideoTitle(item.text),
        ...metrics,
      });
    }
    return links
      .sort((left, right) => right.engagementScore - left.engagementScore)
      .slice(0, limit);
  }

  private async readRawVideoLinks(page: Page): Promise<RawDouyinVideoLink[]> {
    return page
      .locator(
        [
          'a[href]',
          '.search-result-card',
          '[id^="waterfall_item_"]',
          '[role="link"]',
          '[data-e2e]',
          '[data-id]',
          '[data-item-id]',
          '[data-aweme-id]',
          '[data-log-extra]',
          '[aria-label]',
        ].join(', '),
      )
      .evaluateAll((nodes) => {
        const readAttributeValues = (element: Element) =>
          Array.from(element.attributes || [])
            .map((attribute) => attribute.value)
            .filter(Boolean);
        const idPatterns = [
          /\/video\/(\d{8,})/i,
          /waterfall_item_(\d{8,})/i,
          /[?&]modal_id=(\d{8,})/i,
          /[?&]aweme_id=(\d{8,})/i,
          /[?&]item_id=(\d{8,})/i,
          /[?&]group_id=(\d{8,})/i,
          /["'](?:modal_id|aweme_id|awemeId|item_id|itemId|group_id|groupId)["']\s*:\s*["']?(\d{8,})/i,
          /(?:modal_id|aweme_id|awemeId|item_id|itemId|group_id|groupId)[=:]\s*["']?(\d{8,})/i,
        ];
        const findVideoId = (value: string) => {
          let text = value;
          try {
            text = decodeURIComponent(text);
          } catch {
            // Keep original text when browser data is not URI encoded.
          }
          for (const pattern of idPatterns) {
            const match = text.match(pattern);
            if (match?.[1]) return match[1];
          }
          return '';
        };
        const readHref = (element: Element) => {
          const ownHref =
            element instanceof HTMLAnchorElement
              ? element.href || element.getAttribute('href') || ''
              : element.getAttribute('href') || '';
          if (ownHref) return ownHref;
          const closestAnchor = element.closest(
            'a[href]',
          ) as HTMLAnchorElement | null;
          if (closestAnchor) {
            return (
              closestAnchor.href || closestAnchor.getAttribute('href') || ''
            );
          }
          const childAnchor = element.querySelector(
            'a[href]',
          ) as HTMLAnchorElement | null;
          return childAnchor?.href || childAnchor?.getAttribute('href') || '';
        };
        const records: RawDouyinVideoLink[] = [];

        for (const node of nodes.slice(0, 400)) {
          if (!(node instanceof Element)) continue;
          const container =
            node.closest('[data-e2e], article, li, [role="listitem"], div') ||
            node;
          const text = (container.textContent || node.textContent || '').slice(
            0,
            1000,
          );
          const href = readHref(node);
          const values = [
            href,
            ...readAttributeValues(node),
            ...readAttributeValues(container),
          ];
          const videoId = values.map(findVideoId).find(Boolean) || '';
          if (!href && !videoId) continue;
          records.push({ href, text, videoId: videoId || undefined });
        }

        return records;
      })
      .catch(() => []);
  }

  private normalizeDouyinVideoUrl(
    href: string,
    baseUrl: string,
  ): string | null {
    const videoId = this.extractDouyinVideoId(href);
    if (videoId) return `https://www.douyin.com/video/${videoId}`;

    try {
      const url = new URL(href, baseUrl);
      if (!/(^|\.)douyin\.com$/i.test(url.hostname)) return null;
      const isVideoUrl =
        /\/video\/\d+/.test(url.pathname) ||
        (url.searchParams.has('modal_id') && /\/search\//.test(url.pathname));
      if (!isVideoUrl) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  private extractDouyinVideoId(value: string): string | null {
    if (/^\d{8,}$/.test(value.trim())) return value.trim();

    const candidates = [value];
    try {
      candidates.push(decodeURIComponent(value));
    } catch {
      // Ignore malformed encoded strings.
    }

    for (const candidate of candidates) {
      const directPath = candidate.match(/\/video\/(\d{8,})/i);
      if (directPath?.[1]) return directPath[1];
      const waterfallItem = candidate.match(/waterfall_item_(\d{8,})/i);
      if (waterfallItem?.[1]) return waterfallItem[1];
      const labeled = candidate.match(
        /(?:modal_id|aweme_id|awemeId|item_id|itemId|group_id|groupId)[=:]\s*["']?(\d{8,})/i,
      );
      if (labeled?.[1]) return labeled[1];
      const jsonLike = candidate.match(
        /["'](?:modal_id|aweme_id|awemeId|item_id|itemId|group_id|groupId)["']\s*:\s*["']?(\d{8,})/i,
      );
      if (jsonLike?.[1]) return jsonLike[1];
    }

    try {
      const url = new URL(value, 'https://www.douyin.com');
      const id =
        url.searchParams.get('modal_id') ||
        url.searchParams.get('aweme_id') ||
        url.searchParams.get('item_id') ||
        url.searchParams.get('group_id');
      return id && /^\d{8,}$/.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  private resolveCommentTimeMatch(
    filters: Record<string, unknown> | undefined,
  ) {
    const value = safeText(filters?.commentTimeMatch || '').toLowerCase();
    if (
      value === 'today' ||
      value === 'yesterday' ||
      value === '30days' ||
      value === 'none'
    ) {
      return value;
    }
    return '7days';
  }

  private findNearbyCommentTime(lines: string[], index: number): string {
    const neighbors = [
      lines[index + 1],
      lines[index + 2],
      lines[index - 1],
      lines[index - 2],
    ].filter(Boolean);
    return neighbors.find((line) => this.isCommentTimeLine(line)) || '';
  }

  private findNearbyAuthor(lines: string[], index: number): string {
    const candidates = [
      lines[index - 1],
      lines[index - 2],
      lines[index - 3],
    ].filter(Boolean);
    return candidates.find((line) => this.isLikelyAuthorName(line)) || '';
  }

  private isLikelyAuthorName(line: string) {
    const text = line.trim();
    if (text.length < 2 || text.length > 32) return false;
    if (this.isCommentTimeLine(text)) return false;
    if (
      /^(评论|回复|点赞|分享|收藏|关注|推荐|首页|搜索|登录|打开抖音|复制链接)$/.test(
        text,
      )
    )
      return false;
    if (/^\d+$/.test(text)) return false;
    return !/[。！？?!，,]/.test(text);
  }

  private isCommentTimeLine(line: string) {
    return /^(刚刚|今天|昨天|\d+分钟前|\d+小时前|\d+天前|\d+周前|1月前|[2-9]\d?月前|\d{4}[-/]\d{1,2}[-/]\d{1,2})$/.test(
      line.trim(),
    );
  }

  private commentTimeAllowed(
    timeText: string,
    match: 'today' | 'yesterday' | '7days' | '30days' | 'none',
  ) {
    if (match === 'none') return true;
    if (!timeText) return match === '7days' || match === '30days';
    if (/刚刚|今天|\d+分钟前|\d+小时前/.test(timeText)) return true;
    if (match === 'today') return false;
    if (/昨天/.test(timeText))
      return match === 'yesterday' || match === '7days' || match === '30days';
    const dayMatch = timeText.match(/(\d+)天前/);
    if (dayMatch) {
      const days = Number(dayMatch[1]);
      if (!Number.isFinite(days)) return false;
      if (match === 'yesterday') return days === 1;
      if (match === '7days') return days <= 7;
      if (match === '30days') return days <= 30;
      return false;
    }
    const weekMatch = timeText.match(/(\d+)周前/);
    if (weekMatch) {
      const weeks = Number(weekMatch[1]);
      if (!Number.isFinite(weeks)) return false;
      if (match === '7days') return weeks <= 1;
      if (match === '30days') return weeks <= 4;
      return false;
    }
    if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(timeText)) {
      return match === '30days';
    }
    const monthMatch = timeText.match(/(\d+)月前/);
    if (monthMatch) {
      return match === '30days' && Number(monthMatch[1]) <= 1;
    }
    return false;
  }

  private extractEngagementMetrics(text: string): {
    engagementScore: number;
    likeCount?: number;
    commentCount?: number;
    shareCount?: number;
  } {
    const likeCount =
      this.extractMetric(text, ['点赞', '赞', '获赞']) ??
      this.extractCompactCardLikeCount(text);
    const commentCount = this.extractMetric(text, ['评论']);
    const shareCount = this.extractMetric(text, ['分享', '转发']);
    return {
      engagementScore:
        (likeCount ?? 0) + (commentCount ?? 0) * 3 + (shareCount ?? 0) * 2,
      likeCount,
      commentCount,
      shareCount,
    };
  }

  private extractMetric(text: string, labels: string[]): number | undefined {
    for (const label of labels) {
      const before = new RegExp(
        `${label}\\s*([0-9]+(?:\\.[0-9]+)?)(万|w|W|k|K)?`,
      );
      const after = new RegExp(
        `([0-9]+(?:\\.[0-9]+)?)(万|w|W|k|K)?\\s*${label}`,
      );
      const match = text.match(before) || text.match(after);
      if (match) return this.parseMetricNumber(match[1], match[2]);
    }
    return undefined;
  }

  private extractCompactCardLikeCount(text: string): number | undefined {
    const compact = text.replace(/\s+/g, '');
    const videoCard = compact.match(
      /(?:^|[^0-9])\d{1,2}:\d{2}([0-9]+?(?:\.[0-9]+)?)(万|w|W|k|K)?(?=(?:19|20)\d{2}年|[\u4e00-\u9fff#@A-Za-z])/,
    );
    if (videoCard?.[1]) {
      return this.parseMetricNumber(videoCard[1], videoCard[2]);
    }

    const imageCard = compact.match(
      /(?:^|[^0-9])图文([0-9]+(?:\.[0-9]+)?)(万|w|W|k|K)?(?=[\u4e00-\u9fff#@A-Za-z])/,
    );
    if (imageCard?.[1]) {
      return this.parseMetricNumber(imageCard[1], imageCard[2]);
    }

    return undefined;
  }

  private parseMetricNumber(value: string, unit?: string): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (unit === '万' || unit === 'w' || unit === 'W')
      return Math.round(numeric * 10000);
    if (unit === 'k' || unit === 'K') return Math.round(numeric * 1000);
    return Math.round(numeric);
  }

  private extractVideoTitle(text: string): string | undefined {
    const normalizedTitle = text.replace(/\s+/g, ' ').trim();
    const compactTitle = normalizedTitle
      .replace(
        /^(?:\d{1,2}:\d{2}|图文)\s*[0-9]+?(?:\.[0-9]+)?(?:万|w|W|k|K)?(?=(?:19|20)\d{2}年|[\u4e00-\u9fff#@A-Za-z])/,
        '',
      )
      .replace(/点赞\s*[0-9]+(?:\.[0-9]+)?(?:万|w|W|k|K)?/g, '')
      .replace(/评论\s*[0-9]+(?:\.[0-9]+)?(?:万|w|W|k|K)?/g, '')
      .replace(/分享\s*[0-9]+(?:\.[0-9]+)?(?:万|w|W|k|K)?/g, '')
      .split('@')[0]
      .trim();
    if (compactTitle.length >= 4 && compactTitle.length <= 80) {
      return compactTitle;
    }

    const lines = text
      .replace(/\s+/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.find(
      (line) =>
        line.length >= 4 &&
        line.length <= 80 &&
        !/^(点赞|评论|分享|收藏|关注|粉丝|获赞|搜索|综合|视频|用户)$/.test(
          line,
        ) &&
        !this.isCommentTimeLine(line),
    );
  }

  private extractSearchCandidates(input: {
    sourceUrl: string;
    text: string;
    limit: number;
    filters?: Record<string, unknown>;
    accountLinks?: Array<{
      url: string;
      name?: string;
      followers?: number;
      likes?: number;
      works?: number;
    }>;
    videoLinks?: Array<{
      url: string;
      title?: string;
      engagementScore: number;
      likeCount?: number;
      commentCount?: number;
      shareCount?: number;
    }>;
  }): DouyinExposureCandidate[] {
    if (input.filters?.targetedMode === true) {
      return this.extractTargetedAccountCandidates(input);
    }

    const linkedAccountCandidates = this.buildLinkedAccountCandidates(input);
    if (linkedAccountCandidates.length > 0) {
      return linkedAccountCandidates;
    }

    const linkedCandidates = this.buildLinkedSearchCandidates(input);
    if (linkedCandidates.length > 0) {
      return linkedCandidates;
    }

    const normalized = input.text
      .replace(/\s+/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const resultStartIndex = normalized.findIndex((line) =>
      /^(为你找到以下结果|搜索结果|相关视频|相关用户)/.test(line),
    );
    const hasAccountMetricSignal = normalized.some((line) =>
      /^(粉丝|获赞|作品)\s*[0-9]/.test(line),
    );
    const hasInlineMetricSignal = /(?:粉丝|获赞|作品)\s*[0-9]/.test(input.text);
    if (
      resultStartIndex < 0 &&
      !hasAccountMetricSignal &&
      !hasInlineMetricSignal
    ) {
      return [];
    }
    const searchLines =
      resultStartIndex >= 0
        ? normalized.slice(resultStartIndex + 1)
        : normalized;
    const seen = new Set<string>();
    const candidates: DouyinExposureCandidate[] = [];

    for (const line of searchLines) {
      if (candidates.length >= input.limit) break;
      const cleaned = this.cleanSearchCandidateLine(line);
      if (!cleaned) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      candidates.push({
        sourceUrl: input.sourceUrl,
        text: cleaned,
        index: candidates.length,
        kind: 'search-result',
      });
    }

    return candidates;
  }

  private filterSearchAccountCandidates(
    candidates: DouyinExposureCandidate[],
    filters?: Record<string, unknown>,
  ) {
    const nicknameKeywords = this.readStringArrayFilter(
      filters,
      'nicknameKeywords',
    );
    const blacklistNicknames = this.readStringArrayFilter(
      filters,
      'blacklistNicknames',
    );
    const enterpriseOnly = filters?.enterpriseOnly === true;

    return candidates.filter((candidate) => {
      const targetText =
        `${candidate.targetName || ''} ${candidate.text || ''}`.trim();
      if (!targetText) return false;
      if (
        nicknameKeywords.length > 0 &&
        !nicknameKeywords.some((keyword) => targetText.includes(keyword))
      ) {
        return false;
      }
      if (
        blacklistNicknames.length > 0 &&
        blacklistNicknames.some((keyword) => targetText.includes(keyword))
      ) {
        return false;
      }
      if (
        enterpriseOnly &&
        !/(企业号|企业认证|蓝V|官方|旗舰店|认证)/.test(targetText)
      ) {
        return false;
      }
      return true;
    });
  }

  private readStringArrayFilter(
    filters: Record<string, unknown> | undefined,
    key: string,
  ) {
    const value = filters?.[key];
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  private buildLinkedSearchCandidates(input: {
    sourceUrl: string;
    text: string;
    limit: number;
    filters?: Record<string, unknown>;
    videoLinks?: Array<{
      url: string;
      title?: string;
      engagementScore: number;
      likeCount?: number;
      commentCount?: number;
      shareCount?: number;
    }>;
  }): DouyinExposureCandidate[] {
    const links = input.videoLinks || [];
    const candidates: DouyinExposureCandidate[] = [];
    const seen = new Set<string>();
    for (const link of links) {
      if (candidates.length >= input.limit) break;
      const text = this.cleanSearchCandidateLine(link.title || '');
      if (!text || !link.url || seen.has(link.url)) continue;
      seen.add(link.url);
      candidates.push({
        sourceUrl: input.sourceUrl,
        text,
        index: candidates.length,
        kind: 'search-result',
        targetName: text,
        videoTitle: text,
        videoUrl: link.url,
        engagementScore: link.engagementScore,
        likeCount: link.likeCount,
        commentCount: link.commentCount,
        shareCount: link.shareCount,
      });
    }
    return candidates;
  }

  private buildLinkedAccountCandidates(input: {
    sourceUrl: string;
    limit: number;
    accountLinks?: Array<{
      url: string;
      name?: string;
      followers?: number;
      likes?: number;
      works?: number;
    }>;
  }): DouyinExposureCandidate[] {
    const links = input.accountLinks || [];
    const candidates: DouyinExposureCandidate[] = [];
    const seen = new Set<string>();
    for (const link of links) {
      if (candidates.length >= input.limit) break;
      const name = this.cleanSearchCandidateLine(link.name || '');
      if (!name || !link.url || seen.has(link.url)) continue;
      seen.add(link.url);
      candidates.push({
        sourceUrl: input.sourceUrl,
        text: name,
        index: candidates.length,
        kind: 'search-result',
        targetName: name,
        profileUrl: link.url,
        engagementScore: (link.followers ?? 0) + (link.likes ?? 0),
        likeCount: link.likes,
        commentCount: link.works,
        shareCount: 0,
      });
    }
    return candidates;
  }

  private async extractAccountLinks(
    page: Page,
    baseUrl: string,
    limit: number,
  ): Promise<
    Array<{
      url: string;
      name?: string;
      followers?: number;
      likes?: number;
      works?: number;
    }>
  > {
    const rawLinks = await this.readRawAccountLinks(page);
    const seen = new Set<string>();
    const links: Array<{
      url: string;
      name?: string;
      followers?: number;
      likes?: number;
      works?: number;
    }> = [];
    for (const item of rawLinks) {
      const normalized = this.normalizeDouyinUserUrl(
        item.userId || item.href,
        baseUrl,
      );
      if (!normalized || seen.has(normalized)) continue;
      const name = this.extractAccountName(item.text);
      if (!name) continue;
      seen.add(normalized);
      links.push({
        url: normalized,
        name,
        followers: this.extractMetric(item.text, ['粉丝']),
        likes: this.extractMetric(item.text, ['获赞']),
        works: this.extractMetric(item.text, ['作品']),
      });
    }
    return links.slice(0, limit);
  }

  private async readRawAccountLinks(
    page: Page,
  ): Promise<RawDouyinAccountLink[]> {
    return page
      .locator(
        [
          'a[href*="/user/"]',
          'a[href*="/share/user/"]',
          '[data-e2e*="user"] a[href]',
          '[href*="sec_uid"]',
          '[data-sec-uid]',
          '[data-user-id]',
          '[data-uid]',
          '[data-log-extra]',
        ].join(', '),
      )
      .evaluateAll((nodes) => {
        const readAttributeValues = (element: Element) =>
          Array.from(element.attributes || [])
            .map((attribute) => attribute.value)
            .filter(Boolean);
        const userPatterns = [
          /\/user\/([A-Za-z0-9_-]{6,})/i,
          /\/share\/user\/([A-Za-z0-9_-]{6,})/i,
          /[?&]sec_uid=([^&#]+)/i,
          /["'](?:sec_uid|secUid|user_id|userId|uid)["']\s*:\s*["']?([^"',}\s]+)/i,
          /(?:sec_uid|secUid|user_id|userId|uid)[=:]\s*["']?([^"',}\s]+)/i,
        ];
        const findUserId = (value: string) => {
          let text = value;
          try {
            text = decodeURIComponent(text);
          } catch {
            // Keep original DOM value when it is not URI encoded.
          }
          for (const pattern of userPatterns) {
            const match = text.match(pattern);
            if (match?.[1]) return match[1];
          }
          return '';
        };
        const readHref = (element: Element) => {
          const ownHref =
            element instanceof HTMLAnchorElement
              ? element.href || element.getAttribute('href') || ''
              : element.getAttribute('href') || '';
          if (ownHref) return ownHref;
          const closestAnchor = element.closest(
            'a[href]',
          ) as HTMLAnchorElement | null;
          if (closestAnchor) {
            return (
              closestAnchor.href || closestAnchor.getAttribute('href') || ''
            );
          }
          const childAnchor = element.querySelector(
            'a[href]',
          ) as HTMLAnchorElement | null;
          return childAnchor?.href || childAnchor?.getAttribute('href') || '';
        };
        const records: RawDouyinAccountLink[] = [];

        for (const node of nodes.slice(0, 300)) {
          if (!(node instanceof Element)) continue;
          const container =
            node.closest('[data-e2e], article, li, [role="listitem"], div') ||
            node;
          const text = (container.textContent || node.textContent || '').slice(
            0,
            1000,
          );
          const href = readHref(node);
          const values = [
            href,
            ...readAttributeValues(node),
            ...readAttributeValues(container),
          ];
          const userId = values.map(findUserId).find(Boolean) || '';
          if (!href && !userId) continue;
          records.push({ href, text, userId: userId || undefined });
        }

        return records;
      })
      .catch(() => []);
  }

  private normalizeDouyinUserUrl(href: string, baseUrl: string): string | null {
    const userId = this.extractDouyinUserId(href);
    if (userId)
      return `https://www.douyin.com/user/${encodeURIComponent(userId)}`;

    try {
      const url = new URL(href, baseUrl);
      if (!/(^|\.)douyin\.com$/i.test(url.hostname)) return null;
      if (!/\/(?:user|share\/user)\//.test(url.pathname)) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  private extractDouyinUserId(value: string): string | null {
    const trimmed = value.trim();
    if (/^[A-Za-z0-9_-]{8,}$/.test(trimmed) && !/^\d{8,}$/.test(trimmed)) {
      return trimmed;
    }

    const candidates = [value];
    try {
      candidates.push(decodeURIComponent(value));
    } catch {
      // Ignore malformed encoded strings.
    }

    for (const candidate of candidates) {
      const directPath = candidate.match(/\/user\/([A-Za-z0-9_-]{6,})/i);
      if (directPath?.[1]) return directPath[1];
      const sharePath = candidate.match(/\/share\/user\/([A-Za-z0-9_-]{6,})/i);
      if (sharePath?.[1]) return sharePath[1];
      const labeled = candidate.match(
        /(?:sec_uid|secUid|user_id|userId|uid)[=:]\s*["']?([^"',}\s]+)/i,
      );
      if (labeled?.[1]) return labeled[1];
      const jsonLike = candidate.match(
        /["'](?:sec_uid|secUid|user_id|userId|uid)["']\s*:\s*["']?([^"',}\s]+)/i,
      );
      if (jsonLike?.[1]) return jsonLike[1];
    }

    try {
      const url = new URL(value, 'https://www.douyin.com');
      return url.searchParams.get('sec_uid') || null;
    } catch {
      return null;
    }
  }

  private extractAccountName(text: string): string {
    const inlineName = this.extractInlineAccountName(text);
    if (inlineName) return inlineName;

    const lines = text
      .replace(/\s+/g, '\n')
      .split('\n')
      .map((line) => this.cleanSearchCandidateLine(line))
      .filter(Boolean);
    const metricIndex = lines.findIndex((line) => /粉丝|获赞|作品/.test(line));
    const beforeMetric =
      metricIndex > 0 ? lines.slice(0, metricIndex).reverse() : lines;
    return (
      beforeMetric.find((line) => this.looksLikeSearchBusinessLead(line)) || ''
    );
  }

  private extractInlineAccountName(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (!flat) return '';
    const beforeFollowHint = flat.split(/关注抖音号[:：]?/)[0]?.trim() || flat;
    const metricMatch = beforeFollowHint.match(
      /^(.*?)(?:[0-9]+(?:\.[0-9]+)?(?:万|w|W|k|K)?\s*)?(?:获赞|粉丝|作品)(?=\s|[:：0-9]|$)/,
    );
    const rawName = (metricMatch?.[1] || beforeFollowHint)
      .replace(/[0-9]+(?:\.[0-9]+)?(?:万|w|W|k|K)?$/, '')
      .replace(/[:：｜|·-]+$/, '')
      .trim();
    const cleaned = this.cleanSearchCandidateLine(rawName);
    if (cleaned && cleaned.length <= 40) return cleaned;
    return '';
  }

  private extractTargetedAccountCandidates(input: {
    sourceUrl: string;
    text: string;
    limit: number;
    filters?: Record<string, unknown>;
  }): DouyinExposureCandidate[] {
    const rawTargetAccounts = Array.isArray(input.filters?.targetAccounts)
      ? input.filters?.targetAccounts
      : [];
    const requestedTargets = new Set(
      rawTargetAccounts
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    );
    const normalizedText = input.text.replace(/\s+/g, ' ').trim();
    const accountPattern =
      /([^\s#@：:]{2,32})\s+粉丝[:：]\s*([0-9]+(?:\.[0-9]+)?)(万|w|W|k|K)?\s+获赞[:：]\s*([0-9]+(?:\.[0-9]+)?)(万|w|W|k|K)?/g;
    const candidates: DouyinExposureCandidate[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    while (
      candidates.length < input.limit &&
      (match = accountPattern.exec(normalizedText)) !== null
    ) {
      const name = match[1]?.trim();
      if (!name || seen.has(name)) continue;
      if (
        requestedTargets.size > 0 &&
        !this.matchesRequestedTarget(name, requestedTargets)
      ) {
        const suggestionText =
          this.extractSearchCorrectionTarget(normalizedText);
        if (suggestionText !== name) continue;
      }
      const followers = this.parseMetricNumber(match[2] || '0', match[3]);
      const likes = this.parseMetricNumber(match[4] || '0', match[5]);
      seen.add(name);
      candidates.push({
        sourceUrl: input.sourceUrl,
        text: name,
        index: candidates.length,
        kind: 'search-result',
        targetName: name,
        profileUrl: input.sourceUrl,
        engagementScore: followers + likes,
        likeCount: likes,
        commentCount: 0,
        shareCount: 0,
      });
    }

    return candidates;
  }

  private extractSearchCorrectionTarget(text: string) {
    return text.match(/你是不是想找[:：]\s*([^\s#@：:]{2,32})/)?.[1] || '';
  }

  private matchesRequestedTarget(name: string, requestedTargets: Set<string>) {
    for (const target of requestedTargets) {
      if (name.includes(target) || target.includes(name)) return true;
    }
    return false;
  }

  private cleanSearchCandidateLine(line: string): string {
    const raw = line.trim();
    if (/^(?:19|20)\d{2}年\d{1,2}月\d{1,2}日$/.test(raw)) {
      return '';
    }
    if (/^\d{1,2}月\d{1,2}日$/.test(raw)) {
      return '';
    }
    const normalized = line
      .replace(/\s+/g, ' ')
      .replace(/^(?:\d{1,2}:\d{2}|图文)\s*/, '')
      .replace(/^[0-9]+(?:\.[0-9]+)?(?:万|w|W|k|K)?\s+/, '')
      .replace(/@[\u4e00-\u9fffA-Za-z0-9_（）()·.-]{2,32}.*$/, '')
      .replace(/#.+$/, '')
      .trim();
    if (!this.isValidSearchCandidateLine(normalized)) return '';
    return normalized;
  }

  private isValidSearchCandidateLine(line: string) {
    if (line.length < 3 || line.length > 100) return false;
    if (this.isDouyinNavigationOrChromeText(line)) return false;
    if (/^[#@]/.test(line)) return false;
    if (!/[\u4e00-\u9fff]/.test(line)) return false;
    if (/^\d+$/.test(line)) return false;
    if (/^\d{3,4}-\d{3,4}-\d{3,4}$/.test(line)) return false;
    if (/^[a-z0-9_.+-]+$/i.test(line)) return false;
    if (/^\d{8,}号$/.test(line)) return false;
    if (/^京[A-Z0-9-]+$/i.test(line)) return false;
    if (/^京[（(]\d{4}[）)]\d+$/i.test(line)) return false;
    if (/^[（(].+[）)]字第?\d+号$/.test(line)) return false;
    if (/^\d+(?:\.\d+)?(?:万|w|W|k|K)?$/.test(line)) return false;
    if (/^\d{1,2}:\d{2}$/.test(line)) return false;
    if (/^(?:19|20)\d{2}年\d{1,2}月\d{1,2}日$/.test(line)) {
      return false;
    }
    if (/^\d{1,2}月\d{1,2}日$/.test(line)) return false;
    if (/^第\d+集/.test(line)) return false;
    if (/^(粉丝|获赞|作品|分钟前|小时前|昨天|今天)$/.test(line)) return false;
    if (/^(粉丝|获赞|作品|点赞|评论|分享)\s*[0-9]/.test(line)) return false;
    if (
      /ICP备|公网安备|许可证|举报|feedback@|sfjubao@|网文|网药械|宗教信息|新闻信息|营业执照|备案/.test(
        line,
      )
    )
      return false;
    if (
      /^(大家都在搜|相关搜索|推荐视频|展开\d+条回复|留下你的精彩评论吧|为你找到以下结果|问问AI)/.test(
        line,
      )
    )
      return false;
    if (
      /^(精选|推荐|搜索|关注|朋友|我的|直播|放映厅|短剧|下载抖音精选)\b/.test(
        line,
      )
    )
      return false;
    if (
      /用户服务协议|隐私政策|营业执照|友情链接|站点地图|客户端|壁纸|通知|投稿/.test(
        line,
      )
    )
      return false;
    if (!this.looksLikeSearchBusinessLead(line)) return false;
    if (this.isCommentTimeLine(line)) return false;
    return /[\u4e00-\u9fffA-Za-z0-9]/.test(line);
  }

  private looksLikeSearchBusinessLead(line: string) {
    if (
      /[\u4e00-\u9fff].{2,}/.test(line) &&
      /案例|教程|老板|门店|加盟|创业|获客|引流|运营|探店|餐饮|装修|本地|客户|私域|实体|开店|生意|项目|招商|资料|合作|咨询/.test(
        line,
      )
    ) {
      return true;
    }
    if (/粉丝\s*\d|获赞\s*\d|作品\s*\d|评论\s*\d|点赞\s*\d/.test(line)) {
      return true;
    }
    if (
      /^[\u4e00-\u9fffA-Za-z0-9_（）()·.-]{3,32}$/.test(line) &&
      /[\u4e00-\u9fff]/.test(line) &&
      !/[。！？?!，,：:]/.test(line)
    ) {
      return true;
    }
    return false;
  }

  private isDouyinNavigationOrChromeText(line: string) {
    return /^(搜索|综合|视频|用户|直播|音乐|话题|地点|筛选|最新|最热|推荐|关注|登录|打开抖音|打开看看|下载抖音|下载抖音精选|精选|朋友|我的|首页|商城|消息|我|清屏|复制链接|举报|加载中|广告投放|用户服务协议|隐私政策|账号找回|联系我们|加入我们|营业执照|友情链接|站点地图|抖音电商|客户端|壁纸|通知|私信|投稿|放映厅|短剧|充值|多列|单列|开启读屏标签|读屏标签已关闭|网络谣言曝光台|网上有害信息举报|违法和不良信息举报)$/.test(
      line,
    );
  }
}
