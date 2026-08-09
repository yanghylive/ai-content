/**
 * 平台因社区规范/风控/权限拒绝发布时抛出的错误。
 * 由 service 的 isPlatformPublishBlockedError 用 instanceof 识别，
 * 映射为 permission_missing 的 blocked 结果。与各平台 adapter 共享。
 */
export class PlatformPublishBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformPublishBlockedError';
  }
}
