import { BadRequestException } from '@nestjs/common';
import { RedfoxCollectService } from './redfox-collect.service';

// 只测 extractWorkId（私有通过原型访问）——验证 C 类链接识别
describe('RedfoxCollectService C 类链接解析（真机上报修复）', () => {
  function extractWorkId(url: string): string {
    const proto = RedfoxCollectService.prototype as unknown as {
      extractWorkId(u: string): string;
    };
    return proto.extractWorkId(url);
  }

  it('video 作品链接：提取 workId', () => {
    expect(extractWorkId('https://www.douyin.com/video/7351234567890123456')).toBe('7351234567890123456');
  });

  it('share/video 链接：提取 workId', () => {
    expect(extractWorkId('https://v.douyin.com/xxxx/')).toBe('');
  });

  it('modal_id 链接：提取 workId', () => {
    expect(extractWorkId('https://www.douyin.com/?modal_id=7351234567890123456')).toBe('7351234567890123456');
  });

  it('个人主页链接：返回空（上游给出 400 明确提示）', () => {
    expect(extractWorkId('https://www.douyin.com/user/MS4wLjABAAAA')).toBe('');
  });

  it('短链 v.douyin.com：返回空（提示先展开）', () => {
    expect(extractWorkId('https://v.douyin.com/iRNBxYc/')).toBe('');
  });

  it('note 小红书链接：提取 noteId', () => {
    expect(extractWorkId('https://www.xiaohongshu.com/explore/66a1b2c3d4e5f6a7b8c9d0e1?xsec_token=abc')).toBe('66a1b2c3d4e5f6a7b8c9d0e1');
  });
});
