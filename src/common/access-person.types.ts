export type AccessPersonType = 'student' | 'responsible' | 'member' | 'guest';

export type ResolvedAccessPerson = {
  personId: string;
  personType: AccessPersonType;
  personName: string;
};
