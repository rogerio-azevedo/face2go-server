import type { ExecutionContext } from '@nestjs/common';
import { VisitorApprovalRateLimitGuard } from './visitor-approval-rate-limit.guard';
const context = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as ExecutionContext;
describe('Visitor approval request limits', () => {
  it('limits repeated confirmation attempts by IP without storing tokens or CPF', () => {
    const guard = new VisitorApprovalRateLimitGuard();
    const request = context({
      ip: '127.0.0.1',
      method: 'POST',
      url: '/visitor-approvals/token/accept',
    });
    for (let i = 0; i < 30; i++) expect(guard.canActivate(request)).toBe(true);
    expect(() => guard.canActivate(request)).toThrow('Muitas tentativas');
    expect(
      guard.canActivate(
        context({
          ip: '127.0.0.2',
          method: 'POST',
          url: '/visitor-approvals/other/accept',
        }),
      ),
    ).toBe(true);
  });
  it('limits visitor submissions independently while preserving legacy non-visitor flow', () => {
    const guard = new VisitorApprovalRateLimitGuard();
    const request = context({
      ip: '127.0.0.1',
      method: 'POST',
      url: '/register/code/submit',
      body: { isVisitor: true },
    });
    for (let i = 0; i < 12; i++) guard.canActivate(request);
    expect(() => guard.canActivate(request)).toThrow();
    expect(
      guard.canActivate(
        context({
          ip: '127.0.0.1',
          method: 'POST',
          url: '/register/code/submit',
          body: { isVisitor: false },
        }),
      ),
    ).toBe(true);
  });
});
