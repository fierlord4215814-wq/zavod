import { NestFactory } from '@nestjs/core';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AppModule } from './app.module';
import { WsService } from './ws/ws.service';
import { PrismaClient } from '@prisma/client';
import { checkRuntimeReadiness } from './common/runtime-readiness';
import { ReadinessService } from './modules/health/readiness.service';

function safeLogError(exception: unknown) {
  const message = exception instanceof Error ? exception.message : String(exception);
  return String(message)
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, '[DATABASE_URL]')
    .replace(/(passwordHash|accessToken|refreshToken|authToken|token|secret)\s*[:=]\s*[^\s"',}]+/gi, '$1=[redacted]');
}

function configuredCorsOrigin() {
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!allowedOrigins.length) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Для production-запуска задайте точный CORS_ALLOWED_ORIGINS.');
    }
    return true;
  }

  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    callback(null, !origin || allowedOrigins.includes(origin));
  };
}

function assertRuntimeAuthConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;
  const configuredSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!configuredSecret || configuredSecret.length < 32) {
    throw new Error('Для production-запуска задайте JWT_SECRET длиной не менее 32 символов.');
  }
}

async function bootstrap() {
  assertRuntimeAuthConfiguration();
  if (process.env.NODE_ENV === 'production') {
    const preflight = new PrismaClient();
    try {
      const state = await checkRuntimeReadiness(preflight);
      if (!state.ready) throw new Error(`RUNTIME_NOT_READY:${state.code}`);
    } finally {
      await preflight.$disconnect();
    }
  }
  const app = await NestFactory.create(AppModule);
  if (process.env.NODE_ENV === 'production') {
    const readiness = app.get(ReadinessService);
    app.use(async (request: { path: string }, response: { status: (status: number) => { json: (value: unknown) => void } }, next: () => void) => {
      if (request.path === '/health' || request.path === '/ready' || request.path === '/version') return next();
      const state = await readiness.check();
      if (!state.ready) return response.status(503).json({ code: 'SERVICE_NOT_READY', message: 'Сервис временно недоступен.' });
      next();
    });
  }
  app.enableCors({
    origin: configuredCorsOrigin(),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-id', 'x-factory-id', 'x-selected-factory-id'],
    exposedHeaders: ['Content-Disposition', 'X-Archive-Primary-Count'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalFilters({
    catch(exception: unknown, host: ArgumentsHost) {
      const response = host.switchToHttp().getResponse();

      if (exception instanceof HttpException) {
        const status = exception.getStatus();
        const payload = exception.getResponse() as any;

        if (payload?.code && payload?.message) {
          response.status(status).json(payload);
          return;
        }

        response.status(status).json({
          code: status === HttpStatus.CONFLICT ? 'CONFLICT' : 'ERROR',
          message: payload?.message || exception.message,
        });

        return;
      }

      console.error('[UNHANDLED_EXCEPTION]', safeLogError(exception));
      response.status(500).json({
        code: 'ERROR',
        message: 'Внутренняя ошибка сервера',
      });
    },
  } as any);

  app.get(WsService).attach(app.getHttpServer());
  await app.listen(process.env.PORT || 3000, process.env.HOST || '0.0.0.0');
}

bootstrap().catch((error) => {
  console.error('[STARTUP_FAILED]', safeLogError(error));
  process.exitCode = 1;
});
