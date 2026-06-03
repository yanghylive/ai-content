import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { KaypalAuthClient } from './kaypal-auth.client';
import { KaypalProfileController } from './kaypal-profile.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, KaypalProfileController],
  providers: [
    AuthService,
    KaypalAuthClient,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [AuthService, KaypalAuthClient],
})
export class AuthModule {}
