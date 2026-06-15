import { Injectable, type LoggerService } from '@nestjs/common';

@Injectable()
export class AppLogger implements LoggerService {
  private format(level: string, message: string, context?: string): string {
    const ctx = context ? `[${context}] ` : '';
    return `[Face2GO] ${level} ${ctx}${message}`;
  }

  log(message: string, context?: string) {
    console.log(this.format('LOG', message, context));
  }

  error(message: string, trace?: string, context?: string) {
    console.error(this.format('ERROR', message, context));
    if (trace) {
      console.error(trace);
    }
  }

  warn(message: string, context?: string) {
    console.warn(this.format('WARN', message, context));
  }

  debug(message: string, context?: string) {
    console.debug(this.format('DEBUG', message, context));
  }

  verbose(message: string, context?: string) {
    console.log(this.format('VERBOSE', message, context));
  }
}
