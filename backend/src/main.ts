import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { AuthRequestContextService } from './common/auth-request-context.service';

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

function normalizeDesktopSqliteEnv() {
  if (
    (process.env.KAYPAL_DESKTOP_DATABASE_MODE || '').trim().toLowerCase() !==
    'sqlite'
  ) {
    return;
  }
  const userDataDir = process.env.KAYPAL_DESKTOP_USER_DATA_DIR;
  if (!userDataDir) return;
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

async function bootstrap() {
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
  ]);

  // 全局前缀
  app.setGlobalPrefix('api');

  app.use((_req, _res, next: () => void) => {
    authRequestContext.run({} as Record<string, unknown>, next);
  });

  // CORS
  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`当前来源未被允许访问：${origin}`), false);
    },
    credentials: true,
  });

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
  await app.listen(port);
  console.log(`🚀 应用运行在: http://localhost:${port}`);
  console.log(`📖 API 文档: http://localhost:${port}/api/docs`);
}
void bootstrap();
