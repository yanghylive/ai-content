import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Agent Gateway 运行时 DTO（class-validator，全局 ValidationPipe 校验）。
 * interface 编译后不存在，必须用 class 才能让 ValidationPipe 生效（P1-7）。
 */

export class CreateSessionDto {
  @IsOptional()
  @IsIn(['business', 'advanced'])
  mode?: 'business' | 'advanced';
}

export class ResumeSessionDto {
  @IsOptional()
  @IsString()
  lastEventId?: string;
}

export class CreateTaskDto {
  @IsString()
  sessionId!: string;

  @IsString()
  type!: string;

  @IsOptional()
  @IsObject()
  plan?: Record<string, unknown>;
}

export class ApproveTaskDto {
  @IsString()
  approvalId!: string;

  @IsObject()
  currentPreview!: unknown;
}

export class ExecuteToolDto {
  @IsString()
  sessionId!: string;

  @IsString()
  taskId!: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class MemorySearchDto {
  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  query?: string;
}

export class MemoryAddDto {
  @IsOptional()
  @IsString()
  scope?: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  source?: string;
}

export class TokenExchangeDto {
  @IsString()
  sessionId!: string;
}
