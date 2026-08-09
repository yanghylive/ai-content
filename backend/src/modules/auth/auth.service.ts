import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  KaypalAuthClient,
  type KaypalAuthenticatedUser,
} from './kaypal-auth.client';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly kaypalClient?: KaypalAuthClient,
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
    return (
      process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, '') ||
      process.env.CORS_ORIGIN?.trim().replace(/\/+$/, '') ||
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
   * Kaypal 认证服务账号密码登录（手机号 / 邮箱 + 密码，与微信扫码同一账户体系）。
   * 登录成功后自动创建 / 绑定本地用户并建立本地会话。
   */
  async loginWithKaypalCredentials(identifier: string, password: string) {
    if (!this.kaypalClient) {
      throw new ServiceUnavailableException('Kaypal 账号服务未配置');
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

    const session = await this.ensureLocalUserSession(
      {
        id: cloudUser.id,
        email: cloudUser.email,
        name: cloudUser.name ?? null,
      },
      {
        // 账号密码登录与微信扫码同一账户：本地会话直接放行，
        // 不要求 kaypal 订阅元数据
        localOnly: true,
        kaypalLoginMethod: 'credentials',
      },
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
      await this.prisma.user.update({
        where: { id: localUserId },
        data: { kaypalUserId: cloudUser.id },
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

  async logout(sessionId?: string) {    if (!sessionId) {
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
