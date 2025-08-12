import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class DriveService {
  private readonly logger = new Logger(DriveService.name);

  constructor(private authService: AuthService) {}

  async ensureFolderExists(
    folderName: string = 'Financial Documents',
  ): Promise<string> {
    try {
      const auth = await this.authService.getAuthenticated();
      const drive = google.drive({ version: 'v3', auth });

      const searchResponse = await drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        spaces: 'drive',
        fields: 'files(id, name)',
      });

      if (searchResponse.data.files && searchResponse.data.files.length > 0) {
        const folderId = searchResponse.data.files[0].id;
        this.logger.log(`Found existing folder: ${folderName} (${folderId})`);
        if (!folderId) {
          throw new Error(
            `Google Drive did not return a folder ID for ${folderName}`,
          );
        }
        return folderId;
      }

      const createResponse = await drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      });

      const folderId = createResponse.data.id;
      this.logger.log(`Created new folder: ${folderName} (${folderId})`);
      if (!folderId) {
        throw new Error(
          `Google Drive did not return a folder ID for ${folderName}`,
        );
      }
      return folderId;
    } catch (error: unknown) {
      this.logger.error('Failed to ensure folder exists:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to manage Drive folder: ${error.message}`);
      }
      throw new Error(`Failed to manage Drive folder: ${String(error)}`);
    }
  }

  async uploadFile(
    fileBuffer: Buffer,
    filename: string,
    mimeType: string,
    folderId: string,
  ): Promise<string> {
    try {
      const auth = await this.authService.getAuthenticated();
      const drive = google.drive({ version: 'v3', auth });

      const fileMetadata = {
        name: filename,
        parents: [folderId],
      };

      const media = {
        mimeType,
        body: Readable.from(fileBuffer),
      };

      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id',
      });

      const fileId = response.data.id;
      this.logger.log(`Uploaded file: ${filename} (${fileId})`);
      if (!fileId) {
        throw new Error(
          `Google Drive did not return a file ID for ${filename}`,
        );
      }
      return fileId;
    } catch (error: unknown) {
      this.logger.error(`Failed to upload file ${filename}:`, error);
      if (error instanceof Error) {
        throw new Error(`Failed to upload file: ${error.message}`);
      }
      throw new Error(`Failed to upload file: ${String(error)}`);
    }
  }

  generateStructuredFilename(
    senderEmail: string,
    subject: string,
    date: string,
    originalFilename: string,
  ): string {
    try {
      const senderName = senderEmail
        .split('@')[0]
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 20);

      const invoiceNumber = this.extractInvoiceNumber(subject);

      const dateObj = new Date(date);
      const formattedDate = dateObj.toISOString().split('T')[0];

      const extension = originalFilename.split('.').pop() || 'pdf';

      const structuredName = `${senderName}_${invoiceNumber}_${formattedDate}.${extension}`;

      this.logger.log(
        `Generated filename: ${originalFilename} -> ${structuredName}`,
      );
      return structuredName;
    } catch (error) {
      this.logger.error('Failed to generate structured filename:', error);

      const timestamp = new Date().toISOString().split('T')[0];
      return `${timestamp}_${originalFilename}`;
    }
  }

  private extractInvoiceNumber(subject: string): string {
    const patterns = [
      /invoice[\s#]*(\d+)/i,
      /inv[\s#]*(\d+)/i,
      /bill[\s#]*(\d+)/i,
      /receipt[\s#]*(\d+)/i,
      /#(\d+)/,
      /(\d{4,})/,
    ];

    for (const pattern of patterns) {
      const match = subject.match(pattern);
      if (match) {
        return `INV${match[1]}`;
      }
    }

    return `INV${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }
}
