import { parseAccessUserListText } from './intelbras-device.client';

describe('parseAccessUserListText', () => {
  it('extrai UserID, nome e TimeSections', () => {
    const text = [
      'Users[0].UserID=1',
      'Users[0].UserName=ROGERIO AZEVEDO',
      'Users[0].TimeSections[0]=1',
      'Users[0].TimeSections[1]=2',
      'Users[0].ValidFrom=2000-01-01 00:00:00',
      'Users[0].ValidTo=2100-12-31 23:59:59',
    ].join('\n');

    expect(parseAccessUserListText(text)).toEqual({
      UserID: '1',
      UserName: 'ROGERIO AZEVEDO',
      UserType: undefined,
      Authority: undefined,
      UserStatus: undefined,
      RoleID: undefined,
      timeSectionIndices: [1, 2],
      doors: [],
      specialDaysSchedule: [],
      ValidFrom: '2000-01-01 00:00:00',
      ValidTo: '2100-12-31 23:59:59',
    });
  });

  it('extrai UserType Bloqueados e campos vizinhos do dump real', () => {
    const text = [
      'Users[0].Authority=2',
      'Users[0].Doors[0]=0',
      'Users[0].RoleID=0',
      'Users[0].SpecialDaysSchedule[0]=255',
      'Users[0].TimeSections[0]=1',
      'Users[0].UserID=1',
      'Users[0].UserName=ROGERIO AZEVEDO',
      'Users[0].UserStatus=0',
      'Users[0].UserType=1',
      'Users[0].ValidFrom=1970-01-01 00:00:00',
      'Users[0].ValidTo=2100-12-31 23:59:59',
    ].join('\n');

    expect(parseAccessUserListText(text)).toEqual({
      UserID: '1',
      UserName: 'ROGERIO AZEVEDO',
      UserType: 1,
      Authority: 2,
      UserStatus: 0,
      RoleID: 0,
      timeSectionIndices: [1],
      doors: [0],
      specialDaysSchedule: [255],
      ValidFrom: '1970-01-01 00:00:00',
      ValidTo: '2100-12-31 23:59:59',
    });
  });

  it('devolve null sem UserID', () => {
    expect(parseAccessUserListText('Users[0].UserName=X')).toBeNull();
  });
});
