import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SchedulesService } from './src/modules/schedules/schedules.service';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const schedulesService = app.get(SchedulesService);

    console.log('\n--- 🚀 单独抽查测试：自动生成文章 批处理引擎 ---\n');

    try {
        console.log('[测试] 模拟调度中心触发: create_articles');
        // 将强行调用生成逻辑，会根据当前的配置（最低75分，最多3篇）从数据库挑出已挖掘好的候选
        await schedulesService['executeTask']('create_articles');

    } catch (e) {
        console.error('❌ 测试脚本遭遇异常错误:', e);
    } finally {
        await app.close();
        console.log('\n--- 执行完毕 ---');
    }
}

bootstrap();
