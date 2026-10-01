import { HttpException, HttpStatus } from '@nestjs/common';

export class ConflictError extends HttpException {
  constructor(message: string) {
    super({
      code: 'CONFLICT',
      message: message === 'optimistic lock conflict' ? 'Данные уже изменены' : message,
    }, HttpStatus.CONFLICT);
  }
}
