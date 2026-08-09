import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PlatformInteractionExecutor } from '../src/modules/local-engine/platform-interaction-executor.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const executor = app.get(PlatformInteractionExecutor);
  const result = await executor.dispatch({
    platform: 'douyin',
    taskType: 'direct-message-reply',
    action: 'send',
    accountId: 1,
    targetText: '毛毛宝贝星期六你把具体内容发我，我按实际情况帮你看。',
    replyText: '测试私信G-2026-06-08T18-18',
  });
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
