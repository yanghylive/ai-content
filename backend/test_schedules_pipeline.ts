import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SchedulesService } from './src/modules/schedules/schedules.service';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const schedulesService = app.get(SchedulesService);

    console.log('\n--- 🚀 开始模拟后台 Cron 定时任务核心执行流程测试 ---\n');

    try {
        console.log('1. [测试] 模拟触发: 自动采集素材');
        // Node 技巧：避开 private 的校验，直接调度内部方法观测表现
        await schedulesService['executeTask']('collect_materials');
        console.log('✅ 自动采集触发成功\n');

        console.log('2. [测试] 模拟触发: 自动挖掘素材 (使用受限批次与状态保护)');
        await schedulesService['executeTask']('mine_materials');
        console.log('✅ 自动挖掘集群调用成功\n');

        console.log('3. [测试] 模拟触发: 自动生成文章 (自带质量门槛过滤)');
        await schedulesService['executeTask']('create_articles');
        console.log('✅ 自动生成任务调用成功\n');

    } catch (e) {
        console.error('❌ 测试脚本遭遇异常错误:', e);
    } finally {
        await app.close();
        console.log('\n--- 执行完毕 ---');
    }
}

bootstrap();
