/**
 * 演示舱 mock 联系人（纯虚构数据，合规书第五节第 4 条）
 * 没有任何真实微信 ID / 真实手机号 / 真实姓名。
 */

export interface DemoContact {
  wxid: string;
  nickname: string;
  remark: string;
  group: string;
}

export const DEMO_CONTACTS: DemoContact[] = [
  { wxid: 'demo_user_001', nickname: '演示用户·林晚', remark: 'mock-意向客户', group: '意向客户' },
  { wxid: 'demo_user_002', nickname: '演示用户·沈舟', remark: 'mock-意向客户', group: '意向客户' },
  { wxid: 'demo_user_003', nickname: '演示用户·顾一帆', remark: 'mock-意向客户', group: '意向客户' },
  { wxid: 'demo_user_004', nickname: '演示用户·苏晓', remark: 'mock-意向客户', group: '意向客户' },
  { wxid: 'demo_user_005', nickname: '演示用户·陈默', remark: 'mock-意向客户', group: '意向客户' },
  { wxid: 'demo_user_006', nickname: '演示用户·赵清越', remark: 'mock-已成交', group: '已成交' },
  { wxid: 'demo_user_007', nickname: '演示用户·何欢', remark: 'mock-已成交', group: '已成交' },
  { wxid: 'demo_user_008', nickname: '演示用户·高远', remark: 'mock-已成交', group: '已成交' },
  { wxid: 'demo_user_009', nickname: '演示用户·罗一', remark: 'mock-已成交', group: '已成交' },
  { wxid: 'demo_user_010', nickname: '演示用户·梁音', remark: 'mock-已成交', group: '已成交' },
  { wxid: 'demo_user_011', nickname: '演示用户·宋知微', remark: 'mock-渠道', group: '渠道伙伴' },
  { wxid: 'demo_user_012', nickname: '演示用户·郑好', remark: 'mock-渠道', group: '渠道伙伴' },
  { wxid: 'demo_user_013', nickname: '演示用户·谢云舟', remark: 'mock-渠道', group: '渠道伙伴' },
  { wxid: 'demo_user_014', nickname: '演示用户·韩笑', remark: 'mock-渠道', group: '渠道伙伴' },
  { wxid: 'demo_user_015', nickname: '演示用户·唐果', remark: 'mock-渠道', group: '渠道伙伴' },
  { wxid: 'demo_user_016', nickname: '演示用户·冯程', remark: 'mock-新线索', group: '新线索' },
  { wxid: 'demo_user_017', nickname: '演示用户·于曼', remark: 'mock-新线索', group: '新线索' },
  { wxid: 'demo_user_018', nickname: '演示用户·董立', remark: 'mock-新线索', group: '新线索' },
  { wxid: 'demo_user_019', nickname: '演示用户·萧然', remark: 'mock-新线索', group: '新线索' },
  { wxid: 'demo_user_020', nickname: '演示用户·程诺', remark: 'mock-新线索', group: '新线索' },
  { wxid: 'demo_user_021', nickname: '演示用户·曹原', remark: 'mock-新线索', group: '新线索' },
  { wxid: 'demo_user_022', nickname: '演示用户·袁梦', remark: 'mock-新线索', group: '新线索' },
  { wxid: 'demo_user_023', nickname: '演示用户·邓凯', remark: 'mock-沉默', group: '沉默客户' },
  { wxid: 'demo_user_024', nickname: '演示用户·许诺', remark: 'mock-沉默', group: '沉默客户' },
  { wxid: 'demo_user_025', nickname: '演示用户·傅铭', remark: 'mock-沉默', group: '沉默客户' },
  { wxid: 'demo_user_026', nickname: '演示用户·沈嘉', remark: 'mock-沉默', group: '沉默客户' },
  { wxid: 'demo_user_027', nickname: '演示用户·彭湃', remark: 'mock-沉默', group: '沉默客户' },
  { wxid: 'demo_user_028', nickname: '演示用户·吕杉', remark: 'mock-沉默', group: '沉默客户' },
  { wxid: 'demo_user_029', nickname: '演示用户·苏醒', remark: 'mock-沉默', group: '沉默客户' },
  { wxid: 'demo_user_030', nickname: '演示用户·卢一诺', remark: 'mock-沉默', group: '沉默客户' },
];
