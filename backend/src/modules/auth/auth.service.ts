import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AUTH_SESSION_DAYS,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_NAME,
  DEFAULT_ADMIN_USERNAME,
} from './auth.constants';
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from './auth.utils';

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
  constructor(private readonly prisma: PrismaService) {}

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
      throw new UnauthorizedException('账号或密码错误');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('账号已被停用');
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('账号或密码错误');
    }

    const sessionToken = createSessionToken();
    const expiresAt = new Date(Date.now() + AUTH_SESSION_DAYS * 24 * 60 * 60 * 1000);

    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt,
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
    const username = (input.username || DEFAULT_ADMIN_USERNAME).trim().toLowerCase();
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
}
