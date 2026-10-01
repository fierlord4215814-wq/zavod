import { Injectable, NestMiddleware } from '@nestjs/common';
import { UserContextService } from './user-context.service';
import { RequestWithUserContext } from './user-context.types';

type NextFunction = (error?: unknown) => void;

@Injectable()
export class UserContextMiddleware implements NestMiddleware {
  constructor(private readonly userContextService: UserContextService) {}

  async use(req: RequestWithUserContext, _res: unknown, next: NextFunction) {
    try {
      req.user = await this.userContextService.resolve(req.headers);
      next();
    } catch (error) {
      next(error);
    }
  }
}
