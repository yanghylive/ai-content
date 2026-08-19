import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import {
  KaypalAuthClient,
  type KaypalAuthenticatedUser,
} from './kaypal-auth.client';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AUTH_SESSION_DAYS,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_NAME,
  DEFAULT_ADMIN_USERNAME,
} from './auth.constants';
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from './auth.utils';
import { resolveCommercialGrant } from './plan-order';
import { CredentialEnvelopeService } from '../../common/credential-envelope.service';
import {
  encryptSessionToken,
  decryptSessionToken,
} from './session-token-cipher';

interface LoginInput {
  username: string;
  password: string;
}

interface BootstrapUserInput {
  username?: string;
  email?: string;
  password: string;
  name?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly kaypalClient?: KaypalAuthClient,
    @Optional() private readonly envelope?: CredentialEnvelopeService,
  ) {}

  /** 微信登录（kaypal 认证服务原生微信扫码）：拿授权 URL */
  async getWechatLoginUrl(returnUrl: string): Promise<string> {
    if (!this.kaypalClient) {
      throw new ServiceUnavailableException('微信登录未配置');
    }
    return this.kaypalClient.getWechatLoginUrl(returnUrl);
  }

  /** kaypal 微信授权 URL 端点（浏览器直接访问，kaypal 设 state cookie + 302） */
  getWechatUrlEndpoint(): string {
    if (!this.kaypalClient) {
      throw new ServiceUnavailableException('微信登录未配置');
    }
    return this.kaypalClient.getWechatUrlEndpoint();
  }

  /** kaypal 账号系统 base URL（跳转注册/忘记密码等账号自助页面用） */
  getKaypalBaseUrl(): string {
    if (!this.kaypalClient) {
      throw new ServiceUnavailableException('Kaypal 账号系统未配置');
    }
    return this.kaypalClient.getAuthBaseUrl();
  }

  /** kaypal 微信授权 URL + state cookie（start 透传给浏览器） */
  async getWechatLoginWithCookies(returnUrl: string) {
    if (!this.kaypalClient) {
      throw new ServiceUnavailableException('微信登录未配置');
    }
    return this.kaypalClient.getWechatLoginUrlWithCookies(returnUrl);
  }

  /** 微信扫码回调：解析 kaypal 回跳的 kaypalToken → 找/建本地用户 → 建会话 */
  async handleWechatCallback(
    query: Record<string, string | undefined>,
  ): Promise<
    | { sessionToken: string; expiresAt: Date; user: unknown }
    | { sessionToken: null; error: string }
  > {
    const accessToken =
      query.kaypalToken || query.access_token || query.token || null;
    if (!accessToken) {
      return { sessionToken: null, error: '微信登录回调缺少凭证，请重新扫码' };
    }
    try {
      if (!this.kaypalClient) {
        return { sessionToken: null, error: '微信登录未配置' };
      }
      const cloudUser =
        await this.kaypalClient.getUserFromDesktopToken(accessToken);
      if (!cloudUser?.id) {
        return { sessionToken: null, error: '微信登录返回数据不完整' };
      }
      return this.ensureLocalUserSession(cloudUser, {
        kaypalDesktopAccessToken: accessToken,
        // 微信登录为本地会话：guard 直接放行，不要求 kaypal 订阅元数据
        localOnly: true,
      });
    } catch (error) {
      return {
        sessionToken: null,
        error:
          error instanceof Error
            ? `微信登录处理失败：${error.message.slice(0, 80)}`
            : '微信登录处理失败',
      };
    }
  }

  /** kaypal 用户 → 本地用户（绑定/新建）→ 建 session（与桌面授权同逻辑） */
  async ensureLocalUserSession(
    cloudUser: { id: string; email?: string | null; name?: string | null },
    metadata: Record<string, unknown>,
  ) {
    let localUser = await this.prisma.user.findUnique({
      where: { kaypalUserId: cloudUser.id },
    });

    if (!localUser) {
      const safeId = cloudUser.id.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
      const username = `kaypal_${safeId}`;
      const email = cloudUser.email || `${cloudUser.id}@kaypal.local`;
      const existingEmailUser = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingEmailUser) {
        if (
          existingEmailUser.kaypalUserId &&
          existingEmailUser.kaypalUserId !== cloudUser.id
        ) {
          throw new BadRequestException('该邮箱已绑定其他 Kaypal 账号');
        }
        localUser = await this.prisma.user.update({
          where: { id: existingEmailUser.id },
          data: {
            kaypalUserId: cloudUser.id,
            name:
              existingEmailUser.name ||
              cloudUser.name ||
              cloudUser.email ||
              'Kaypal 用户',
          },
        });
      } else {
        const randomPassword = `${Date.now()}-${Math.random()}-${cloudUser.id}`;
        const passwordHash = await hashPassword(randomPassword);
        localUser = await this.prisma.user.create({
          data: {
            username,
            email,
            name: cloudUser.name || cloudUser.email || 'Kaypal 用户',
            passwordHash,
            kaypalUserId: cloudUser.id,
            status: 'active',
          },
        });
      }
    } else if (localUser.status !== 'active') {
      throw new BadRequestException('本地账号已停用');
    }

    await this.prisma.user.update({
      where: { id: localUser.id },
      data: { lastLoginAt: new Date() },
    });

    const sessionToken = createSessionToken();
    const expiresAt = new Date(
      Date.now() + AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.prisma.userSession.create({
      data: {
        userId: localUser.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt,
        metadata: metadata as Prisma.InputJsonObject,
      },
    });

    return {
      sessionToken,
      expiresAt,
      user: this.toSafeUser(localUser),
    };
  }

  /** 微信回调回跳用的公网 Origin（生产用环境变量，本地回环兜底） */
  getConfiguredPublicOrigin(): string {
    // CORS_ORIGIN 可能是逗号分隔的多个 origin（如本地开发 http://localhost:3010,http://127.0.0.1:3010），
    // 回跳地址必须是一个完整 origin —— 逗号串会直接导致云端回调白名单校验失败（扫码后跳站内页）。
    const firstOf = (v: string) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)[0] || '';
    return (
      firstOf(process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '') ||
      firstOf(process.env.CORS_ORIGIN || '').replace(/\/+$/, '') ||
      ''
    );
  }

  async getSetupStatus() {
    const totalUsers = await this.prisma.user.count();
    return {
      hasUsers: totalUsers > 0,
      totalUsers,
    };
  }

  async login(input: LoginInput) {
    const username = input.username.trim().toLowerCase();
    const password = input.password;

    if (!username || !password) {
      throw new BadRequestException('账号和密码不能为空');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email: username },
          ...(/^\d{6,}$/.test(username)
            ? [{ email: `phone-${username}@kaypal.invalid` }]
            : []),
        ],
      },
    });

    if (!user) {
      // 本地没有这个账号 → 回退到 Kaypal 认证服务账号密码登录
      // （手机号 / 邮箱 + 密码，与微信扫码同一个账户体系）。
      // 登录成功后自动创建 / 绑定本地用户。
      return this.loginWithKaypalCredentials(username, password);
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('账号已被停用');
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      // 本地密码不匹配（本地 kaypal_xxx 用户密码是随机生成的，不可登录）：
      // 也回退到 Kaypal 账号密码认证；kaypal 也校验失败时抛 401。
      return this.loginWithKaypalCredentials(username, password);
    }

    // 本地密码验证通过：若该用户尚未绑定 kaypal 云账号（kaypalUserId 为空），
    // 后台尝试用刚提交的账号密码做 kaypal 认证并回填绑定（不阻塞本地登录）。
    // 否则本地账号（如手机号 bootstrap）登录后没有 kaypal 归属，
    // 模型台/语音等走云端的链路会全部"授权失败"。
    if (!user.kaypalUserId && this.kaypalClient) {
      void this.tryBindKaypalUserId(user.id, username, password);
    }

    const sessionToken = createSessionToken();
    const expiresAt = new Date(
      Date.now() + AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
    );

    const inheritedMetadata = await this.findReusableKaypalSessionMetadata(
      user.id,
    );
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt,
        ...(inheritedMetadata ? { metadata: inheritedMetadata } : {}),
      },
    });

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    return {
      sessionToken,
      sessionId: session.id,
      expiresAt,
      user: this.toSafeUser(updatedUser),
    };
  }

  /**
   * App 内微信一键登录（2026-08-11）：微信开放平台 SDK 授权 code → openid → 绑定/建用户 → 建会话。
   * 需配置 WECHAT_APP_APPID / WECHAT_APP_SECRET（微信开放平台企业资质，审核通过后填）。
   * openid 用确定性 username（wechat-<openid>）绑定，避免 schema 迁移。
   */
  async wechatAppLogin(code: string) {
    const appId = process.env.WECHAT_APP_APPID?.trim();
    const appSecret = process.env.WECHAT_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException(
        '微信一键登录未开通（需微信开放平台企业资质 AppID），请先用账号密码或扫码登录',
      );
    }
    if (!code) {
      throw new BadRequestException('微信授权 code 不能为空');
    }

    // code 换 access_token + openid
    const tokenUrl =
      `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    let tokenData: { openid?: string; errmsg?: string };
    try {
      const raw: unknown = await fetch(tokenUrl).then((r) => r.json());
      tokenData = raw as { openid?: string; errmsg?: string };
    } catch {
      throw new ServiceUnavailableException('微信授权服务不可用，请稍后重试');
    }
    const openid = tokenData?.openid;
    if (!openid) {
      throw new UnauthorizedException(
        tokenData?.errmsg
          ? `微信授权失败：${tokenData.errmsg}`
          : '微信授权失败，请重试',
      );
    }

    const wechatUsername = `wechat-${openid}`;
    let user = await this.prisma.user.findUnique({
      where: { username: wechatUsername },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          username: wechatUsername,
          email: `${wechatUsername}@kaypal.invalid`,
          passwordHash: randomUUID(), // 微信登录不依赖密码，随机占位
          name: '微信用户',
          status: 'active',
        },
      });
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException('账号已被停用');
    }

    // 建会话（与 login 尾部一致）
    const sessionToken = createSessionToken();
    const expiresAt = new Date(
      Date.now() + AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000,
    );
    const inheritedMetadata = await this.findReusableKaypalSessionMetadata(
      user.id,
    );
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt,
        ...(inheritedMetadata ? { metadata: inheritedMetadata } : {}),
      },
    });
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return {
      sessionToken,
      sessionId: session.id,
      expiresAt,
      user: this.toSafeUser(updatedUser),
    };
  }

  /**
   * Kaypal 认证服务账号密码登录（手机号 / 邮箱 + 密码，与微信扫码同一账户体系）。
   * 登录成功后自动创建 / 绑定本地用户并建立本地会话。
   */
  async loginWithKaypalCredentials(identifier: string, password: string) {
    if (!this.kaypalClient) {
      // 本地账号密码不对且未配置 kaypal 兜底：按凭证错误处理（401），而非服务不可用（503）
      throw new UnauthorizedException('账号或密码错误');
    }
    let cloudUser: KaypalAuthenticatedUser;
    try {
      cloudUser = await this.kaypalClient.login(identifier, password);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new UnauthorizedException('账号或密码错误');
      }
      throw new ServiceUnavailableException(
        error instanceof Error
          ? error.message
          : 'Kaypal 账号服务不可用，请稍后重试',
      );
    }
    if (!cloudUser?.id || !cloudUser.email) {
      throw new BadRequestException('Kaypal 登录返回数据不完整');
    }

    // 与扫码授权等价：用密码向云端兑换 desktop token（kda_），
    // 存入会话 metadata，使 localOnly 会话带真实云 token → 走云端真实等级/计费
    const deviceId = `pwd_${randomUUID().slice(0, 16)}`;
    const sessionMetadata: Record<string, unknown> = {
      // 账号密码登录与微信扫码同一账户：本地会话直接放行，
      // 不要求 kaypal 订阅元数据
      localOnly: true,
      kaypalLoginMethod: 'credentials',
    };
    try {
      const tokens = await this.kaypalClient.loginWithPassword({
        identifier,
        password,
        deviceId,
      });
      // S4 修复：Kaypal OAuth token 加密后落盘（复用 credential-envelope）
      sessionMetadata.kaypalDesktopAccessToken = this.envelope
        ? encryptSessionToken(this.envelope, tokens.access_token)
        : tokens.access_token;
      sessionMetadata.kaypalDesktopRefreshToken = this.envelope
        ? encryptSessionToken(this.envelope, tokens.refresh_token)
        : tokens.refresh_token;
      sessionMetadata.kaypalDesktopDeviceId =
        tokens.device?.device_id || deviceId;
      if (typeof tokens.expires_in === 'number') {
        sessionMetadata.kaypalDesktopTokenExpiresAt = new Date(
          Date.now() + tokens.expires_in * 1000,
        ).toISOString();
      }
    } catch (error) {
      // 兑换失败不阻塞登录（降级为无云 token 的本地会话）
      this.logger?.warn?.(
        `账号密码登录兑换云桌面令牌失败（降级本地会话）: ${error}`,
      );
    }

    // 换 token 成功后同步云端套餐到 session metadata：
    // PlanGuard 读 metadata.kaypalSubscriptionPlan 缓存（无缓存兜底 FREE），
    // 若登录后未先调 subscription 接口，RequirePlans 接口会被误判免费（直连 API 实测复现）。
    // 同步失败不阻断登录（前端布局轮询会补写缓存）。
    const plainAccessToken = this.envelope
      ? decryptSessionToken(
          this.envelope,
          sessionMetadata.kaypalDesktopAccessToken,
        )
      : (sessionMetadata.kaypalDesktopAccessToken as string);
    if (plainAccessToken) {
      try {
        const sub = (await this.kaypalClient.getCloudSubscription(
          plainAccessToken,
        )) as { plan?: string; periodEnd?: string | null };
        const plan = typeof sub?.plan === 'string' ? sub.plan : '';
        if (plan && plan !== 'FREE') {
          sessionMetadata.kaypalSubscriptionPlan = plan;
          if (sub?.periodEnd) {
            sessionMetadata.kaypalSubscriptionPeriodEnd = sub.periodEnd;
          }
          sessionMetadata.kaypalMetadataSyncedAt = new Date().toISOString();
        }
      } catch (error) {
        this.logger?.warn?.(
          `账号密码登录同步云端套餐失败（前端轮询将补）: ${error}`,
        );
      }
    }

    const session = await this.ensureLocalUserSession(
      {
        id: cloudUser.id,
        email: cloudUser.email,
        name: cloudUser.name ?? null,
      },
      sessionMetadata,
    );

    return {
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      user: session.user,
    };
  }

  /**
   * 后台把本地账号绑定到 kaypal 云账号（kaypalUserId 回填）。
   * 仅用于本地密码验证通过的场景；kaypal 认证失败时静默忽略（不影响本地登录）。
   */
  private async tryBindKaypalUserId(
    localUserId: string,
    identifier: string,
    password: string,
  ) {
    try {
      const cloudUser = await this.kaypalClient!.login(identifier, password);
      if (!cloudUser?.id) return;
      const existing = await this.prisma.user.findUnique({
        where: { kaypalUserId: cloudUser.id },
        select: { id: true },
      });
      // 该 kaypal 账号已绑定别的本地用户时不覆盖
      if (existing && existing.id !== localUserId) return;
      const grant = resolveCommercialGrant({
        subscriptionPlan: cloudUser.subscriptionPlan,
        subscriptionPeriodEnd: cloudUser.subscriptionPeriodEnd,
      });
      await this.prisma.user.update({
        where: { id: localUserId },
        data: {
          kaypalUserId: cloudUser.id,
          commercialExecutionAllowed: grant.commercialExecutionAllowed,
          planMode: grant.planMode,
        },
      });
      console.log(
        `[auth] 本地账号 ${localUserId} 已绑定 kaypal 云账号 ${cloudUser.id}`,
      );
    } catch (error) {
      console.debug(
        `[auth] kaypal 后台绑定跳过（不影响本地登录）：${(error as Error)?.message ?? String(error)}`,
      );
    }
  }

  async logout(sessionId?: string) {
    if (!sessionId) {
      return { success: true };
    }

    await this.prisma.userSession.deleteMany({
      where: { id: sessionId },
    });

    return { success: true };
  }

  async bootstrapUser(input: BootstrapUserInput) {
    const username = (input.username || DEFAULT_ADMIN_USERNAME)
      .trim()
      .toLowerCase();
    const email = (input.email || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
    const password = input.password;
    const name = (input.name || DEFAULT_ADMIN_NAME).trim();

    if (!username || !email || !password || !name) {
      throw new BadRequestException('账号、姓名和密码不能为空');
    }

    if (password.length < 8) {
      throw new BadRequestException('密码长度不能少于 8 位');
    }

    const existingUserCount = await this.prisma.user.count();
    if (existingUserCount > 0) {
      throw new BadRequestException('系统已存在账号，请勿重复初始化');
    }

    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: {
        username,
        email,
        name,
        passwordHash,
      },
    });

    return this.toSafeUser(user);
  }

  private toSafeUser(user: {
    id: string;
    username: string;
    email: string;
    name: string;
    status: string;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    kaypalUserId?: string | null;
  }) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      kaypalUserId: user.kaypalUserId ?? null,
    };
  }

  private async findReusableKaypalSessionMetadata(userId: string) {
    const session = await this.prisma.userSession.findFirst({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      select: { metadata: true },
    });

    const metadata = this.toMetadataRecord(session?.metadata);
    if (!this.hasKaypalDesktopToken(metadata)) {
      return null;
    }

    return this.toJsonObject(metadata);
  }

  private toMetadataRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private hasKaypalDesktopToken(metadata: Record<string, unknown>) {
    return Boolean(
      this.toOptionalString(metadata.kaypalDesktopAccessToken) ||
      this.toOptionalString(metadata.kaypalDesktopRefreshToken),
    );
  }

  private toOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined),
    ) as Prisma.InputJsonObject;
  }
}
