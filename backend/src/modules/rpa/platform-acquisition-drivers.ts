import type { DiscoveryBrowserRunner } from '../discovery/discovery-browser-runner';
import { SearchWebRpaDriver } from './search-web-rpa.driver';

/**
 * 三平台独立获客 Driver（复核：P1-3 平台驱动拆分）。
 *
 * 各自固化 platform/displayName，独立注册、独立审计；
 * 平台特定逻辑（搜索入口/结果解析/详情进入/评论加载）由基类按 platform 分发，
 * 但每个平台是可独立替换、独立验收的 Driver 实例。
 */

export class DouyinAcquisitionDriver extends SearchWebRpaDriver {
  constructor(runner: DiscoveryBrowserRunner) {
    super('douyin', '抖音', runner);
  }
}

export class XhsAcquisitionDriver extends SearchWebRpaDriver {
  constructor(runner: DiscoveryBrowserRunner) {
    super('xiaohongshu', '小红书', runner);
  }
}

export class KuaishouAcquisitionDriver extends SearchWebRpaDriver {
  constructor(runner: DiscoveryBrowserRunner) {
    super('kuaishou', '快手', runner);
  }
}
