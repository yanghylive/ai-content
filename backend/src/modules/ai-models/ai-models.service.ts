import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateModelDto } from './dto/create-model.dto';
import { UpdateModelDto } from './dto/update-model.dto';
import { AiClientService } from './ai-client.service';

@Injectable()
export class AiModelsService {
  constructor(
    private prisma: PrismaService,
    private aiClientService: AiClientService,
  ) {}

  async findAll(platformId?: string) {
    const where = platformId ? { platformId } : {};
    return this.prisma.aIModel.findMany({
      where,
      include: { platform: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const model = await this.prisma.aIModel.findUnique({
      where: { id },
      include: { platform: true },
    });
    if (!model) throw new NotFoundException('AI 模型不存在');
    return model;
  }

  async create(dto: CreateModelDto) {
    try {
      return await this.prisma.aIModel.create({
        data: dto,
        include: { platform: true },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('该平台下已存在相同的模型 ID');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateModelDto) {
    await this.findOne(id);
    return this.prisma.aIModel.update({
      where: { id },
      data: dto,
      include: { platform: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.aIModel.delete({ where: { id } });
  }

  async testConnection(platformId: string, modelId: string) {
    if (!platformId || !modelId) {
      return { success: false, message: '平台ID和模型ID不能为空' };
    }
    try {
      const model = await this.prisma.aIModel.findFirst({
        where: { platformId, modelId },
      });
      if (!model) {
        return { success: false, message: 'AI 模型不存在或未同步' };
      }
      const reply = await this.aiClientService.generate(
        model.id,
        [
          {
            role: 'user',
            content:
              '你好，如果你能看到这句话，请回复：测试通过。只回复四个字即可。',
          },
        ],
        { maxTokens: 32, temperature: 0, knowledgeMode: 'off' },
      );

      if (!reply) {
        return {
          success: false,
          message: '接口返回为空，请检查模型配置或 Kaypal 授权状态。',
        };
      }

      return { success: true, message: '测试通过', reply: reply };
    } catch (error: any) {
      return { success: false, message: `测试失败: ${error.message}` };
    }
  }
}
