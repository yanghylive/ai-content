import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  type ValidationArguments,
  type ValidationOptions,
  registerDecorator,
} from 'class-validator';

function IsRecordArray(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isRecordArray',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (
            Array.isArray(value) &&
            value.every(
              (item) =>
                Boolean(item) &&
                typeof item === 'object' &&
                !Array.isArray(item),
            )
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must contain objects`;
        },
      },
    });
  };
}

export class IngestRedfoxItemsDto {
  @ApiProperty({
    description: 'Source platform, e.g. douyin/xiaohongshu/bilibili',
  })
  @IsString()
  platform!: string;

  @ApiProperty({
    description: 'Intelligence type, e.g. trend/search/viral/account/comment',
  })
  @IsString()
  type!: string;

  @ApiPropertyOptional({ description: 'Local RedFox Skill id' })
  @IsOptional()
  @IsString()
  redfoxSkillId?: string;

  @ApiPropertyOptional({
    description: 'RedFox Skill code, used when local id is unknown',
  })
  @IsOptional()
  @IsString()
  redfoxSkillCode?: string;

  @ApiPropertyOptional({ description: 'RedFox call log id for traceability' })
  @IsOptional()
  @IsString()
  redfoxCallLogId?: string;

  @ApiPropertyOptional({
    description: 'Initial intelligence status',
    default: 'new',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({
    description: 'Raw RedFox result items to normalize and upsert',
    type: [Object],
  })
  @IsArray()
  @ArrayMaxSize(200)
  @Type(() => Object)
  @IsRecordArray()
  rawItems!: Record<string, unknown>[];
}
