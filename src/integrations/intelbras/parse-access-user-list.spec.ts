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
      timeSectionIndices: [1, 2],
      ValidFrom: '2000-01-01 00:00:00',
      ValidTo: '2100-12-31 23:59:59',
    });
  });

  it('devolve null sem UserID', () => {
    expect(parseAccessUserListText('Users[0].UserName=X')).toBeNull();
  });
});
