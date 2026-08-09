import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';

@Injectable()
export class SourcesService {
  constructor(
    private prisma: PrismaService,
    private systemLogsService: SystemLogsService,
  ) {}

  /** 获取全部信息源，按创建时间排序 */
  async findAll() {
    return this.prisma.source.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 获取单个信息源 */
  async findOne(id: string) {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('信息源不存在');
    return source;
  }

  /** 新增信息源 */
  async create(dto: CreateSourceDto) {
    return this.prisma.source.create({ data: dto });
  }

  /** 更新信息源 */
  async update(id: string, dto: UpdateSourceDto) {
    await this.findOne(id);
    return this.prisma.source.update({ where: { id }, data: dto });
  }

  /** 切换启用状态（取反） */
  async toggle(id: string) {
    const source = await this.findOne(id);
    return this.prisma.source.update({
      where: { id },
      data: { enabled: !source.enabled },
    });
  }

  /** 删除信息源 */
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.source.delete({ where: { id } });
  }

  /** 初始化默认渠道（已存在则跳过） */
  async seed() {
    const defaultSources = [
      {
        name: 'Aibase',
        type: 'crawler',
        url: 'https://www.aibase.com/zh/news',
        config: { platform: 'Aibase' },
        enabled: true,
      },
      {
        name: 'GitHub Trending',
        type: 'crawler',
        url: 'https://github.com/trending?spoken_language_code=zh',
        config: { platform: 'GitHub' },
        enabled: true,
      },
      {
        name: 'Grok/X 热搜',
        type: 'api',
        url: 'grok',
        config: {
          platform: 'X/Twitter',
          description: '需要先配置 X 平台 Grok API',
        },
        enabled: false,
      },
      {
        name: 'HackerNews',
        type: 'api',
        url: 'https://hacker-news.firebaseio.com/v0',
        config: { platform: 'HackerNews' },
        enabled: true,
      },
      {
        name: 'HubToday',
        type: 'crawler',
        url: 'https://ai.hubtoday.app',
        config: { platform: 'HubToday' },
        enabled: true,
      },
      {
        name: '掘金',
        type: 'api',
        url: 'https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed',
        config: { platform: 'Juejin' },
        enabled: true,
      },
      {
        name: '36Kr AI',
        type: 'crawler',
        url: 'https://36kr.com/information/AI/',
        config: { platform: '36Kr' },
        enabled: true,
      },
      {
        name: 'Tophub 热榜',
        type: 'crawler',
        url: 'https://tophub.today/n/aqeEmPge9R',
        config: { platform: 'Tophub' },
        enabled: true,
      },
      {
        name: 'V2EX 热门',
        type: 'api',
        url: 'https://www.v2ex.com/api/topics/hot.json',
        config: { platform: 'V2EX' },
        enabled: true,
      },
    ];

    let created = 0;
    let skipped = 0;

    for (const source of defaultSources) {
      const existing = await this.prisma.source.findFirst({
        where: { name: source.name },
      });
      if (existing) {
        skipped++;
      } else {
        await this.prisma.source.create({ data: source });
        created++;
      }
    }

    if (created > 0) {
      await this.systemLogsService.record(
        `🌱 成功初始化了 ${created} 个推荐信息采集渠道`,
        'success',
      );
    }

    return { created, skipped };
  }
}
