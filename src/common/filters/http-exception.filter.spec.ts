import {
  BadRequestException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('Child approval token redaction', () => {
  afterEach(() => jest.restoreAllMocks());
  it('remove o segredo do caminho, mensagem e logs, inclusive erro 404', () => {
    const token = 'a'.repeat(64);
    const path = `/api/child-approvals/${token}/invalid`;
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnThis(), json };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: 'POST', url: path }),
      }),
    } as unknown as ArgumentsHost;
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    new HttpExceptionFilter().catch(
      new BadRequestException(`Cannot POST ${path}`),
      host,
    );
    expect(JSON.stringify(json.mock.calls)).not.toContain(token);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    expect(JSON.stringify(json.mock.calls)).toContain('[redacted]');
  });
});
