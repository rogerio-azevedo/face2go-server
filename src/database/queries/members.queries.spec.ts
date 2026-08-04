import * as membersQueries from './members.queries';

describe('unlinkNonSchoolMemberLogins', () => {
  it('desvincula login de membros em clientes que não são escola', async () => {
    const whereUpdate = jest.fn().mockResolvedValue(undefined);
    const setUpdate = jest.fn().mockReturnValue({ where: whereUpdate });
    const update = jest.fn().mockReturnValue({ set: setUpdate });

    const whereSelect = jest
      .fn()
      .mockResolvedValue([{ id: 'member-condo-1' }, { id: 'member-condo-2' }]);
    const innerJoin = jest.fn().mockReturnValue({ where: whereSelect });
    const from = jest.fn().mockReturnValue({ innerJoin });
    const select = jest.fn().mockReturnValue({ from });

    const db = { select, update };

    const count = await membersQueries.unlinkNonSchoolMemberLogins(db as never);

    expect(count).toBe(2);
    expect(update).toHaveBeenCalled();
    expect(whereUpdate).toHaveBeenCalled();
  });

  it('retorna 0 quando não há membros não-escola com login', async () => {
    const whereSelect = jest.fn().mockResolvedValue([]);
    const innerJoin = jest.fn().mockReturnValue({ where: whereSelect });
    const from = jest.fn().mockReturnValue({ innerJoin });
    const select = jest.fn().mockReturnValue({ from });
    const update = jest.fn();

    const db = { select, update };

    const count = await membersQueries.unlinkNonSchoolMemberLogins(db as never);

    expect(count).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});
