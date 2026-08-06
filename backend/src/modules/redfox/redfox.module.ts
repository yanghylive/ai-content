import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiEmployeeModule } from '../ai-employee/ai-employee.module';
import { AiModelsModule } from '../ai-models/ai-models.module';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { RedfoxCallLogService } from './redfox-call-log.service';
import { RedfoxClientService } from './redfox-client.service';
import { RedfoxController } from './redfox.controller';
import { RedfoxCostGuardService } from './redfox-cost-guard.service';
import { RedfoxInterfaceCatalogService } from './redfox-interface-catalog.service';
import { RedfoxHotTopicsService } from './redfox-hot-topics.service';
import { RedfoxComplianceService } from './redfox-compliance.service';
import { RedfoxRadarService } from './redfox-radar.service';
import { RedfoxCollectService } from './redfox-collect.service';
import { RedfoxAccountService } from './redfox-account.service';
import { AutoUploadModule } from '../auto-upload/auto-upload.module';
import { AgentSModule } from '../agent-s/agent-s.module';
import { RedfoxSkillRunnerService } from './redfox-skill-runner.service';
import { RedfoxService } from './redfox.service';
import { RedfoxSkillCatalogService } from './redfox-skill-catalog.service';

@Module({
  imports: [
    AutoUploadModule,
    ConfigModule,
    AiEmployeeModule,
    AgentSModule,
    LocalEngineModule,
    AiModelsModule,
  ],
  controllers: [RedfoxController],
  providers: [
    RedfoxService,
    RedfoxClientService,
    RedfoxSkillCatalogService,
    RedfoxHotTopicsService,
    RedfoxComplianceService,
    RedfoxRadarService,
    RedfoxAccountService,
    RedfoxCollectService,
    RedfoxSkillRunnerService,
    RedfoxInterfaceCatalogService,
    RedfoxCallLogService,
    RedfoxCostGuardService,
    RedfoxHotTopicsService,
    RedfoxComplianceService,
    RedfoxCollectService,
  ],
  exports: [
    RedfoxService,
    RedfoxClientService,
    RedfoxSkillCatalogService,
    RedfoxSkillRunnerService,
    RedfoxInterfaceCatalogService,
    RedfoxCallLogService,
    RedfoxCostGuardService,
    RedfoxHotTopicsService,
    RedfoxComplianceService,
    RedfoxCollectService,
  ],
})
export class RedfoxModule {}
