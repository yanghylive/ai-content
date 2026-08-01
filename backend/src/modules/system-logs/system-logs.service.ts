import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SystemLogsService {
  private readonly logger = new Logger(SystemLogsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 记录一条系统日志
   * @param content 日志内容
   * @param level 日志等级: 'info' | 'success' | 'warning' | 'error'
   */
  async record(
    content: string,
    level: 'info' | 'success' | 'warning' | 'error' = 'info',
  ) {
    try {
      await this.prisma.systemLog.create({
        data: {
          content,
          level,
        },
      });

      // 如果数据超出一定数量则自动清理旧数据 (保留最新的1000条)
      const count = await this.prisma.systemLog.count();
      if (count > 1000) {
        const oldestLogs = await this.prisma.systemLog.findMany({
          orderBy: { createdAt: 'desc' },
          skip: 1000,
          select: { id: true },
        });

        if (oldestLogs.length > 0) {
          await this.prisma.systemLog.deleteMany({
            where: { id: { in: oldestLogs.map((l) => l.id) } },
          });
        }
      }
    } catch (error) {
      this.logger.error(`无法写入系统日志: ${error}`);
    }
  }

  /**
   * 获取最新的系统运行日志
   * @param limit 返回的最大条数
   */
  async getRecent(limit: number = 20) {
    return this.prisma.systemLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
