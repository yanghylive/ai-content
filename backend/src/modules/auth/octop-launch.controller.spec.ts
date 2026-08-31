import { Test } from '@nestjs/testing';
import { OctopLaunchController } from './octop-launch.controller';
import { KaypalOctopBridge } from '../agent-gateway/kaypal-octop-bridge';

/**
 * Octop 免登录链路（复核整改 2026-08-31）：
 * 3010 登录态 → launch → bridge 换 token → 桌面端注入免登录（用户不见 Octop 登录页）。
 * 覆盖：未登录 401 / octop 未运行短路降级 / token 换发成功 / 凭据失配降级+显式告警。
 */
describe('OctopLaunchController', () => {
  let controller: OctopLaunchController;
  let bridge: { loginOctop: jest.Mock };

  const fetchMock = jest.fn();

  beforeEach(async () => {
    bridge = { loginOctop: jest.fn() };
    (globalThis as Record<string, unknown>).fetch = fetchMock;
    process.env.OCTOP_BASE_URL = 'http://127.0.0.1:8088';
    const module = await Test.createTestingModule({
      controllers: [OctopLaunchController],
      providers: [{ provide: KaypalOctopBridge, useValue: bridge }],
    }).compile();
    controller = module.get(OctopLaunchController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.OCTOP_BASE_URL;
  });

  const req = (authUser?: { id: string }) =>
    ({ authUser }) as unknown as Parameters<OctopLaunchController['launch']>[0];

  it('未登录 → 401', async () => {
    await expect(controller.launch(req(undefined))).rejects.toThrow('请先登录');
  });

  it('Octop 未运行（health 失败）→ 短路降级 healthy=false、token=null、不调 bridge', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const out = await controller.launch(req({ id: 'user-1' }));
    expect(out.healthy).toBe(false);
    expect(out.token).toBeNull();
    expect(bridge.loginOctop).not.toHaveBeenCalled();
  });

  it('Octop 在线 + 凭据正常 → token 返回（per-user isolated）', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    bridge.loginOctop.mockResolvedValueOnce({
      token: 'octop-token-abc',
      isolated: true,
    });
    const out = await controller.launch(req({ id: 'user-1' }));
    expect(out.healthy).toBe(true);
    expect(out.token).toBe('octop-token-abc');
    expect(out.isolated).toBe(true);
    expect(bridge.loginOctop).toHaveBeenCalledWith({ kaypalUserId: 'user-1' });
  });

  it('Octop 在线但凭据失配（bridge 抛错）→ token=null 降级 + 显式告警日志', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({ ok: true });
    bridge.loginOctop.mockRejectedValueOnce(new Error('AUTH_FAILED'));
    const out = await controller.launch(req({ id: 'user-1' }));
    expect(out.healthy).toBe(true);
    expect(out.token).toBeNull();
    // v1.1.109（复核整改）：不得静默降级——必须打显式告警（凭据失配 → 用户会看到
    // Octop 登录页，日志要给出排查方向）
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('OctopLaunch'),
      expect.any(String),
    );
    expect(warnSpy.mock.calls[0][0]).toContain('凭据不匹配');
  });
});
