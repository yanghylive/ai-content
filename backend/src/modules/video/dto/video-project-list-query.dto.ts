import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class VideoProjectListQueryDto {
  @IsOptional()
  @IsString()
  pipeline?: string; // 按流水线筛选

  @IsOptional()
  @IsString()
  status?: string; // 按状态筛选（queued / running / done / failed）

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page_size?: number = 20;
}
