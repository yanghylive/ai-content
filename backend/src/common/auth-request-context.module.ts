import { Global, Module } from '@nestjs/common';
import { AuthRequestContextService } from './auth-request-context.service';

@Global()
@Module({
  providers: [AuthRequestContextService],
  exports: [AuthRequestContextService],
})
export class AuthRequestContextModule {}
