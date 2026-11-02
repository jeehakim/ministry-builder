export interface EmailMessage {
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends one transactional email. Rejects when the provider does not accept the message. */
export interface EmailSender {
  send(msg: EmailMessage): Promise<{ id?: string }>;
}
