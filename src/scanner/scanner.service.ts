import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GmailService } from '../gmail/gmail.service';
import { DriveService } from '../drive/drive.service';
import { SheetsService } from '../sheets/sheets.service';
import { ProcessingResult } from '../common/interfaces/processing-result.interface';
import { ProcessedDocument, ScanLog } from 'src/entities';

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);

  constructor(
    private gmailService: GmailService,
    private driveService: DriveService,
    private sheetService: SheetsService,
    @InjectRepository(ProcessedDocument)
    private processedDocumentRepository: Repository<ProcessedDocument>,
    @InjectRepository(ScanLog)
    private scanLogRepository: Repository<ScanLog>,
  ) {}

  async scanAndProcess(): Promise<ProcessingResult> {
    const scanLog = this.scanLogRepository.create({
      status: 'started',
      emailsProcessed: 0,
      documentsProcessed: 0,
      errorsCount: 0,
    });

    await this.scanLogRepository.save(scanLog);

    const result: ProcessingResult = {
      processed: 0,
      errors: [],
      details: [],
    };

    try {
      this.logger.log('Starting financial document scan...');

      const [folderId, spreadsheetId] = await Promise.all([
        this.driveService.ensureFolderExists('Financial Document'),
        this.sheetService.ensureSpreadsheetExists('Financial Documents Log'),
      ]);

      this.logger.log(
        `Using Drive folder: ${folderId}, Spreadsheet: ${spreadsheetId}`,
      );

      const processedEmailIds = await this.getProcessedEmailIds();
      const messages = await this.gmailService.searchEmails();
      const unprocessedMessages = messages.filter(
        (msg) => !processedEmailIds.includes(msg.id),
      );

      this.logger.log(
        `Found ${messages.length} total emails, ${unprocessedMessages.length} unprocessed`,
      );

      if (unprocessedMessages.length === 0) {
        scanLog.status = 'completed';
        scanLog.completedAt = new Date();
        await this.scanLogRepository.save(scanLog);

        this.logger.log('No new financial emails found');
        return result;
      }

      for (const message of unprocessedMessages) {
        try {
          const processedDocs = await this.processEmail(
            message.id,
            folderId,
            spreadsheetId,
          );

          result.processed++;
          result.details.push(...processedDocs);

          this.logger.log(`Successfully processed email ${message.id}`);
        } catch (error) {
          const errorMsg = `Email ${message.id}: ${error.message}`;
          this.logger.error(errorMsg);
          result.errors.push(errorMsg);
        }
      }

      scanLog.status = 'completed';
      scanLog.emailsProcessed = result.processed;
      scanLog.documentsProcessed = result.details.length;
      scanLog.errorsCount = result.errors.length;
      scanLog.errorDetails =
        result.errors.length > 0 ? JSON.stringify(result.errors) : null;
      scanLog.completedAt = new Date();
      await this.scanLogRepository.save(scanLog);

      this.logger.log(
        `Scan complete: ${result.processed} emails processed, ${result.errors.length} errors`,
      );
      return result;
    } catch (error) {
      scanLog.status = 'failed';
      scanLog.errorDetails = error.message;
      scanLog.completedAt = new Date();
      await this.scanLogRepository.save(scanLog);

      this.logger.error('Scan process failed:', error);
      throw new Error(`Scan process failed: ${error.message}`);
    }
  }

  private async processEmail(
    messageId: string,
    folderId: string,
    spreadsheetId: string,
  ): Promise<any[]> {
    const processedDocs = [];

    const emailDetails = await this.gmailService.getEmailDetails(messageId);

    if (!emailDetails) {
      throw new Error('No attachments found');
    }

    this.logger.log(
      `Processing ${emailDetails.attachments.length} attachments from: ${emailDetails.from}`,
    );

    for (const attachment of emailDetails.attachments) {
      try {
        if (!this.isDocumentFile(attachment.filename)) {
          this.logger.log(`Skipping non-document file: ${attachment.filename}`);
          continue;
        }

        const fileBuffer = await this.gmailService.downloadAttachment(
          messageId,
          attachment.attachmentId,
        );

        const structuredFileName = this.driveService.generateStructuredFilename(
          emailDetails.from,
          emailDetails.subject,
          emailDetails.date,
          emailDetails.filename,
        );

        const driveFileId = await this.driveService.uploadFile(
          fileBuffer,
          structuredFileName,
          attachment.mimeType,
          folderId,
        );

        const rowNumber = await this.sheetService.logDocument(spreadsheetId, {
          emailDate: emailDetails.date,
          senderEmail: emailDetails.from,
          subject: emailDetails.subject,
          fileName: structuredFileName,
          driveFileId,
          fileSize: this.formatFileSize(attachment.size),
        });

        const processedDocument = this.processedDocumentRepository.create({
          emailId: messageId,
          messageId: messageId,
          senderEmail: emailDetails.from,
          senderName: this.extractSenderName(emailDetails.from),
          subject: emailDetails.subject,
          invoiceNumber: this.extractInvoiceNumber(emailDetails.subject),
          emailDate: new Date(emailDetails.date),
          fileName: structuredFileName,
          originalFileName: attachment.filename,
          driveFileId: driveFileId,
          driveFileUrl: `https://drive.google.com/file/d/${driveFileId}/view`,
          spreadsheetId: spreadsheetId,
          spreadsheetRow: rowNumber,
          fileSize: this.formatFileSize(attachment.size),
          mimeType: attachment.mimeType,
          status: 'completed',
        });

        await this.processedDocumentRepository.save(processedDocument);

        processedDocs.push({
          emailId: messageId,
          fileName: structuredFilename,
          driveFileId,
          spreadsheetRow: rowNumber,
        });
        this.logger.log(
          `Processed attachment: ${attachment.filename} -> ${structuredFilename}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to process attachment ${attachment.filename}:`,
          error,
        );
        throw new Error(
          `Failed to process attachment ${attachment.filename}: ${error.message}`,
        );
      }
    }

    if (processedDocs.length > 0) {
      await this.gmailService.labelEmail(messageId);
    }
    return processedDocs;
  }

  private async getProcessedEmailIds(): Promise<string[]> {
    const processedDocs = await this.processedDocumentRepository.find({
      select: ['emailId'],
    });
    return processedDocs.map((doc) => doc.emailId);
  }

  private isDocumentFile(filename: string): boolean {
    const documentExtensions = [
      '.pdf',
      '.doc',
      '.docx',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.tiff',
    ];

    const extension = filename
      .toLowerCase()
      .substring(filename.lastIndexOf('.'));
    return documentExtensions.includes(extension);
  }

  private formatFileSize(sizeInBytes: number): string {
    if (sizeInBytes === 0) return 'Unknown';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = sizeInBytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex <= units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${Math.round(size * 100) / 100} ${units[unitIndex]}`;
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

    return null;
  }

  async getProcessingStats(): Promise<any> {
    const totalProcessed = await this.processedDocumentRepository.count();
    const recentScans = await this.scanLogRepository.find({
      order: { startedAt: 'Desc' },
      take: 10,
    });

    const uniqueSenders = await this.processedDocumentRepository
      .createQueryBuilder('doc')
      .select('DISTINCT doc.senderEmail')
      .getRawMany();

    return {
      totalDocuments: totalProcessed,
      uniqueSenders: uniqueSenders.length,
      recentScans: recentScans.map((scan) => ({
        id: scan.id,
        status: scan.status,
        emailsProcessed: scan.emailsProcessed,
        documentsProcessed: scan.documentsProcessed,
        errorsCount: scan.errorsCount,
        startedAt: scan.startedAt,
        completedAt: scan.completedAt,
      })),
    };
  }

  async getRecentDocuments(limit: number = 20): Promise<ProcessedDocument[]> {
    return this.processedDocumentRepository.find({
      order: { processedAt: 'DESC' },
      take: limit,
    });
  }
}
