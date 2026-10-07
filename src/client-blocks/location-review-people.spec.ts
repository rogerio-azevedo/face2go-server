import {
  buildLogicalLinkedPeople,
  registrationsWithoutMembers,
} from './location-review-people';

describe('location-review-people', () => {
  it('prefere o membro quando ele veio de um cadastro', () => {
    const people = buildLogicalLinkedPeople(
      [
        {
          id: 'registration-1',
          name: 'Ana',
          faceId: 5,
          unitId: 'unit-1',
          active: true,
        },
      ],
      [
        {
          id: 'member-1',
          registrationId: 'registration-1',
          name: 'Ana',
          faceId: 5,
          unitId: 'unit-1',
          active: true,
        },
      ],
    );

    expect(people).toEqual([
      {
        kind: 'member',
        id: 'member-1',
        name: 'Ana',
        faceId: 5,
        unitId: 'unit-1',
        active: true,
      },
    ]);
  });

  it('mantém cadastro sem membro e membro sem cadastro', () => {
    const people = buildLogicalLinkedPeople(
      [
        {
          id: 'registration-1',
          name: 'Bruno',
          faceId: null,
          unitId: 'unit-1',
          active: true,
        },
      ],
      [
        {
          id: 'member-1',
          registrationId: null,
          name: 'Carla',
          faceId: 8,
          unitId: 'unit-1',
          active: true,
        },
      ],
    );

    expect(people.map((person) => person.kind)).toEqual([
      'registration',
      'member',
    ]);
  });

  it('não deduplica apenas por nome ou faceId', () => {
    const people = buildLogicalLinkedPeople(
      [
        {
          id: 'registration-1',
          name: 'Mesmo Nome',
          faceId: 10,
          unitId: 'unit-1',
          active: true,
        },
      ],
      [
        {
          id: 'member-1',
          registrationId: null,
          name: 'Mesmo Nome',
          faceId: 10,
          unitId: 'unit-1',
          active: true,
        },
      ],
    );

    expect(people).toHaveLength(2);
  });

  it('filtra cadastro quando há membro ativo relacionado em outra localização', () => {
    const registrations = [{ id: 'registration-1' }, { id: 'registration-2' }];
    expect(
      registrationsWithoutMembers(registrations, ['registration-1', null]),
    ).toEqual([{ id: 'registration-2' }]);
  });
});
