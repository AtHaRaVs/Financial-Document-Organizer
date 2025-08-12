import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { AuthService } from '../auth/auth.service';

interface DocumentData {
  emailDate: string | Date;
  senderEmail: string;
  subject: string;
  fileName: string;
  driveFileId: string;
  fileSize?: string;
}

@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);

  constructor(private authService: AuthService) {}

  async ensureSpreadsheetExists(
    spreadsheetName: string = 'Financial Documents Log',
  ): Promise<string> {
    try {
      const auth = await this.authService.getAuthenticated();
      const drive = google.drive({ version: 'v3', auth });

      const searchResponse = await drive.files.list({
        q: `name='${spreadsheetName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        spaces: 'drive',
        fields: 'files(id, name)',
      });

      if (searchResponse.data.files && searchResponse.data.files.length > 0) {
        const spreadsheetId = searchResponse.data.files[0].id;
        this.logger.log(
          `Found existing spreadsheet: ${spreadsheetName} (${spreadsheetId})`,
        );
        if (!spreadsheetId) {
          throw new Error(
            `Google  did not return a spreadsheet ID for ${spreadsheetName}`,
          );
        }
        return spreadsheetId;
      }

      const sheets = google.sheets({ version: 'v4', auth });
      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: spreadsheetName,
          },
          sheets: [
            {
              properties: {
                title: 'Financial Documents',
                gridProperties: {
                  rowCount: 1000,
                  columnCount: 10,
                },
              },
            },
          ],
        },
      });

      const spreadsheetId = createResponse.data.spreadsheetId;
      this.logger.log(
        `Created new spreadsheet: ${spreadsheetName} (${spreadsheetId})`,
      );

      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is missing in the create response.');
      }

      await this.setupHeaders(spreadsheetId);

      return spreadsheetId;
    } catch (error) {
      this.logger.error('Failed to ensure spreadsheet exists:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to manage spreadsheet: ${error.message}`);
      }

      throw new Error(`Failed to manage spreadsheet: ${String(error)}`);
    }
  }

  async logDocument(
    spreadSheetId: string,
    documentData: DocumentData,
  ): Promise<number> {
    try {
      const auth = await this.authService.getAuthenticated();
      const sheets = google.sheets({ version: 'v4', auth });

      const row = [
        new Date().toISOString().split('T')[0],
        new Date(documentData.emailDate).toISOString().split('T')[0],
        documentData.senderEmail,
        this.extractSenderName(documentData.senderEmail),
        documentData.subject,
        this.extractInvoiceNumber(documentData.subject),
        documentData.fileName,
        documentData.driveFileId,
        `https://drive.google.com/file/d/${documentData.driveFileId}/view`,
        documentData.fileSize || 'Unknown',
      ];

      const appendResponse = await sheets.spreadsheets.values.append({
        spreadsheetId: spreadSheetId,
        range: 'Financial Documents!A:J',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [row],
        },
      });

      const updates = appendResponse.data.updates;

      if (!updates || !updates.updatedRange) {
        throw new Error('Append response missing update range info');
      }

      const range = updates.updatedRange;
      if (!range) {
        throw new Error('Could not get updated range from append response');
      }
      const rowNumber = parseInt(range.split('!A')[1].split(':')[0]);

      this.logger.log(
        `Logged document to spreadsheet at row ${rowNumber}: ${documentData.fileName}`,
      );
      return rowNumber;
    } catch (error) {
      this.logger.error('Failed to log document:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to log document: ${error.message}`);
      }

      throw new Error(`Failed to log document: ${String(error)}`);
    }
  }

  private async setupHeaders(spreadsheetId: string): Promise<void> {
    try {
      const auth = await this.authService.getAuthenticated();
      const sheets = google.sheets({ version: 'v4', auth });

      const headers = [
        'Date Processed',
        'Email Date',
        'Sender Email',
        'Sender Name',
        'Subject',
        'Invoice Number',
        'File Name',
        'Drive File ID',
        'Drive File Link',
        'File Size',
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Financial Documents!A1:J1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers],
        },
      });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 10,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    textFormat: { bold: true },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            },
          ],
        },
      });

      this.logger.log('Set up spreadsheet headers');
    } catch (error) {
      this.logger.error('Failed to setup headers:', error);
    }
  }

  private extractSenderName(email: string): string {
    return email
      .split('@')[0]
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim();
  }

  private extractInvoiceNumber(subject: string): string {
    const patterns = [
      /invoice[\s#]*(\d+)/i,
      /inv[\s#]*(\d+)/i,
      /bill[\s#]*(\d+)/i,
      /receipt[\s#]*(\d+)/i,
      /#(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = subject.match(pattern);
      if (match) return match[1];
    }

    return 'N/A';
  }
}
