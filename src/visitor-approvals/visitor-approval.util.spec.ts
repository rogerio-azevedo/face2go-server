import { needsVisitorApproval } from './visitor-approval.util';
import { updateClientSchema } from '../validation/clients.schema';
import { publicSubmitRegistrationSchema } from '../validation/registrations.schema';
describe('Visitor authorization policy', () => {
  it.each([
    [false, false, false, false],
    [true, false, true, false],
    [true, true, false, false],
    [true, true, true, true],
  ])(
    'flag=%s visitor=%s enrolled=%s',
    (enabled, visitor, enrolled, expected) => {
      expect(
        needsVisitorApproval(
          { enableVisitorApprove: enabled, timezoneOffsetMinutes: -240 },
          { isVisitor: visitor, visitorApprovalRequired: enrolled },
        ),
      ).toBe(expected);
    },
  );
  it('partial client update does not turn the flag off implicitly', () => {
    expect(
      updateClientSchema.parse({ name: 'Teste' }).enableVisitorApprove,
    ).toBeUndefined();
    expect(
      updateClientSchema.parse({ enableVisitorApprove: false })
        .enableVisitorApprove,
    ).toBe(false);
  });
  it('classifies only a boolean, never a truthy string', () => {
    expect(
      publicSubmitRegistrationSchema.shape.isVisitor.safeParse('false').success,
    ).toBe(false);
    expect(
      publicSubmitRegistrationSchema.shape.isVisitor.parse(undefined),
    ).toBe(false);
  });
});
