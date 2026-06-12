import { AgentSService } from './agent-s.service';

describe('AgentSService approval compatibility', () => {
  it('falls back from /approve to Python sidecar /approval', async () => {
    const service = new AgentSService(
      { get: jest.fn().mockReturnValue(undefined) } as any,
      {} as any,
      {} as any,
    );
    const post = jest
      .fn()
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 404 },
      })
      .mockResolvedValueOnce({
        data: {
          session_id: 'session-1',
          status: 'completed',
          decision: 'approved',
        },
      });
    (service as any).client = { post };

    const result = await service.approveSession('session-1', {
      decision: 'approved',
      comment: 'ok',
    });

    expect(result).toEqual({
      session_id: 'session-1',
      status: 'completed',
      decision: 'approved',
    });
    expect(post).toHaveBeenNthCalledWith(1, '/sessions/session-1/approve', {
      decision: 'approved',
      comment: 'ok',
    });
    expect(post).toHaveBeenNthCalledWith(2, '/sessions/session-1/approval', {
      decision: 'approved',
      comment: 'ok',
    });
  });
});
