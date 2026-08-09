import { IS_PUBLIC_KEY } from '../auth/auth.decorator';
import { GeoBridgeController } from './geo-bridge.controller';

describe('GeoBridgeController route access', () => {
  it('does not bypass the global auth guard', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, GeoBridgeController),
    ).toBeUndefined();
  });
});
