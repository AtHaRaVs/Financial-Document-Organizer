import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('processed_documents')
export class ProcessedDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  emailId: string;

  @Column()
  messageId: string;

  @Column()
  senderEmail: string;

  @Column()
  senderName: string;

  @Column('text')
  subject: string;

  @Column({ nullable: true })
  invoiceNumber: string;

  @Column()
  emailDate: Date;

  @Column()
  fileName: string;

  @Column()
  originalFileName: string;

  @Column()
  driveFileId: string;

  @Column()
  driveFileUrl: string;

  @Column()
  spreadsheetId: string;

  @Column({ nullable: true })
  spreadsheetRow: number;

  @Column()
  fileSize: string;

  @Column()
  mimeType: string;

  @Column({ default: 'completed' })
  status: string;

  @CreateDateColumn()
  processedAt: Date;
}
