import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class DiscoverTopicsDto {
  @ApiProperty({ description: '用户输入的关键词、事件或一段描述' })
  @IsString()
  @MinLength(2)
  seed: string;
}
