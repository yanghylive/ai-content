import { REDFOX_SKILL_CATALOG, findRedfoxSkill, redfoxSkillByDocId } from './redfox-skill-catalog';

describe('RedFox skill catalog', () => {
  it('官方目录建模完整（≥40 项，含全部平台/AI 工具）', () => {
    expect(REDFOX_SKILL_CATALOG.length).toBeGreaterThanOrEqual(40);
    const platforms = REDFOX_SKILL_CATALOG.filter((s) => s.category === 'platform');
    expect(platforms.length).toBeGreaterThanOrEqual(20);
    const tools = REDFOX_SKILL_CATALOG.filter((s) => s.category === 'ai-tool');
    expect(tools.length).toBeGreaterThanOrEqual(10);
  });

  it('大王给的 FXDGJO1V = 上传图片', () => {
    const skill = redfoxSkillByDocId('FXDGJO1V');
    expect(skill?.name).toContain('上传图片');
  });

  it('按关键词检索（平台/中文名/docId）', () => {
    const byPlatform = findRedfoxSkill('douyin');
    expect(byPlatform.length).toBeGreaterThanOrEqual(5);
    const byName = findRedfoxSkill('爆款');
    expect(byName.length).toBeGreaterThanOrEqual(1);
    const byDocId = findRedfoxSkill('FXDGJO1V');
    expect(byDocId[0].name).toContain('上传图片');
  });

  it('本地已接入技能有 localSkillCode 标注', () => {
    const local = REDFOX_SKILL_CATALOG.filter((s) => s.localSkillCode);
    expect(local.length).toBeGreaterThanOrEqual(3);
  });
});
