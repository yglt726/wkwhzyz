import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../types';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    actor?: AuthUser | null;
    action: string;
    entityType?: string;
    entityId?: string;
    detail?: unknown;
  }): Promise<void> {
    const detail =
      params.detail === undefined
        ? ''
        : typeof params.detail === 'string'
          ? params.detail
          : JSON.stringify(params.detail);
    await this.prisma.auditLog.create({
      data: {
        actorId: params.actor?.sub ?? null,
        actorName: params.actor?.name ?? 'system',
        actorRole: params.actor?.role ?? 'SYSTEM',
        action: params.action,
        entityType: params.entityType ?? '',
        entityId: params.entityId ?? '',
        detail,
      },
    });
  }
}
