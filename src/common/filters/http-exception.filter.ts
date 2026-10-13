import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Erro interno do servidor.';

    const rawMessage = this.extractMessage(exceptionResponse);
    const token = /\/child-approvals\/([a-f0-9]{64})(?:[/?]|$)/.exec(
      request.url,
    )?.[1];
    const scrub = (value: string) =>
      token ? value.replaceAll(token, '[redacted]') : value;
    const path = scrub(request.url);
    const message = Array.isArray(rawMessage)
      ? rawMessage.map(scrub)
      : scrub(rawMessage);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${path} → ${status}`,
        scrub(
          exception instanceof Error
            ? (exception.stack ?? exception.message)
            : String(exception),
        ),
      );
    } else if (status >= 400) {
      const messageText = Array.isArray(message) ? message.join(', ') : message;
      this.logger.warn(
        `${request.method} ${path} → ${status}: ${messageText}`,
        'HttpExceptionFilter',
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      path,
      timestamp: new Date().toISOString(),
    });
  }

  private extractMessage(response: string | object): string | string[] {
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const msg = response.message;
      if (typeof msg === 'string' || Array.isArray(msg)) return msg;
    }
    return 'Erro na requisição.';
  }
}
