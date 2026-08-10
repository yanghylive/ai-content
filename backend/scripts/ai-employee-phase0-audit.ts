import {
  AI_EMPLOYEE_CAPABILITIES,
  AI_EMPLOYEE_PHASE0_SPIKES,
  listRouteableAiEmployeeCapabilities,
} from '../src/modules/runtime/ai-employee/ai-employee.contract';

function main() {
  const routeable = listRouteableAiEmployeeCapabilities();
  const blocked = AI_EMPLOYEE_CAPABILITIES.filter((item) => !item.routeableNow);

  const summary = {
    status: 'passed',
    checkedAt: new Date().toISOString(),
    totals: {
      capabilities: AI_EMPLOYEE_CAPABILITIES.length,
      routeableNow: routeable.length,
      blockedOrSpikeOnly: blocked.length,
      phase0Spikes: AI_EMPLOYEE_PHASE0_SPIKES.length,
    },
    routeable: routeable.map((item) => ({
      key: item.key,
      domain: item.domain,
      platform: item.platform,
      runtimePath: item.runtimePath,
      executorTaskType: item.executorTaskType,
    })),
    phase0Spikes: AI_EMPLOYEE_PHASE0_SPIKES.map((item) => ({
      id: item.id,
      title: item.title,
      capabilityKeys: item.capabilityKeys,
      proofRequired: item.proofRequired,
      exitCriteria: item.exitCriteria,
    })),
    blocked: blocked.map((item) => ({
      key: item.key,
      domain: item.domain,
      title: item.title,
      runtimePath: item.runtimePath,
      blockers: item.blockers,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
