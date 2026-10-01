import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { verifyAuthToken } from '../common/auth-token';
import { resolveEffectivePermissions } from '../common/effective-permissions';
import {
  FACTORY_WS_EVENT_CAPABILITIES,
  WS_EVENTS,
  isFactoryWsEvent,
  type FactoryWsEventType,
  type WsEventType,
} from './events';

type WsClientContext = {
  userId: string;
  factoryId: string;
  role: UserRole;
  departmentId: string | null;
  isAdmin: boolean;
  permissions: Set<string>;
};

type WsPayload = Record<string, unknown> | null;

@Injectable()
export class WsService implements OnModuleDestroy {
  private readonly logger = new Logger(WsService.name);
  private readonly allowTestAuthHeaders = process.env.NODE_ENV !== 'production'
    && process.env.ALLOW_TEST_AUTH_HEADERS === 'true';
  private server: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, WsClientContext>();

  constructor(private readonly prisma: PrismaService) {}

  attach(httpServer: HttpServer) {
    if (this.server) return;

    this.server = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', async (request, socket, head) => {
      const url = new URL(request.url ?? '', 'http://127.0.0.1');
      if (url.pathname !== '/ws') return;

      try {
        const context = await this.authenticate(request, url);
        this.server?.handleUpgrade(request, socket, head, (ws) => {
          this.register(ws, context);
        });
      } catch {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
      }
    });
  }

  onModuleDestroy() {
    for (const client of this.clients.keys()) client.close();
    this.clients.clear();
    this.server?.close();
    this.server = null;
  }

  broadcast(type: FactoryWsEventType, payload: unknown) {
    const factoryId = payload && typeof payload === 'object' && 'factoryId' in payload
      && typeof payload.factoryId === 'string'
      ? payload.factoryId
      : null;
    if (!factoryId) return;
    if (!isFactoryWsEvent(type)) {
      this.logger.warn(`WebSocket factory event is not registered: ${String(type)}`);
      return;
    }
    this.sendToFactory(factoryId, type, {
      changedAt: new Date().toISOString(),
    });
  }

  sendToUsers(userIds: string[], type: WsEventType, payload: WsPayload) {
    const allowed = new Set(userIds.filter(Boolean));
    for (const [client, context] of this.clients.entries()) {
      if (!allowed.has(context.userId)) continue;
      if (type === WS_EVENTS.CHAT_UPDATED && (
        (!context.isAdmin && !context.permissions.has('chats.access')) || context.factoryId !== payload?.factoryId
      )) continue;
      this.send(client, type, payload);
    }
  }

  private sendToFactory(factoryId: string, type: FactoryWsEventType, payload: WsPayload) {
    const requiredCapabilities = FACTORY_WS_EVENT_CAPABILITIES[type];
    for (const [client, context] of this.clients.entries()) {
      if (context.factoryId !== factoryId) continue;
      if (!context.isAdmin && !requiredCapabilities.some((permission) => context.permissions.has(permission))) continue;
      this.send(client, type, payload);
    }
  }

  notifyAuthChanged(userId: string, factoryId?: string | null) {
    for (const [client, context] of this.clients.entries()) {
      if (context.userId !== userId) continue;
      if (factoryId && context.factoryId !== factoryId) continue;
      this.send(client, 'auth_context_changed', {
        reason: 'permissions_changed',
        message: 'Права доступа изменились. Данные будут обновлены.',
      });
      client.close(4001, 'auth_context_changed');
    }
  }

  notifyRoleChanged(role: UserRole) {
    for (const [client, context] of this.clients.entries()) {
      if (context.role !== role) continue;
      this.send(client, 'auth_context_changed', {
        reason: 'permissions_changed',
        message: 'Права роли изменились. Данные будут обновлены.',
      });
      client.close(4001, 'auth_context_changed');
    }
  }

  notifyFactoryUnavailable(factoryId: string) {
    for (const [client, context] of this.clients.entries()) {
      if (context.factoryId !== factoryId) continue;
      this.send(client, 'auth_context_changed', {
        reason: 'factory_unavailable',
        message: 'Завод временно недоступен. Выберите другой доступный завод.',
      });
      client.close(4001, 'auth_context_changed');
    }
  }

  connectedUsers() {
    return [...this.clients.values()].map((client) => ({
      userId: client.userId,
      factoryId: client.factoryId,
      role: client.role,
      departmentId: client.departmentId,
    }));
  }

  private async authenticate(request: IncomingMessage, url: URL): Promise<WsClientContext> {
    const tokenPayload = verifyAuthToken(this.authProtocolToken(request.headers['sec-websocket-protocol']) ?? undefined, 'auth');
    const userId = tokenPayload?.userId || (this.allowTestAuthHeaders
      ? url.searchParams.get('userId') || this.headerValue(request.headers['x-user-id'])
      : null);
    const factoryId = url.searchParams.get('factoryId') || this.headerValue(request.headers['x-factory-id']);
    if (!userId || !factoryId) throw new Error('missing websocket context');

    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: {
        factoryAccess: {
          where: { factoryId, isActive: true },
          include: {
            department: true,
            factory: { select: { isActive: true, deletedAt: true } },
          },
        },
        permissionOverrides: true,
      },
    });

    const access = user?.factoryAccess[0];
    const tokenIssuedBeforeAuthUpdate = tokenPayload && user?.authUpdatedAt
      ? tokenPayload.authEpoch !== undefined
        ? tokenPayload.authEpoch !== user.authUpdatedAt.getTime()
        : Math.floor(user.authUpdatedAt.getTime() / 1000) > (tokenPayload.iat ?? 0)
      : Boolean(tokenPayload?.authEpoch);
    if (
      !user
      || user.blockedAt
      || user.deletedAt
      || user.passwordResetRequired
      || tokenIssuedBeforeAuthUpdate
      || !access
      || access.isGuest
      || !access.factory.isActive
      || access.factory.deletedAt
    ) {
      throw new Error('websocket access denied');
    }

    const rolePermissions = await this.prisma.db.rolePermission.findMany({
      where: { role: access.role, isActive: true },
      select: { permissionCode: true },
    });
    const permissions = resolveEffectivePermissions({
      role: access.role,
      isGuest: access.isGuest,
      rolePermissionCodes: rolePermissions.map((item) => item.permissionCode),
      overrides: user.permissionOverrides.filter((item) => item.factoryId === null || item.factoryId === factoryId),
    });

    return {
      userId: user.id,
      factoryId,
      role: access.role,
      departmentId: access.departmentId,
      isAdmin: access.role === UserRole.ADMIN,
      permissions: new Set(permissions),
    };
  }

  private register(client: WebSocket, context: WsClientContext) {
    this.clients.set(client, context);
    this.send(client, 'connected', {
      factoryId: context.factoryId,
      userId: context.userId,
      message: 'Realtime подключён.',
    });
    client.on('close', () => this.clients.delete(client));
    client.on('error', () => this.clients.delete(client));
  }

  private send(client: WebSocket, type: string, payload: WsPayload) {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify({ type, payload }));
  }

  private headerValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private authProtocolToken(value: string | string[] | undefined) {
    const header = this.headerValue(value);
    if (!header) return null;
    const authProtocol = header.split(',').map((item) => item.trim()).find((item) => item.startsWith('auth.'));
    return authProtocol ? authProtocol.slice('auth.'.length) : null;
  }

}
