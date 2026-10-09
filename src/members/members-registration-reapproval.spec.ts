import * as membersQueries from '../database/queries/members.queries';
import type { RegistrationRow } from '../database/queries/registrations.queries';
import { MembersService } from './members.service';

describe('MembersService.upsertFromApprovedRegistration', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reativa o membro e troca a face ao reaprovar um cadastro rejeitado', async () => {
    jest.spyOn(membersQueries, 'getMemberByRegistrationId').mockResolvedValue({
      id: 'member-1',
      name: 'Ana',
      isActive: false,
    } as never);
    const update = jest
      .spyOn(membersQueries, 'updateMember')
      .mockResolvedValue({ id: 'member-1', isActive: true } as never);
    const service = new MembersService(
      { db: {} } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.upsertFromApprovedRegistration(
      {
        id: 'reg-1',
        clientId: 'client-1',
        name: 'Ana',
        faceId: 23,
        faceImageKey: 'nova-foto.jpg',
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      } as RegistrationRow,
      'condominium',
    );

    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      'member-1',
      'client-1',
      expect.objectContaining({
        isActive: true,
        faceId: 23,
        photoKey: 'nova-foto.jpg',
        deviceSyncStatus: 'pending_sync',
      }),
    );
  });
});
