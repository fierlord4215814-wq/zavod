import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ReadinessService } from './readiness.service';

type JsonResponse = { status: (status: number) => { json: (payload: unknown) => void } };

@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'zavod-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready(@Res() response: JsonResponse) {
    const result = await this.readiness.check();
    response.status(result.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(result);
  }

  @Get('version')
  version() {
    return {
      name: 'zavod',
      stage: 'vps-prep-02',
      version: process.env.APP_VERSION || 'dev',
    };
  }
}
