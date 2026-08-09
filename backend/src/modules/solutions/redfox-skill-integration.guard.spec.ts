import { REDFOX_SKILL_MAPPINGS } from '../redfox/redfox-skill-mapping.catalog';
import { findRedfoxSkillMapping } from '../redfox/redfox-skill-mapping.catalog';
import { SOLUTION_PACKAGES } from './solutions.catalog';

describe('RedFox skill integration guard', () => {
  const packageSkillRefs = SOLUTION_PACKAGES.flatMap((solutionPackage) =>
    solutionPackage.redfoxSkills.map((skillName) => ({
      packageCode: solutionPackage.code,
      skillName,
      mapping: findRedfoxSkillMapping(skillName),
    })),
  );

  it('keeps the documented solution package scope fixed', () => {
    expect(SOLUTION_PACKAGES).toHaveLength(15);
    expect(
      SOLUTION_PACKAGES.filter((item) => item.category === 'core'),
    ).toHaveLength(5);
    expect(
      SOLUTION_PACKAGES.filter((item) => item.category === 'redfox_pool'),
    ).toHaveLength(10);
    expect(packageSkillRefs).toHaveLength(64);
    expect(new Set(packageSkillRefs.map((item) => item.skillName)).size).toBe(
      57,
    );
  });

  it('keeps all package skill refs mapped to exactly one runnable lane', () => {
    const unmapped = packageSkillRefs.filter((item) => !item.mapping);
    const apiRefs = packageSkillRefs.filter((item) => item.mapping?.path);
    const skillHubRefs = packageSkillRefs.filter(
      (item) =>
        item.mapping && !item.mapping.path && item.mapping.skillHubRefs?.length,
    );
    const contractOnlyRefs = packageSkillRefs.filter(
      (item) =>
        item.mapping &&
        !item.mapping.path &&
        !item.mapping.skillHubRefs?.length,
    );

    expect(unmapped).toEqual([]);
    expect(apiRefs).toHaveLength(43);
    expect(skillHubRefs).toHaveLength(21);
    expect(contractOnlyRefs).toEqual([]);

    for (const item of packageSkillRefs) {
      expect(item.mapping?.inputContract).toBeTruthy();
      expect(item.mapping?.outputObjects.length).toBeGreaterThan(0);
    }
  });

  it('keeps the official SkillHub candidate set explicit', () => {
    const officialSkillHubCodes = new Set(
      REDFOX_SKILL_MAPPINGS.flatMap((mapping) =>
        (mapping.skillHubRefs || []).map(
          (skillHubRef) => skillHubRef.skillCode,
        ),
      ),
    );

    expect(REDFOX_SKILL_MAPPINGS).toHaveLength(36);
    expect(officialSkillHubCodes.size).toBe(21);

    for (const mapping of REDFOX_SKILL_MAPPINGS) {
      expect(mapping.skillCode).toBeTruthy();
      expect(mapping.skillName).toBeTruthy();
      expect(mapping.outputObjects.length).toBeGreaterThan(0);
      expect(mapping.inputContract).toBeTruthy();
      for (const skillHubRef of mapping.skillHubRefs || []) {
        expect(skillHubRef.skillNo).toBeTruthy();
        expect(skillHubRef.skillCode).toBeTruthy();
        expect(skillHubRef.repoUrl).toContain(
          'github.com/redfox-data/redfox-community',
        );
      }
    }
  });

  it('keeps every product package tied to a /solutions entry and SolutionRun', () => {
    for (const solutionPackage of SOLUTION_PACKAGES) {
      expect(solutionPackage.entryPath).toMatch(/^\/solutions\//);
      expect(solutionPackage.workflow.length).toBeGreaterThan(0);
      expect(solutionPackage.acceptance.length).toBeGreaterThan(0);
      expect(solutionPackage.dataObjects).toContain('SolutionRun');
    }
  });
});
