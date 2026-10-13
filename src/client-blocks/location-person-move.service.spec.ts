import { ForbiddenException } from '@nestjs/common';
import { LocationPersonMoveService } from './location-person-move.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { MoveLocationPersonInput } from '../validation/client-blocks.schema';

const user = {
  role: 'company_admin',
  sub: 'actor',
  companyId: 'company',
} as JwtPayload;
const input = {
  kind: 'member',
  personId: 'person',
  sourceUnitId: 'source',
  targetBlockId: 'block',
  targetUnitId: 'target',
} as MoveLocationPersonInput;
describe('LocationPersonMoveService', () => {
  const access = { assertManage: jest.fn() };
  const moves = { move: jest.fn() };
  const service = new LocationPersonMoveService(
    access as never,
    moves as never,
  );
  beforeEach(() => {
    jest.resetAllMocks();
  });
  it('checks tenant access before updating one person with the session actor', async () => {
    await expect(service.move(user, 'client', input)).resolves.toEqual({
      success: true,
    });
    expect(access.assertManage).toHaveBeenCalledWith(user, 'client');
    expect(moves.move).toHaveBeenCalledWith('client', 'actor', input);
  });
  it.each(['company_operator', 'client_admin', 'client_operator', 'member'])(
    'rejects role %s',
    async (role) => {
      await expect(
        service.move({ ...user, role }, 'client', input),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(moves.move).not.toHaveBeenCalled();
    },
  );
  it('rejects cross-tenant access without persisting', async () => {
    access.assertManage.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.move(user, 'other-client', input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(moves.move).not.toHaveBeenCalled();
  });
});
