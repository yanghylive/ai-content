import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiEmployeeModule } from '../ai-employee/ai-employee.module';
import { LocalEngineModule } from '../local-engine/local-engine.module';
import { RedfoxCallLogService } from './redfox-call-log.service';
import { RedfoxClientService } from './redfox-client.service';
import { RedfoxController } from './redfox.controller';
import { RedfoxCostGuardService } from './redfox-cost-guard.service';
import { RedfoxInterfaceCatalogService } from './redfox-interface-catalog.service';
import { RedfoxHotTopicsService } from './redfox-hot-topics.service';
import { RedfoxComplianceService } from './redfox-compliance.service';
import { RedfoxSkillRunnerService } from './redfox-skill-runner.service';
import { RedfoxService } from './redfox.service';
import { RedfoxSkillCatalogService } from './redfox-skill-catalog.service';

@Module({
  imports: [ConfigModule, AiEmployeeModule, LocalEngineModule],
  controllers: [RedfoxController],
  providers: [
    RedfoxService,
    RedfoxClientService,
    RedfoxSkillCatalogService,
    RedfoxHotTopicsService,
    RedfoxComplianceService,
    RedfoxSkillRunnerService,
    RedfoxInterfaceCatalogService,
    RedfoxCallLogService,
    RedfoxCostGuardService,
  ],
  exports: [
    RedfoxService,
    RedfoxClientService,
    RedfoxSkillCatalogService,
    RedfoxSkillRunnerService,
    RedfoxInterfaceCatalogService,
    RedfoxCallLogService,
    RedfoxCostGuardService,
  ],
})
export class RedfoxModule {}
