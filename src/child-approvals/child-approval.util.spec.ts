import { ageForApproval, needsChildApproval } from './child-approval.util';
import { updateClientSchema } from '../validation/clients.schema';

describe('Child approval eligibility', () => {
  it('usa a data local do cliente na passagem para 18 anos', () => {
    expect(
      ageForApproval('2008-10-12', -240, new Date('2026-10-12T03:59:59Z')),
    ).toBe(17);
    expect(
      ageForApproval('2008-10-12', -240, new Date('2026-10-12T04:00:00Z')),
    ).toBe(18);
  });
  it('flag desligada e legado fora da regularização dispensam a exigência', () => {
    expect(
      needsChildApproval(
        { enableChildApprove: false, timezoneOffsetMinutes: 0 },
        { childApprovalRequired: true, birthDate: null },
      ),
    ).toBe(false);
    expect(
      needsChildApproval(
        { enableChildApprove: true, timezoneOffsetMinutes: 0 },
        { childApprovalRequired: false, birthDate: '2015-01-01' },
      ),
    ).toBe(false);
  });
  it('cadastro já inscrito com nascimento ausente não libera acesso', () => {
    expect(
      needsChildApproval(
        { enableChildApprove: true, timezoneOffsetMinutes: 0 },
        { childApprovalRequired: true, birthDate: null },
      ),
    ).toBe(true);
  });
  it('PATCH sem flag não desliga a autorização por efeito de default', () => {
    expect(
      updateClientSchema.parse({ name: 'Cliente atualizado' })
        .enableChildApprove,
    ).toBeUndefined();
    expect(
      updateClientSchema.parse({ enableChildApprove: false })
        .enableChildApprove,
    ).toBe(false);
  });
});
