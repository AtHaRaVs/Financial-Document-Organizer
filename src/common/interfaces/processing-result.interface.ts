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
