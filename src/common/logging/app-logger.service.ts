import { Injectable, type LoggerService } from '@nestjs/common';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

const LEVEL_COLORS: Record<string, string> = {
  LOG: GREEN,
  ERROR: RED,
  WARN: YELLOW,
  DEBUG: MAGENTA,
  VERBOSE: CYAN,
};

@Injectable()
export class AppLogger implements LoggerService {
  private format(level: string, message: string, context?: string): string {
    const color = LEVEL_COLORS[level] ?? RESET;
    const ctx = context ? `${YELLOW}[${context}]${RESET} ` : '';
    const prefix = `${DIM}[Face2GO]${RESET} ${color}${BOLD}${level}${RESET}`;
    return `${prefix} ${ctx}${message}`;
  }

  log(message: string, context?: string) {
    console.log(this.format('LOG', message, context));
  }

  error(message: string, trace?: string, context?: string) {
    console.error(this.format('ERROR', message, context));
    if (trace) {
      console.error(`${DIM}${trace}${RESET}`);
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
