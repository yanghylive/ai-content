import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * 公开关键特性 DTO（结构化，PRD §11.1：每项含 title + description）。
 */
export class KeyFeatureDto {
  @ApiProperty({ description: '特性标题' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: '特性说明' })
  @IsString()
  @IsNotEmpty()
  description: string;
}
