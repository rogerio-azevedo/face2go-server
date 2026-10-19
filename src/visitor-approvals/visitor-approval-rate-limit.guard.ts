import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';

/** Per-instance IP ceiling complements persistent per-recipient email and CPF limits. */
@Injectable()
export class VisitorApprovalRateLimitGuard implements CanActivate {
  private readonly windows = new Map<
    string,
    { count: number; until: number }
  >();
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      ip?: string;
      method: string;
      url: string;
      body?: { isVisitor?: boolean };
    }>();
    const registration = request.url.includes('/register/');
    if (registration && request.body?.isVisitor !== true) return true;
    const now = Date.now();
    if (this.windows.size > 10000)
      for (const [key, item] of this.windows)
        if (item.until <= now) this.windows.delete(key);
    const key = `${request.ip ?? 'unknown'}:${registration ? 'registration' : request.method === 'GET' ? 'read' : 'write'}`;
    if (!this.windows.has(key) && this.windows.size >= 10000)
      throw new HttpException(
        'Muitas tentativas. Tente novamente mais tarde.',
        429,
      );
    let window = this.windows.get(key);
    if (!window || window.until <= now) {
      window = { count: 0, until: now + 15 * 60_000 };
      this.windows.set(key, window);
    }
    const maximum = registration ? 12 : request.method === 'GET' ? 120 : 30;
    if (++window.count > maximum)
      throw new HttpException(
        'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.',
        429,
      );
    return true;
  }
}
