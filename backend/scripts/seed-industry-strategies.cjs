/**
 * D1：P0 5 行业策略预设入库（2026-08-09）
 * 美业 / 餐饮 / 教育 / 微商 / 直销
 * 每个行业 6 字段：targetAudience / commercialGoal / corePainPoints / writingAngles / toneAndStyle
 * 人工精写（质量灵魂），直销含传销红线约束（注入 toneAndStyle + writingAngles）
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const STRATEGIES = [
  {
    name: '美业内容策略',
    description: '面向美容/美发/美甲/医美/SPA 门店的内容创作策略',
    industry: '美业',
    targetAudience: '25-45 岁注重形象与自我投资的女性，本地消费为主，关注皮肤/身材/发型管理，决策受小红书种草与朋友圈口碑影响',
    commercialGoal: '新客到店体验 → 会员办卡 → 周期复购，建立「专业+懂我」的门店信任',
    corePainPoints: '怕被强推销、怕效果夸大失望、怕卫生与安全不达标、价格不透明、怕做完变丑（决策焦虑）',
    writingAngles: '真实效果对比、客户变美故事、专业知识科普（破除误区）、项目避坑指南、限时福利活动、门店环境与卫生展示',
    toneAndStyle: '亲切专业、像闺蜜推荐而非销售话术、少套路多真诚、用真实案例说话、避免夸大承诺（尤其医美需合规）',
  },
  {
    name: '餐饮内容策略',
    description: '面向正餐/快餐/咖啡茶饮/烘焙店的内容创作策略',
    industry: '餐饮',
    targetAudience: '本地 18-50 岁吃货与家庭/朋友聚餐人群，决策受大众点评/抖音探店/朋友圈影响，追求性价比与新鲜感',
    commercialGoal: '到店引流 → 团购/储值 → 复购，建立「本地人爱吃」的烟火气口碑',
    corePainPoints: '怕难吃踩雷、怕贵不值、怕排队等太久、怕卫生不达标、选择太多无从下手',
    writingAngles: '招牌菜实拍种草、隐藏菜单揭秘、老板创业故事、性价比实测、团购福利、深夜食堂/节日聚餐场景',
    toneAndStyle: '烟火气、真实接地气、直给福利、用味道和氛围说话、少修饰多实拍',
  },
  {
    name: '教育内容策略',
    description: '面向 K12 培训/成人考证/早教/素质教育机构的内容创作策略',
    industry: '教育',
    targetAudience: 'K12 家长（焦虑决策）与成人学习者（考证/技能提升），家庭消费决策，重视效果与口碑',
    commercialGoal: '课程咨询 → 试听转化 → 报课 → 续费/转介绍，建立「专业可信」的教育品牌',
    corePainPoints: '怕无效浪费钱、怕踩坑选错机构、怕孩子落后焦虑、怕老师不专业、价格敏感但愿为效果买单',
    writingAngles: '学习方法干货、常见误区澄清、学员真实成果见证、师资专业展示、限时优惠、教育理念输出（共鸣家长）',
    toneAndStyle: '专业可信、有权威感、共情家长焦虑但不贩卖焦虑、用数据与成果说话',
  },
  {
    name: '微商内容策略',
    description: '面向朋友圈卖货/社交电商店主的内容创作策略',
    industry: '微商',
    targetAudience: '微信好友与私域客户（信任型消费），靠朋友圈日常渗透建立人设后转化，复购与转介绍为核心',
    commercialGoal: '加粉 → 发圈种草 → 私聊成交 → 复购转介绍，建立「靠谱人设」的信任生意',
    corePainPoints: '发圈没人看/被屏蔽、文案同质化无记忆点、只会硬广不会软性种草、私聊不会开口/不会追单、信任建立难',
    writingAngles: '日常种草（用起来再说）、客户真实反馈、下单见证、生活人设（有温度）、副业机会展示、限时福利',
    toneAndStyle: '像朋友分享而非推销、真实有温度、先价值后成交、避免刷屏式硬广、善用故事与场景',
  },
  {
    name: '直销内容策略',
    description: '面向直销代理/团队/轻创业人群的内容创作策略',
    industry: '直销',
    targetAudience: '想找副业/轻创业机会的 25-45 岁人群，对「时间自由+收入弹性」敏感，决策靠信任与榜样',
    commercialGoal: '事业机会展示 → 招募伙伴 → 团队建设 → 复制成长，建立「可跟可学」的团队磁场',
    corePainPoints: '怕被当传销、怕投入打水漂、怕没能力做、怕被家人反对、市面上机会太多真假难辨',
    writingAngles: '事业机会理性展示、制度模式透明解读、领导人真实成长故事、新人 30 天见证、招商会邀约、避坑鉴别指南',
    toneAndStyle: '理性+正能量、不吹嘘不画饼、用真实历程说话、透明讲清模式与投入、严禁收益承诺与拉人头话术（传销红线）',
  },
  {
    name: '健身内容策略',
    description: '面向健身房/瑜伽/私教/塑形工作室的内容创作策略',
    industry: '健身',
    targetAudience: '20-45 岁关注身材管理与健康的都市人群，会员卡决策受效果口碑与体验课影响，女性私教/瑜伽客群付费意愿强',
    commercialGoal: '体验课引流 → 会员卡转化 → 续课/私教课包 → 转介绍，建立「有效果+有氛围」的健身品牌',
    corePainPoints: '怕坚持不下来浪费钱、怕练错受伤、怕被推销、健身房离家远/环境差、身材焦虑但无从下手',
    writingAngles: '学员前后对比见证、教练专业展示（资质/方法）、常见训练误区科普、体验课福利、训练日常氛围、饮食搭配干货',
    toneAndStyle: '专业有能量、激励但不贩卖焦虑、用真实学员案例说话、强调科学训练与陪伴感',
  },
  {
    name: '母婴内容策略',
    description: '面向母婴店/产后修复/月嫂/托育机构的内容创作策略',
    industry: '母婴',
    targetAudience: '孕期与 0-6 岁宝宝的父母（妈妈决策为主），高信任型消费，口碑与专业度决定选择',
    commercialGoal: '信任建立 → 到店/咨询 → 办卡/服务转化 → 复购转介绍，建立「懂母婴+专业」的品牌形象',
    corePainPoints: '育儿焦虑（怕带不好）、怕产品不安全、怕被坑智商税、产后恢复焦虑、月嫂/托育怕不靠谱',
    writingAngles: '育儿知识干货、产品安全科普（成分/认证）、产后恢复科学讲解、真实妈妈案例、专业资质展示、节日亲子活动',
    toneAndStyle: '温暖专业、像懂行的闺蜜妈妈、用知识建立信任、不制造焦虑、强调安全与科学',
  },
  {
    name: '本地生活服务策略',
    description: '面向家政/维修/宠物/洗护等服务型商家的内容创作策略',
    industry: '本地生活',
    targetAudience: '本地 25-55 岁家庭，需要保洁/维修/宠物/洗护等上门或到店服务，决策靠口碑与便利性',
    commercialGoal: '服务咨询 → 下单转化 → 复购/包年 → 转介绍，建立「靠谱省心」的本地服务品牌',
    corePainPoints: '怕不专业/不卫生、怕乱收费、怕来了不走心、找服务麻烦、怕售后无保障',
    writingAngles: '服务过程真实展示（前后对比）、价格透明承诺、专业资质/工具展示、客户好评见证、便民小知识、限时优惠',
    toneAndStyle: '实在靠谱、透明不虚、用细节建立信任、突出省心与保障',
  },
  {
    name: '电商零售内容策略',
    description: '面向服饰/百货/数码/食品电商店铺的内容创作策略',
    industry: '电商零售',
    targetAudience: '18-45 岁网购人群，冲动与理性并存，决策受种草内容/优惠/评价影响，复购靠品质与体验',
    commercialGoal: '新品种草 → 下单转化 → 复购 → 会员沉淀，建立「品质+性价比」的店铺口碑',
    corePainPoints: '怕货不对板、怕质量差/色差、价格对比焦虑、选择困难、担心售后麻烦',
    writingAngles: '新品实拍种草、使用场景展示、材质/工艺细节、真实买家秀、限时优惠/清仓、穿搭/搭配攻略',
    toneAndStyle: '活泼种草、真实不吹、多用场景与细节说话、突出性价比与售后保障',
  },
  {
    name: '医疗健康内容策略',
    description: '面向诊所/口腔/中医/体检机构的内容创作策略',
    industry: '医疗健康',
    targetAudience: '关心健康与亚健康改善的 25-60 岁人群，家庭健康决策，对专业资质与口碑高度敏感',
    commercialGoal: '科普信任 → 到院咨询/体检 → 服务转化 → 家庭复购，建立「专业可信」的医疗机构品牌',
    corePainPoints: '怕误诊/不专业、怕过度医疗、怕乱收费、体检怕麻烦、对医院有心理抗拒',
    writingAngles: '健康科普干货、常见误区澄清、医生专业背景展示、体检流程透明、真实患者（脱敏）见证、公益/便民活动',
    toneAndStyle: '专业严谨可信、通俗易懂、用资质与数据说话、严禁疗效承诺与夸大（广告法红线）',
  },
];

async function main() {
  let created = 0, updated = 0;
  for (const s of STRATEGIES) {
    const existing = await p.contentStrategy.findUnique({ where: { name: s.name } });
    if (existing) {
      await p.contentStrategy.update({ where: { name: s.name }, data: s });
      updated++;
    } else {
      await p.contentStrategy.create({ data: { ...s, enabled: true } });
      created++;
    }
  }
  console.log(`✅ 行业策略预设：新建 ${created}，更新 ${updated}`);
  const all = await p.contentStrategy.findMany({ where: { industry: { in: ['美业', '餐饮', '教育', '微商', '直销', '健身', '母婴', '本地生活', '电商零售', '医疗健康'] } } });
  console.log(`当前 10 行业策略数：${all.length}`);
  for (const s of all) console.log(`  - ${s.industry}：${s.name}`);
}

main().catch((e) => { console.error('❌', e); process.exit(1); }).finally(() => p.$disconnect());
