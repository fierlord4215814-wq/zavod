import { Injectable } from '@nestjs/common';
import { checkRuntimeReadiness, type RuntimeReadiness } from '../../common/runtime-readiness';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReadinessService {
  private last: { result: RuntimeReadiness; until: number } | null = null;
  private inFlight: Promise<RuntimeReadiness> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<RuntimeReadiness> {
    if (this.last && this.last.until > Date.now()) return this.last.result;
    if (this.inFlight) return this.inFlight;
    let db;
    try { db = this.prisma.db; } catch { return { ready: false, code: 'DB_UNAVAILABLE' }; }
    this.inFlight = checkRuntimeReadiness(db)
      .then((result) => {
        this.last = { result, until: Date.now() + (result.ready ? 3000 : 1000) };
        return result;
      })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
}
