import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { AuthService } from '../auth/auth.service';
import {
  EmailDetails,
  EmailAttachment,
} from '../common/interfaces/google-auth.interface';

interface GmailMessagePartBody {
  attachmentId?: string | null;
  size?: number | null;
}

interface GmailMessagePart {
  filename?: string | null;
  body?: GmailMessagePartBody;
  mimeType?: string | null;
  parts?: GmailMessagePart[];
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(private authService: AuthService) {}

  async searchEmails(
    query: string = 'has:attachment (invoice OR receipt OR bill)',
  ): Promise<any[]> {
    try {
      const auth = await this.authService.getAuthenticated();
      const gmail = google.gmail({ version: 'v1', auth });

      const response = await gmail.users.messages.list({
        userId: 'me',
        q: `${query} -label:processed-financial-docs`,
        maxResults: 50,
      });

      this.logger.log(
        `Found ${response.data.messages?.length || 0} emails matching criteria`,
      );
      return response.data.messages || [];
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Gmail search failed:', error);
        throw new Error(`Gmail search failed: ${error.message}`);
      }
      this.logger.error('Gmail search failed with unknown error:', error);
      throw new Error('Gmail search failed due to unknown reason');
    }
  }

  async getEmailDetails(messageId: string): Promise<EmailDetails> {
    try {
      const auth = await this.authService.getAuthenticated();
      const gmail = google.gmail({ version: 'v1', auth });

      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const message = response.data;
      if (!message.payload) {
        throw new Error('No payload found for this email');
      }

      const headers = (message.payload.headers ?? [])
        .filter(
          (h): h is { name: string; value: string } => !!h.name && !!h.value,
        )
        .map((h) => ({
          name: h.name,
          value: h.value,
        }));

      const emailDetails: EmailDetails = {
        id: messageId,
        subject: this.getHeaderValue(headers, 'Subject'),
        from: this.getHeaderValue(headers, 'From'),
        date: this.getHeaderValue(headers, 'Date'),
        attachments: this.extractAttachments(message.payload),
      };

      this.logger.log(`Retrieved details for email: ${emailDetails.subject}`);
      return emailDetails;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `Failed to get email details for ${messageId}:`,
          error,
        );
        throw new Error(`Failed to get email details: ${error.message}`);
      }
      this.logger.error(`Failed to get email details for ${messageId}:`, error);
      throw new Error('Failed to get email details: Unknown error');
    }
  }

  async downloadAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    try {
      const auth = await this.authService.getAuthenticated();
      const gmail = google.gmail({ version: 'v1', auth });

      const response = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      });

      const data = response.data.data;
      if (!data) {
        throw new Error('No attachment data received');
      }

      const buffer = Buffer.from(
        data.replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      );
      this.logger.log(
        `Downloaded attachment ${attachmentId} (${buffer.length} bytes)`,
      );

      return buffer;
    } catch (error) {
      this.logger.error(
        `Failed to download attachment ${attachmentId}:`,
        error,
      );

      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      }

      throw new Error(`Failed to download attachment: ${errorMessage}`);
    }
  }

  async labelEmail(messageId: string): Promise<void> {
    try {
      const auth = await this.authService.getAuthenticated();
      const gmail = google.gmail({ version: 'v1', auth });

      await this.ensureLabelExists('processed-financial-docs');

      const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
      const processedLabel = (labelsResponse.data.labels ?? []).find(
        (label) => label.name === 'processed-financial-docs',
      );

      if (!processedLabel?.id) {
        throw new Error('Failed to create or find processed label');
      }

      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: [processedLabel.id],
        },
      });

      this.logger.log(`Applied processed label to email ${messageId}`);
    } catch (error) {
      this.logger.error(`Failed to label email ${messageId}:`, error);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      throw new Error(`Failed to label email: ${errorMessage}`);
    }
  }

  async searchEmailsFromSenders(senders: string[]): Promise<any[]> {
    try {
      const senderQuery = senders
        .map((sender) => `from:${sender}`)
        .join(' OR ');
      const fullQuery = `has:attachment (${senderQuery}) (invoice OR receipt OR bill)`;

      return this.searchEmails(fullQuery);
    } catch (error) {
      this.logger.error(
        'Failed to search emails from specific senders:',
        error,
      );

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      throw new Error(`Failed to search emails from senders: ${errorMessage}`);
    }
  }

  async searchEmailsByDateRange(days: number = 30): Promise<any[]> {
    try {
      const date = new Date();
      date.setDate(date.getDate() - days);
      const formattedDate = date.toISOString().split('T')[0].replace(/-/g, '/');

      const dateQuery = `after:${formattedDate} has:attachment (invoice OR receipt OR bill)`;
      return this.searchEmails(dateQuery);
    } catch (error) {
      this.logger.error('Failed to search emails by date range:', error);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      throw new Error(`Failed to search emails by date: ${errorMessage}`);
    }
  }

  private getHeaderValue(
    headers: { name: string; value: string }[] | undefined,
    name: string,
  ): string {
    const header = headers?.find((h) => h.name === name);
    return header?.value ?? '';
  }

  private extractAttachments(payload: GmailMessagePart): EmailAttachment[] {
    const attachments: EmailAttachment[] = [];

    const extractFromPart = (part: GmailMessagePart) => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          attachmentId: part.body.attachmentId,
          mimeType: part.mimeType,
          size: part.body.size || 0,
        });
      }

      if (part.parts) {
        part.parts.forEach(extractFromPart);
      }
    };

    if (payload.parts) {
      payload.parts.forEach(extractFromPart);
    } else if (payload.filename && payload.body?.attachmentId) {
      attachments.push({
        filename: payload.filename,
        attachmentId: payload.body.attachmentId,
        mimeType: payload.mimeType,
        size: payload.body.size || 0,
      });
    }

    return attachments;
  }

  private async ensureLabelExists(labelName: string): Promise<void> {
    try {
      const auth = await this.authService.getAuthenticated();
      const gmail = google.gmail({ version: 'v1', auth });

      const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
      const existingLabel = labelsResponse.data.labels?.find(
        (label) => label.name === labelName,
      );

      if (!existingLabel) {
        await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name: labelName,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
            color: {
              backgroundColor: '#16a085',
              textColor: '#ffffff',
            },
          },
        });
        this.logger.log(`Created label: ${labelName}`);
      }
    } catch (error) {
      this.logger.error(`Error managing label ${labelName}:`, error);
    }
  }

  async getEmailCount(query?: string): Promise<number> {
    try {
      const auth = await this.authService.getAuthenticated();
      const gmail = google.gmail({ version: 'v1', auth });

      const searchQuery =
        query || 'has:attachment (invoice OR receipt OR bill)';
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: searchQuery,
        maxResults: 500,
      });

      return response.data.messages?.length || 0;
    } catch (error) {
      this.logger.error('Failed to get email count:', error);
      return 0;
    }
  }
}
