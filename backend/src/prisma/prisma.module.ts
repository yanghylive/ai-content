import { Global, Module } from '@nestjs/common';
import { AuthRequestContextModule } from '../common/auth-request-context.module';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  imports: [AuthRequestContextModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
