import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_tokens')
export class UserToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  userId: string;

  @Column('text')
  accessToken: string;

  @Column('text', { nullable: true })
  refreshToken: string;

  @Column()
  scope: string;

  @Column()
  tokenType: string;

  @Column('bigint', { nullable: true })
  expiryDate: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
