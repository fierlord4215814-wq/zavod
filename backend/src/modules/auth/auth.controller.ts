import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';

class DevLoginDto {
  userId!: string;
}

class LoginDto {
  phone!: string;
  password!: string;
}

class RegisterDto {
  phone!: string;
  password!: string;
  passwordRepeat!: string;
  operationId?: string;
}

class SetPasswordDto {
  setupToken!: string;
  newPassword!: string;
  passwordRepeat!: string;
}

class ChangePasswordDto {
  oldPassword?: string;
  newPassword!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: RegisterDto, @Req() req: any) {
    return this.authService.register(body, this.requestKey(req));
  }

  @Post('login')
  async login(@Body() body: LoginDto, @Req() req: any) {
    return this.authService.login(body, this.requestKey(req));
  }

  @Post('set-password')
  async setPassword(@Body() body: SetPasswordDto) {
    return this.authService.setPassword(body);
  }

  @Post('change-password')
  async changePassword(@Body() body: ChangePasswordDto, @Req() req: any) {
    return this.authService.changePassword(req.user, body);
  }

  @Post('logout')
  async logout(@Req() req: any) {
    return this.authService.logout(req.user);
  }

  @Post('dev-login')
  async devLogin(@Body() body: DevLoginDto) {
    return this.authService.devLogin(body.userId);
  }

  @Get('me')
  async me(@Req() req: any) {
    return this.authService.me(req.user);
  }

  @Get('factories')
  async factories(@Req() req: any) {
    return this.authService.getAvailableFactories(req.user.userId);
  }

  @Get('assignment-request')
  async assignmentRequest(@Req() req: any) {
    return this.authService.assignmentRequestContext(req.user);
  }

  @Post('assignment-request')
  async createAssignmentRequest(@Req() req: any, @Body() body: any) {
    return this.authService.createAssignmentRequest(req.user, body);
  }

  private requestKey(req: any) {
    const forwarded = String(req.headers?.['cf-connecting-ip'] ?? req.headers?.['x-forwarded-for'] ?? '')
      .split(',')[0]
      .trim();
    return forwarded || String(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
  }
}
