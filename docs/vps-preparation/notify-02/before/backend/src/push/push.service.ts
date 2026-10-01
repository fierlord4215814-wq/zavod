import { Injectable, Logger } from '@nestjs/common';
import { Notification } from '@prisma/client';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

type PublicPushConfig = {
  available: boolean;
  publicKey: string | null;
  reason?: string;
};

type PushNotification = Pick<Notification,
  'id' | 'factoryId' | 'type' | 'title' | 'message' | 'severity' | 'createdAt'
> & { sourceRoute?: string | null };

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly config: PublicPushConfig;

  constructor(private readonly prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null;
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || null;
    const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@zavod.local';

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.config = { available: true, publicKey };
    } else {
      this.config = {
        available: false,
        publicKey: null,
        reason: 'Push через браузер требует VAPID-ключи и HTTPS. Внутренние уведомления работают без них.',
      };
    }
  }

  publicConfig(): PublicPushConfig {
    return this.config;
  }

  sendPush(userId: string, message: string) {
    if (process.env.PUSH_DEBUG === '1') {
      this.logger.log(`Локальный push-запрос: user=${userId ? 'set' : 'empty'}, messageLength=${message?.length ?? 0}`);
    }
  }

  notifyUser(userId: string, type: string, message: string) {
    if (process.env.PUSH_DEBUG === '1') {
      this.logger.log(`Локальный push-запрос: user=${userId ? 'set' : 'empty'}, type=${type}, messageLength=${message?.length ?? 0}`);
    }
  }

  async sendNotificationToUsers(userIds: string[], notification: PushNotification) {
    if (!this.config.available) return { sent: 0, skipped: userIds.length };
    const subscriptions = await this.prisma.db.pushSubscription.findMany({
      where: {
        userId: { in: [...new Set(userIds)] },
        factoryId: notification.factoryId ?? undefined,
        isActive: true,
        revokedAt: null,
      },
    });

    let sent = 0;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, JSON.stringify(this.notificationPayload(notification)));
        sent += 1;
      } catch (error: any) {
        const statusCode = Number(error?.statusCode ?? 0);
        if (statusCode === 404 || statusCode === 410) {
          await this.prisma.db.pushSubscription.update({
            where: { id: subscription.id },
            data: { isActive: false, revokedAt: new Date() },
          });
          continue;
        }
        this.logger.warn(`Push не отправлен: код ${statusCode || 'неизвестен'}`);
      }
    }
    return { sent, skipped: Math.max(0, subscriptions.length - sent) };
  }

  private notificationPayload(notification: PushNotification) {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      severity: notification.severity,
      factoryId: notification.factoryId,
      sourceRoute: notification.sourceRoute ?? null,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
