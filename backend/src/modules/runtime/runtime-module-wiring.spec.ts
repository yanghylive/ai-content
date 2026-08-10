import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../prisma/prisma.module';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { LocalEngineService } from '../local-engine/local-engine.service';
import { BrowserControlService } from './browser-control/browser-control.service';
import { RuntimeOrchestrator } from './orchestrator/runtime-orchestrator.service';
import { RuntimeModule } from './runtime.module';

describe('RuntimeModule wiring', () => {
  let moduleRef: TestingModule;

  afterEach(async () => {
    await moduleRef?.close();
  });

  it('wires RuntimeModule providers into LocalEngineService through forwardRef imports', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        // AutoUploadModule 是 @Global 但也必须 import 一次才会注册全局 exports
        AutoUploadModule,
        RuntimeModule,
      ],
    }).compile();

    const localEngine = moduleRef.get(LocalEngineService);
    const runtimeOrchestrator = moduleRef.get(RuntimeOrchestrator);
    const browserControl = moduleRef.get(BrowserControlService);

    expect(
      (localEngine as unknown as { runtimeOrchestrator?: RuntimeOrchestrator })
        .runtimeOrchestrator,
    ).toBe(runtimeOrchestrator);
    expect(
      (localEngine as unknown as { browserControl?: BrowserControlService })
        .browserControl,
    ).toBe(browserControl);
  });
});
