import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SyncRedfoxInterfacesDto {
  @ApiPropertyOptional({
    description:
      'Comma separated platform codes. Empty means all online RedFox platforms.',
  })
  @IsOptional()
  @IsString()
  platforms?: string;
}
