export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date?: number;
}

export interface EmailDetails {
  id: string;
  subject: string;
  from: string;
  date: string;
  attachments: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  attachmentId: string;
  mimeType?: string | null;
  size: number;
}

export interface ProcessingResult {
  processed: number;
  errors: string[];
  details: ProcessedDocumentResult[];
}

export interface ProcessedDocumentResult {
  emailId: string;
  fileName: string;
  driveFileId: string;
  spreadsheetRow: number;
}
