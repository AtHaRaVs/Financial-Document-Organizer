import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { google } from 'googleapis';
import { UserToken } from 'src/entities';
import { OAuth2Client } from 'google-auth-library';
import { Credentials } from 'google-auth-library';
import { DeepPartial } from 'typeorm';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private oauth2Client: OAuth2Client;
  private readonly defaultUserId = 'default_user';

  constructor(
    private configService: ConfigService,
    @InjectRepository(UserToken)
    private userTokenRepository: Repository<UserToken>,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      this.configService.get('GOOGLE_CLIENT_ID'),
      this.configService.get('GOOGLE_CLIENT_SECRET'),
      this.configService.get('GOOGLE_REDIRECT_URI'),
    );
  }

  getAuthUrl(): string {
    const scopesValue = this.configService.get<string>('GOOGLE_SCOPES');

    if (!scopesValue) {
      throw new Error('GOOGLE_SCOPES is missing in configuration');
    }

    const scopes = scopesValue.split(',');

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });
  }

  async handleCallback(code: string): Promise<Credentials> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      await this.saveTokens(tokens);

      this.oauth2Client.setCredentials(tokens);

      this.logger.log('Tokens obtained and saved successfully to database');
      return tokens;
    } catch (error) {
      this.logger.error('Failed to exchange code for tokens:', error);
      throw new Error('Failed to authenticate with Google');
    }
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const userToken: UserToken | null = await this.loadTokens();
      if (!userToken) return false;

      const tokens: Credentials = {
        access_token: userToken.accessToken,
        refresh_token: userToken.refreshToken,
        scope: userToken.scope,
        token_type: userToken.tokenType,
        expiry_date: userToken.expiryDate,
      };

      this.oauth2Client.setCredentials(tokens);

      if (userToken.expiryDate && userToken.expiryDate <= Date.now()) {
        if (userToken.refreshToken) {
          await this.refreshTokens();
          return true;
        }
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Authentication check failed:', error);
      return false;
    }
  }

  async getAuthenticated(): Promise<OAuth2Client> {
    const userToken = await this.loadTokens();
    if (!userToken) {
      throw new Error('No authentication tokens found');
    }

    const tokens = {
      access_token: userToken.accessToken,
      refresh_token: userToken.refreshToken,
      scope: userToken.scope,
      token_type: userToken.tokenType,
      expiry_date: userToken.expiryDate,
    };

    this.oauth2Client.setCredentials(tokens);

    if (
      userToken.expiryDate &&
      userToken.expiryDate <= Date.now() &&
      userToken.refreshToken
    ) {
      await this.refreshTokens();
    }

    return this.oauth2Client;
  }

  private async refreshTokens(): Promise<void> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      await this.saveTokens(credentials);
      this.oauth2Client.setCredentials(credentials);
      this.logger.log('Tokens refreshed successfully');
    } catch (error) {
      this.logger.error('Failed to refresh tokens:', error);
      throw new Error('Failed to refresh authentication tokens');
    }
  }

  private async saveTokens(tokens: Credentials): Promise<void> {
    try {
      let userToken: UserToken | null = await this.userTokenRepository.findOne({
        where: { userId: this.defaultUserId },
      });

      if (userToken) {
        userToken.accessToken = tokens.access_token ?? '';
        userToken.refreshToken = tokens.refresh_token || userToken.refreshToken;
        userToken.scope = tokens.scope ?? '';
        userToken.tokenType = tokens.token_type ?? '';
        userToken.expiryDate = tokens.expiry_date ?? null;
      } else {
        userToken = this.userTokenRepository.create({
          userId: this.defaultUserId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          scope: tokens.scope,
          tokenType: tokens.token_type,
          expiryDate: tokens.expiry_date,
        } as DeepPartial<UserToken>);
      }

      await this.userTokenRepository.save(userToken);
      this.logger.log('Tokens saved to database successfully');
    } catch (error) {
      this.logger.error('Failed to save tokens to database:', error);
      throw new Error('Failed to save authentication tokens');
    }
  }

  private async loadTokens(): Promise<UserToken | null> {
    try {
      const userToken = await this.userTokenRepository.findOne({
        where: { userId: this.defaultUserId },
      });

      if (!userToken) {
        this.logger.log('No tokens found in database');
        return null;
      }

      return userToken;
    } catch (error) {
      this.logger.error('Failed to load tokens from database:', error);
      return null;
    }
  }

  async clearTokens(): Promise<void> {
    try {
      await this.userTokenRepository.delete({ userId: this.defaultUserId });
      this.logger.log('Tokens cleared from database successfully');
    } catch (error) {
      this.logger.error('Failed to clear tokens from database:', error);
      throw new Error('Failed to clear authentication tokens');
    }
  }

  async getTokenInfo(): Promise<any> {
    const userToken = await this.loadTokens();
    if (!userToken) return null;

    return {
      userId: userToken.userId,
      scope: userToken.scope,
      tokenType: userToken.tokenType,
      expiryDate: userToken.expiryDate,
      hasRefreshToken: !!userToken.refreshToken,
      createdAt: userToken.createdAt,
      updatedAt: userToken.updatedAt,
    };
  }
}
