export interface EmailSendParams {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  readonly provider: 'smtp' | 'ses';
  isConfigured(): boolean;
  send(params: EmailSendParams): Promise<void>;
}

export type EmailProvider = 'smtp' | 'ses';
