export interface EmailAttachment {
  filename: string;
  path: string;
  cid: string;
}

export interface EmailSendParams {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface EmailSender {
  readonly provider: 'smtp' | 'ses';
  isConfigured(): boolean;
  send(params: EmailSendParams): Promise<void>;
}

export type EmailProvider = 'smtp' | 'ses';
