import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  private client: PrismaClient | null = null;

  async onModuleInit(): Promise<void> {
    if (process.env.DISABLE_DB === 'true') {
      this.logger.warn('Prisma disabled in dev mode');
      console.log('Running WITHOUT database');
      return;
    }

    this.client = new PrismaClient();
    await this.client.$connect();
  }

  get db(): PrismaClient {
    if (!this.client) {
      throw new Error('Database is disabled (DISABLE_DB=true). Prisma client is not initialized.');
    }

    return this.client;
  }
}
