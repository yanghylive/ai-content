/**
 * 聚推客联盟 · 生活服务场景接入（2026-08-09）
 *
 * 数据源：聚推客联盟开放平台（https://www.jutuike.com/document）
 * - 活动列表：本地精选配置表（LIFE_SERVICES），act_id 取自官网活动库
 * - 转链：GET http://api.jutuike.com/union/act?apikey=&sid=&act_id= → h5/小程序
 *
 * 与好单库（haodanku）的定位差异：
 * - 好单库 = 电商商品流（淘宝/京东/拼多多选品 + 美团活动）
 * - 聚推客 = 本地生活 CPS（外卖/出行/餐饮/到店/娱乐/充值），商品流之外的新场景
 *
 * 凭证（env）：JUTUIKE_APIKEY（个人中心获取，180 天自动续期）、JUTUIKE_SID（自定义跟单参数）
 */
import { Injectable, Logger } from '@nestjs/common';

export interface LifeServiceItem {
  actId: number;
  scene: string; // 场景 key：waimai / canyin / chuxing / daodian / yule / shenghuo
  name: string;
  desc: string;
  /** 卖点标签（卡片角标，如「最低5折」「新人12元」） */
  badge?: string;
  /** 官方 icon URL（部分活动有，空则前端用品牌色块兜底） */
  icon?: string;
}

export interface LifeServiceScene {
  key: string;
  label: string;
  items: LifeServiceItem[];
}

export interface LifeServiceView {
  configured: boolean;
  scenes: LifeServiceScene[];
  total: number;
  updatedAt: string;
}

export interface JutuikeTranslinkResult {
  actId: number;
  actName?: string;
  h5?: string;
  longH5?: string;
  weApp: { appId?: string; pagePath?: string; miniCode?: string } | null;
  error?: 'VENDOR_CREDENTIAL_MISSING' | 'VENDOR_API_ERROR';
}

/** 场景顺序与文案（对齐聚推客官网「生活服务」板块的展示逻辑） */
const SCENES: Array<{ key: string; label: string }> = [
  { key: 'waimai', label: '外卖' },
  { key: 'canyin', label: '连锁餐饮' },
  { key: 'chuxing', label: '出行' },
  { key: 'daodian', label: '到店周边' },
  { key: 'yule', label: '娱乐' },
  { key: 'shenghuo', label: '生活充值' },
];

/** 本地精选活动表（act_id 为聚推客联盟活动 ID；icon 取官网图床，缺省由前端色块兜底） */
const LIFE_SERVICES: LifeServiceItem[] = [
  // ===== 外卖 =====
  {
    actId: 1,
    scene: 'waimai',
    name: '美团外卖红包',
    desc: '外卖红包天天领，拼手气开惊喜',
    badge: '红包天天领',
    icon: 'https://img.jutuike.com/taokeout/icon/meituan.png',
  },
  {
    actId: 3,
    scene: 'waimai',
    name: '饿了么天天领红包',
    desc: '超值红包组合天天领',
    badge: '红包天天领',
    icon: 'https://img.jutuike.com/taokeout/icon/ele.png',
  },
  {
    actId: 59,
    scene: 'waimai',
    name: '饿了么高佣活动',
    desc: '领券下单立减，无门槛叠加用',
    badge: '下单立减',
    icon: 'https://img.jutuike.com/taokeout/icon/elmkb_icon.png',
  },
  // ===== 连锁餐饮 =====
  {
    actId: 57,
    scene: 'canyin',
    name: '聚合点餐',
    desc: '大牌连锁点餐，一站搞定',
    badge: '最低5折起',
    icon: 'https://img.jutuike.com/taokeout/icon/jhdc_icon.png',
  },
  {
    actId: 33,
    scene: 'canyin',
    name: '瑞幸咖啡',
    desc: '全场饮品优惠点餐',
    badge: '5.5折起',
  },
  {
    actId: 34,
    scene: 'canyin',
    name: '星巴克',
    desc: '饮品优惠点餐',
    badge: '低至8折',
  },
  {
    actId: 38,
    scene: 'canyin',
    name: '肯德基',
    desc: '在线点餐，美味速达',
    badge: '最低5折',
  },
  {
    actId: 64,
    scene: 'canyin',
    name: '必胜客',
    desc: '在线点餐',
    badge: '最低7折',
  },
  {
    actId: 37,
    scene: 'canyin',
    name: '喜茶',
    desc: '天天省，饮品优惠',
    badge: '全场9.5折',
  },
  {
    actId: 46,
    scene: 'canyin',
    name: '汉堡王',
    desc: '在线点餐',
    badge: '最低8.8折',
    icon: 'https://img.jutuike.com/taokeout/icon/burgerking.png',
  },
  {
    actId: 32,
    scene: 'canyin',
    name: '奈雪的茶',
    desc: '在线点餐',
    badge: '8.8折起',
  },
  {
    actId: 31,
    scene: 'canyin',
    name: '百果园',
    desc: '水果外送，新鲜到家',
    badge: '满49包邮',
  },
  // ===== 出行 =====
  {
    actId: 42,
    scene: 'chuxing',
    name: '滴滴打车',
    desc: '8折打车券，单笔最高抵扣10元',
    badge: '8折起',
    icon: 'https://img.jutuike.com/taokeout/icon/didi_dc_icon.png',
  },
  {
    actId: 49,
    scene: 'chuxing',
    name: '花小猪打车',
    desc: '最高可领100元券包',
    badge: '新人12元',
    icon: 'https://img.jutuike.com/taokeout/icon/jtk_hxz_icon.png',
  },
  {
    actId: 87,
    scene: 'chuxing',
    name: '同程打车',
    desc: '打车出行优惠',
    badge: '新人7元',
  },
  {
    actId: 53,
    scene: 'chuxing',
    name: '滴滴代驾',
    desc: '代驾优惠',
    badge: '最高立减13元',
  },
  {
    actId: 91,
    scene: 'chuxing',
    name: '飞猪火车票',
    desc: '安心购票，出行无忧',
    badge: '安心购票',
  },
  {
    actId: 43,
    scene: 'chuxing',
    name: '滴滴加油',
    desc: '加油满减券',
    badge: '最高20元券',
    icon: 'https://img.jutuike.com/taokeout/icon/didi_jy_icon.png',
  },
  {
    actId: 58,
    scene: 'chuxing',
    name: '小桔加油',
    desc: '全国加油享优惠',
    badge: '天天特价',
    icon: 'https://img.jutuike.com/taokeout/icon/jiayou2-icon.png',
  },
  // ===== 到店周边 =====
  {
    actId: 9,
    scene: 'daodian',
    name: '美团到店吃喝玩乐',
    desc: '全站商品批量推',
    badge: '最高4%佣金',
  },
  {
    actId: 28,
    scene: 'daodian',
    name: '美团酒店红包',
    desc: '酒店分销推广活动',
    badge: '酒店优惠',
  },
  {
    actId: 54,
    scene: 'daodian',
    name: '联联周边游',
    desc: '本地及周边吃喝玩乐福利抢购',
    badge: '福利抢购',
    icon: 'https://img.jutuike.com/taokeout/icon/llzby.png',
  },
  {
    actId: 62,
    scene: 'daodian',
    name: '旅划算周边游',
    desc: '吃喝玩乐超低折扣',
    badge: '超低折扣',
    icon: 'https://img.jutuike.com/taokeout/icon/lvhuasuan.png',
  },
  // ===== 娱乐 =====
  {
    actId: 76,
    scene: 'yule',
    name: '电影票在线预定',
    desc: '全国连锁影院在线选座',
    badge: '最低85折',
  },
  // ===== 生活充值 =====
  {
    actId: 52,
    scene: 'shenghuo',
    name: '特价快递',
    desc: '京东、顺丰等快递特价寄',
    badge: '运费低至4元',
    icon: 'https://img.jutuike.com/taokeout/icon/kuailon_icon.png',
  },
  {
    actId: 48,
    scene: 'shenghuo',
    name: '电费充值',
    desc: '电费充值优惠',
    badge: '97.5折',
    icon: 'https://img.jutuike.com/taokeout/icon/df_jtk.png',
  },
  {
    actId: 55,
    scene: 'shenghuo',
    name: '话费充值',
    desc: '快充 0-24 小时到账',
    badge: '到账快',
    icon: 'https://img.jutuike.com/taokeout/icon/mobile.png',
  },
  {
    actId: 50,
    scene: 'shenghuo',
    name: '会员卡券',
    desc: '会员卡券充值优惠',
    badge: '最低3折',
    icon: 'https://img.jutuike.com/taokeout/icon/digital.png',
  },
];

const API_BASE = 'http://api.jutuike.com';

@Injectable()
export class JutuikeLifeService {
  private readonly logger = new Logger(JutuikeLifeService.name);

  /** 生活服务场景分组列表（本地精选配置，不依赖网络） */
  listServices(): LifeServiceView {
    const apikey = process.env.JUTUIKE_APIKEY?.trim();
    const scenes = SCENES.map((s) => ({
      key: s.key,
      label: s.label,
      items: LIFE_SERVICES.filter((i) => i.scene === s.key),
    })).filter((s) => s.items.length > 0);
    return {
      configured: Boolean(apikey),
      scenes,
      total: LIFE_SERVICES.length,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 统一活动转链（聚推客 doc/48）
   * GET {API_BASE}/union/act?apikey=&sid=&act_id= → { code, msg, data: { h5, long_h5, we_app_info } }
   */
  async translink(
    actId: number,
    sid?: string,
  ): Promise<JutuikeTranslinkResult> {
    const apikey = process.env.JUTUIKE_APIKEY?.trim();
    if (!apikey) {
      return { actId, weApp: null, error: 'VENDOR_CREDENTIAL_MISSING' };
    }
    const target = LIFE_SERVICES.find((i) => i.actId === actId);
    const actName = target?.name;
    const query = new URLSearchParams({
      apikey,
      sid: sid?.trim() || process.env.JUTUIKE_SID?.trim() || 'jiuzhang-ai',
      act_id: String(actId),
    });

    try {
      const res = await fetch(`${API_BASE}/union/act?${query.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(`jutuike translink HTTP ${res.status} act=${actId}`);
        return { actId, actName, weApp: null, error: 'VENDOR_API_ERROR' };
      }
      const body = (await res.json()) as {
        code: number;
        msg: string;
        data?: {
          h5?: string;
          long_h5?: string;
          we_app_info?: {
            app_id?: string;
            page_path?: string;
            mini_code?: string;
          };
          act_name?: string;
        };
      };
      if (body.code !== 1 || !body.data) {
        this.logger.warn(`jutuike translink failed: ${body.code} ${body.msg}`);
        return { actId, actName, weApp: null, error: 'VENDOR_API_ERROR' };
      }
      return {
        actId,
        actName: body.data.act_name || actName,
        h5: body.data.h5,
        longH5: body.data.long_h5,
        weApp: body.data.we_app_info
          ? {
              appId: body.data.we_app_info.app_id,
              pagePath: body.data.we_app_info.page_path,
              miniCode: body.data.we_app_info.mini_code,
            }
          : null,
      };
    } catch (e) {
      this.logger.warn(
        `jutuike translink error act=${actId}: ${(e as Error).message}`,
      );
      return { actId, actName, weApp: null, error: 'VENDOR_API_ERROR' };
    }
  }
}
