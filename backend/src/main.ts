import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { AuthRequestContextService } from './common/auth-request-context.service';

function applyEnvFileIfPresent(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function loadDesktopEnvBeforeNestConfig() {
  if (
    (process.env.KAYPAL_DESKTOP_DATABASE_MODE || '').trim().toLowerCase() !==
    'sqlite'
  ) {
    return;
  }
  applyEnvFileIfPresent(resolve(process.cwd(), '..', 'desktop', 'backend.env'));
}

function isRelativeSqliteUrl(value?: string) {
  return (
    !value ||
    value === 'file:' ||
    value.startsWith('file:./') ||
    value.startsWith('file:../')
  );
}

function toSqliteFileUrl(filePath: string) {
  return `file:${filePath.replace(/\\/g, '/')}`;
}

function readRequestedTenantId(request: Request) {
  const raw = request.headers['x-tenant-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function inferDesktopUserDataDir() {
  const configured = process.env.KAYPAL_DESKTOP_USER_DATA_DIR?.trim();
  if (configured) {
    return configured;
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim();
    return appData
      ? `${appData.replace(/[\\/]$/, '')}\\ai-content-desktop`
      : '';
  }

  if (process.platform === 'darwin') {
    const home = process.env.HOME?.trim();
    return home
      ? `${home.replace(/[\\/]$/, '')}/Library/Application Support/ai-content-desktop`
      : '';
  }

  return '';
}

function normalizeDesktopSqliteEnv() {
  if (
    (process.env.KAYPAL_DESKTOP_DATABASE_MODE || '').trim().toLowerCase() !==
    'sqlite'
  ) {
    return;
  }
  const userDataDir = inferDesktopUserDataDir();
  if (!userDataDir) return;
  process.env.KAYPAL_DESKTOP_USER_DATA_DIR = userDataDir;
  const databaseUrl = toSqliteFileUrl(
    `${userDataDir.replace(/[\\/]$/, '')}/kaypal-ai.sqlite`,
  );
  if (isRelativeSqliteUrl(process.env.SQLITE_DATABASE_URL)) {
    process.env.SQLITE_DATABASE_URL = databaseUrl;
  }
  if (
    !process.env.DATABASE_URL ||
    process.env.DATABASE_URL.startsWith('postgres') ||
    isRelativeSqliteUrl(process.env.DATABASE_URL)
  ) {
    process.env.DATABASE_URL = process.env.SQLITE_DATABASE_URL;
  }
}

/**
 * 局域网来源判断（真机调试用）：
 * 手机浏览器通过电脑局域网 IP 访问时，origin 形如
 * http://192.168.x.x:3010 / http://10.x.x.x:8080 等。
 */
function isLanOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    const host = url.hostname;
    return (
      /^(192\.168\.\d{1,3}\.\d{1,3})$/.test(host) ||
      /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(host) ||
      /^(172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(host)
    );
  } catch {
    return false;
  }
}

async function bootstrap() {
  loadDesktopEnvBeforeNestConfig();
  normalizeDesktopSqliteEnv();
  const app = await NestFactory.create(AppModule);
  const authRequestContext = app.get(AuthRequestContextService);
  const configuredOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([
    ...configuredOrigins,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3010',
    'http://127.0.0.1:3010',
    'http://localhost:3011',
    'http://127.0.0.1:3011',
    'http://localhost:3012',
    'http://127.0.0.1:3012',
    'http://localhost:3013',
    'http://127.0.0.1:3013',
    'http://localhost:3014',
    'http://127.0.0.1:3014',
    'http://localhost:3015',
    'http://127.0.0.1:3015',
    'http://localhost:3721',
    'http://127.0.0.1:3721',
  ]);

  // 全局前缀
  app.setGlobalPrefix('api');

  // 全局安全响应头（API 服务基础加固，无需引入 helmet 依赖）
  const isProduction = process.env.NODE_ENV === 'production';
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
    if (isProduction) {
      // 生产 HTTPS：强制 HSTS（1 年 + 子域）
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  });

  app.use((req: Request, _res: Response, next: NextFunction) => {
    authRequestContext.run(
      { requestedTenantId: readRequestedTenantId(req) },
      next,
    );
  });

  // CORS
  const corsOptions: CorsOptions = {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      // 局域网来源（真机调试）：http://192.168.x.x:PORT / http://10.x.x.x:PORT
      // 手机浏览器通过电脑局域网 IP 访问 3010 时，API 请求会带该 origin。
      // 安全：仅非生产环境放行局域网 origin（生产环境任意局域网来源 + credentials 可被滥用）。
      if (!isProduction && isLanOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`当前来源未被允许访问：${origin}`), false);
    },
    credentials: true,
  };
  app.enableCors(corsOptions);

  // 全局管道 - 参数验证
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // 全局拦截器 - 统一响应格式
  app.useGlobalInterceptors(new TransformInterceptor());

  // 全局异常过滤器
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger API 文档
  const config = new DocumentBuilder()
    .setTitle('AI 内容创作系统')
    .setDescription('AI Content Creation System API')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3001;
  const host =
    process.env.KAYPAL_BACKEND_HOST?.trim() ||
    process.env.HOST?.trim() ||
    '127.0.0.1';
  await app.listen(port, host);
  console.log(`🚀 应用运行在: http://${host}:${port}`);
  console.log(`📖 API 文档: http://${host}:${port}/api/docs`);
}
void bootstrap();
