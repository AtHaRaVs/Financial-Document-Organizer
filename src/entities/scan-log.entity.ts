import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('scan_logs')
export class ScanLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  status: string;

  @Column({ default: 0 })
  emailsProcessed: number;

  @Column({ default: 0 })
  documentsProcessed: number;

  @Column({ default: 0 })
  errorsCount: number;

  @Column('text', { nullable: true })
  errorDetails: string;

  @Column({ nullable: true })
  completedAt: Date;

  @CreateDateColumn()
  startedAt: Date;
}
