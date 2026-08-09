export const WECHAT_CHANNEL_LOGIN_URL =
  "https://channels.weixin.qq.com/" as const;

export function parseTrustedWechatChannelLoginUrl(
  value: string,
): typeof WECHAT_CHANNEL_LOGIN_URL | null {
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "channels.weixin.qq.com" ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return WECHAT_CHANNEL_LOGIN_URL;
  } catch {
    return null;
  }
}
