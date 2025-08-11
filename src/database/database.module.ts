import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserToken, ProcessedDocument, ScanLog } from '../entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DATABASE_HOST'),
        port: parseInt(configService.get('DATABASE_PORT') ?? '5432', 10),
        username: configService.get('DATABASE_USER'),
        password: configService.get('DATABASE_PASSWORD'),
        database: configService.get('DATABASE_NAME'),
        entities: [UserToken, ProcessedDocument, ScanLog],
        synchronize: configService.get('NODE_ENV') === 'development',
        logging: configService.get('NODE_ENV') === 'development',
        ssl:
          configService.get('DATABASE_SSL') === 'true'
            ? {
                rejectUnauthorized: false,
              }
            : false,
        extra: {
          max: parseInt(
            configService.get('DATABASE_MAX_CONNECTIONS') ?? '100',
            10,
          ),
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([UserToken, ProcessedDocument, ScanLog]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
