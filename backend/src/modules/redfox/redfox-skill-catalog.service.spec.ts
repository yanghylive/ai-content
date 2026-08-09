import { RedfoxSkillCatalogService } from './redfox-skill-catalog.service';

function makePrisma() {
  const skills: any[] = [];
  const installs: any[] = [];
  const withInstalls = (skill: any) => ({
    ...skill,
    installs: installs.filter((install) => install.skillId === skill.id),
  });
  return {
    redfoxSkill: {
      findMany: jest.fn(async () => skills.map(withInstalls)),
      findUnique: jest.fn(
        async ({ where }: any) =>
          skills.find(
            (skill) => skill.code === where.code || skill.id === where.id,
          ) || null,
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        const values =
          where.OR?.map((item: any) => item.id || item.code || item.skillNo) ||
          [];
        return (
          skills.find(
            (skill) =>
              values.includes(skill.id) ||
              values.includes(skill.code) ||
              values.includes(skill.skillNo),
          ) || null
        );
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const skill = skills.find((item) => item.id === where.id);
        if (!skill) throw new Error('not found');
        return withInstalls(skill);
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `skill-${skills.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        skills.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = skills.findIndex((item) => item.id === where.id);
        skills[index] = { ...skills[index], ...data, updatedAt: new Date() };
        return skills[index];
      }),
      count: jest.fn(async () => skills.length),
    },
    redfoxSkillInstall: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          installs.find((item) => item.skillId === where.skillId) || null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `install-${installs.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        installs.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = installs.findIndex((item) => item.id === where.id);
        installs[index] = {
          ...installs[index],
          ...data,
          updatedAt: new Date(),
        };
        return installs[index];
      }),
    },
  };
}

describe('RedfoxSkillCatalogService', () => {
  it('normalizes remote skill payloads and preserves local enablement on resync', async () => {
    const catalog = new RedfoxSkillCatalogService(makePrisma() as any);
    const scope = {
      key: 'tenant-1:user-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    };

    const firstSync = await catalog.syncFromRemote({
      data: {
        list: [
          {
            skillNo: '1001',
            code: 'xhs-hot-notes',
            name: '小红书爆款笔记查询',
            platform: 'xiaohongshu',
            tags: ['爆款', '搜索'],
            description: '查询小红书爆款内容',
          },
        ],
      },
    });

    expect(firstSync).toEqual(
      expect.objectContaining({
        received: 1,
        created: 1,
        updated: 0,
        total: 1,
      }),
    );

    const updated = await catalog.updateSkill(scope, 'xhs-hot-notes', {
      enabled: true,
      scenario: 'viral',
      tags: ['爆款', '增长'],
    });
    expect(updated.enabled).toBe(true);
    expect(updated.scenario).toBe('viral');

    const secondSync = await catalog.syncFromRemote({
      data: {
        list: [
          {
            skillNo: '1001',
            code: 'xhs-hot-notes',
            name: '小红书爆款笔记查询',
            platform: 'xiaohongshu',
            tags: ['爆款', '内容样本'],
            description: '远端说明更新',
          },
        ],
      },
    });

    expect(secondSync.updated).toBe(1);
    const skills = (
      await catalog.list(scope, { keyword: '小红书', page: 1, limit: 10 })
    ).items;
    expect(skills[0]).toEqual(
      expect.objectContaining({
        id: 'xhs-hot-notes',
        enabled: true,
        scenario: 'viral',
        summary: '远端说明更新',
      }),
    );
    expect(skills[0].tags).toEqual(
      expect.arrayContaining(['爆款', '内容样本', '增长']),
    );
  });
});
