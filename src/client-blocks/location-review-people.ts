export type LinkedPersonRow = {
  kind: 'registration' | 'member';
  id: string;
  name: string | null;
  faceId: number | null;
  unitId: string;
  active: boolean;
};

export function registrationsWithoutMembers<T extends { id: string }>(
  registrations: T[],
  memberRegistrationIds: Array<string | null>,
): T[] {
  const converted = new Set(
    memberRegistrationIds.filter((id): id is string => id !== null),
  );
  return registrations.filter(
    (registration) => !converted.has(registration.id),
  );
}

export function buildLogicalLinkedPeople(
  registrations: Array<Omit<LinkedPersonRow, 'kind'>>,
  members: Array<
    Omit<LinkedPersonRow, 'kind'> & { registrationId: string | null }
  >,
): LinkedPersonRow[] {
  const standaloneRegistrations = registrationsWithoutMembers(
    registrations,
    members.map((member) => member.registrationId),
  );
  return [
    ...standaloneRegistrations.map((row) => ({
      ...row,
      kind: 'registration' as const,
    })),
    ...members.map((row) => ({
      id: row.id,
      name: row.name,
      faceId: row.faceId,
      unitId: row.unitId,
      active: row.active,
      kind: 'member' as const,
    })),
  ];
}
