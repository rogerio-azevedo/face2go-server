import { findAccessPersonIdsByLocation } from './find-access-person-ids-by-location';

describe('findAccessPersonIdsByLocation', () => {
  it('não consulta o banco sem bloco nem unidade', async () => {
    const select = jest.fn();
    const result = await findAccessPersonIdsByLocation(
      { select } as never,
      { companyId: 'company-1' },
    );
    expect(result).toEqual({ memberIds: [], registrationIds: [] });
    expect(select).not.toHaveBeenCalled();
  });

  it('filtra pessoas pela unidade vinculada', async () => {
    const where = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'member-1' }])
      .mockResolvedValueOnce([{ id: 'reg-1' }]);
    const innerJoin = jest.fn();
    const from = jest.fn();
    const select = jest.fn();
    const chain = { from, innerJoin, where };
    select.mockReturnValue(chain);
    from.mockReturnValue(chain);
    innerJoin.mockReturnValue(chain);

    const result = await findAccessPersonIdsByLocation(
      { select } as never,
      {
        companyId: 'company-1',
        clientId: 'client-1',
        blockId: 'block-1',
        unitId: 'unit-1',
      },
    );

    expect(result).toEqual({
      memberIds: ['member-1'],
      registrationIds: ['reg-1'],
    });
    expect(innerJoin).toHaveBeenCalled();
    expect(where).toHaveBeenCalledTimes(2);
  });
});
