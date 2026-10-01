import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserContext } from './user-context.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserContext => {
    const request = context.switchToHttp().getRequest();
    return request.user;
  },
);
