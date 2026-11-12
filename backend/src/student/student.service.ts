import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/services/audit.service';
import { TimeService } from '../common/services/time.service';
import { AuthUser, OFFER_KIND_LABELS, OFFER_STATUS_LABELS } from '../common/types';
import { OfferService } from '../offers/offer.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitIntentsDto } from './dto/submit-intents.dto';

@Injectable()
export class StudentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: TimeService,
    private readonly audit: AuditService,
    private readonly offers: OfferService,
  ) {}

  async getIntents(studentId: string, roundNo = 1) {
    const application = await this.prisma.application.findUnique({
      where: { studentId_roundNo: { studentId, roundNo } },
    });
    if (!application) {
      return { roundNo, submitted: false, application: null, intents: [] };
    }
    const intents = await this.prisma.intent.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: 'asc' },
    });
    const [mentors, labs] = await Promise.all([
      this.prisma.mentor.findMany({ where: { id: { in: intents.map((i) => i.mentorId) } } }),
      this.prisma.lab.findMany(),
    ]);
    const mentorMap = new Map(mentors.map((m) => [m.id, m]));
    const labMap = new Map(labs.map((l) => [l.id, l]));
    return {
      roundNo,
      submitted: true,
      application: {
        id: application.id,
        acceptLabAdjust: application.acceptLabAdjust,
        acceptCollegeAdjust: application.acceptCollegeAdjust,
        status: application.status,
        submittedAt: application.submittedAt,
        updatedAt: application.updatedAt,
      },
      intents: intents.map((i) => {
        const m = mentorMap.get(i.mentorId);
        const l = labMap.get(i.labId);
        return {
          id: i.id,
          mentorId: i.mentorId,
          mentorName: m?.name ?? '',
          mentorTitle: m?.title ?? '',
          quota: m?.quota ?? 0,
          labId: i.labId,
          labName: l?.name ?? '',
          createdAt: i.createdAt,
        };
      }),
    };
  }

  async submitIntents(studentId: string, dto: SubmitIntentsDto, actor: AuthUser) {
    await this.time.requireRound(dto.roundNo);
    await this.time.assertOpen('INTENT', dto.roundNo);

    const placed = await this.prisma.offer.findFirst({
      where: { studentId, status: 'CONFIRMED' },
    });
    if (placed) throw new ConflictException('你已确认入组去向，不能再填报意向');

    const ids = dto.mentorIds || [];
    if (ids.length !== new Set(ids).size) throw new BadRequestException('同一导师不能重复填报');
    const maxCfg = await this.prisma.systemConfig.findUnique({ where: { key: 'MAX_INTENTS_PER_ROUND' } });
    const max = maxCfg ? Number(maxCfg.value) || 3 : 3;
    if (ids.length > max) throw new BadRequestException(`每轮最多填报 ${max} 个导师意向`);

    const mentors = await this.prisma.mentor.findMany({
      where: { id: { in: ids }, active: true },
    });
    if (mentors.length !== ids.length) throw new BadRequestException('存在无效或已停用的导师');
    const labIds = new Set(mentors.map((m) => m.labId));
    const labs = await this.prisma.lab.findMany({ where: { id: { in: Array.from(labIds) } } });
    if (labs.length !== labIds.size) throw new BadRequestException('导师所属实训室数据异常');

    const application = await this.prisma.$transaction(async (tx) => {
      const app = await tx.application.upsert({
        where: { studentId_roundNo: { studentId, roundNo: dto.roundNo } },
        create: {
          studentId,
          roundNo: dto.roundNo,
          acceptLabAdjust: dto.acceptLabAdjust,
          acceptCollegeAdjust: dto.acceptCollegeAdjust,
          status: 'SUBMITTED',
        },
        update: {
          acceptLabAdjust: dto.acceptLabAdjust,
          acceptCollegeAdjust: dto.acceptCollegeAdjust,
          status: 'SUBMITTED',
        },
      });
      await tx.intent.deleteMany({ where: { applicationId: app.id } });
      for (const mentor of mentors) {
        await tx.intent.create({
          data: {
            applicationId: app.id,
            studentId,
            roundNo: dto.roundNo,
            mentorId: mentor.id,
            labId: mentor.labId,
          },
        });
      }
      return app;
    });

    await this.audit.log({
      actor,
      action: 'INTENT_SUBMIT',
      entityType: 'APPLICATION',
      entityId: application.id,
      detail: {
        roundNo: dto.roundNo,
        mentorIds: ids,
        acceptLabAdjust: dto.acceptLabAdjust,
        acceptCollegeAdjust: dto.acceptCollegeAdjust,
      },
    });
    return this.getIntents(studentId, dto.roundNo);
  }

  async getOffers(studentId: string, roundNoInput?: number) {
    const roundNo = roundNoInput || (await this.time.currentRound());
    const now = await this.time.getNow();
    const confirmWin = await this.time.getWindow('CONFIRM', roundNo);
    const published = confirmWin ? now >= confirmWin.startsAt : false;
    const offers = published
      ? await this.prisma.offer.findMany({
          where: { studentId, roundNo },
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        })
      : [];

    const mentors = offers.length
      ? await this.prisma.mentor.findMany({ where: { id: { in: offers.map((o) => o.mentorId) } } })
      : [];
    const labs = offers.length
      ? await this.prisma.lab.findMany({ where: { id: { in: offers.map((o) => o.labId) } } })
      : [];
    const mentorMap = new Map(mentors.map((m) => [m.id, m]));
    const labMap = new Map(labs.map((l) => [l.id, l]));

    const placement = await this.prisma.offer.findFirst({
      where: { studentId, status: 'CONFIRMED' },
      orderBy: { decidedAt: 'desc' },
    });
    let placementView: any = null;
    if (placement) {
      const m = mentorMap.get(placement.mentorId) || (await this.prisma.mentor.findUnique({ where: { id: placement.mentorId } }));
      const l = labMap.get(placement.labId) || (await this.prisma.lab.findUnique({ where: { id: placement.labId } }));
      placementView = {
        offerId: placement.id,
        mentorId: placement.mentorId,
        mentorName: m?.name ?? '',
        labId: placement.labId,
        labName: l?.name ?? '',
        kind: placement.kind,
        kindLabel: OFFER_KIND_LABELS[placement.kind] ?? placement.kind,
        decidedAt: placement.decidedAt,
        roundNo: placement.roundNo,
      };
    }

    return {
      roundNo,
      published,
      confirmWindow: confirmWin
        ? {
            startsAt: confirmWin.startsAt,
            endsAt: confirmWin.endsAt,
            open: now >= confirmWin.startsAt && now <= confirmWin.endsAt,
            notStarted: now < confirmWin.startsAt,
            remainingMs: Math.max(0, confirmWin.endsAt.getTime() - now.getTime()),
          }
        : null,
      serverNow: now,
      placement: placementView,
      offers: offers.map((o) => ({
        id: o.id,
        mentorId: o.mentorId,
        mentorName: mentorMap.get(o.mentorId)?.name ?? '',
        labId: o.labId,
        labName: labMap.get(o.labId)?.name ?? '',
        kind: o.kind,
        kindLabel: OFFER_KIND_LABELS[o.kind] ?? o.kind,
        status: o.status,
        statusLabel: OFFER_STATUS_LABELS[o.status] ?? o.status,
        autoConfirmed: o.autoConfirmed,
        overQuota: o.overQuota,
        expiresAt: o.expiresAt,
        decidedAt: o.decidedAt,
        note: o.note,
      })),
    };
  }

  async confirm(studentId: string, offerId: string, actor: AuthUser) {
    return this.offers.confirmOffer(studentId, offerId, 'STUDENT', actor);
  }

  async decline(studentId: string, offerId: string, actor: AuthUser) {
    return this.offers.declineOffer(studentId, offerId, actor);
  }

  async result(studentId: string) {
    const placement = await this.prisma.offer.findFirst({
      where: { studentId, status: 'CONFIRMED' },
      orderBy: { decidedAt: 'desc' },
    });
    const [mentors, labs] = await Promise.all([
      this.prisma.mentor.findMany(),
      this.prisma.lab.findMany(),
    ]);
    const mentorMap = new Map(mentors.map((m) => [m.id, m]));
    const labMap = new Map(labs.map((l) => [l.id, l]));
    const allOffers = await this.prisma.offer.findMany({
      where: { studentId },
      orderBy: [{ roundNo: 'asc' }, { createdAt: 'asc' }],
    });
    const [publicity, enroll] = await Promise.all([
      this.time.getWindow('PUBLICITY', 0),
      this.time.getWindow('ENROLL', 0),
    ]);
    const now = await this.time.getNow();
    return {
      placed: Boolean(placement),
      placement: placement
        ? {
            mentorId: placement.mentorId,
            mentorName: mentorMap.get(placement.mentorId)?.name ?? '',
            mentorTitle: mentorMap.get(placement.mentorId)?.title ?? '',
            labId: placement.labId,
            labName: labMap.get(placement.labId)?.name ?? '',
            kind: placement.kind,
            kindLabel: OFFER_KIND_LABELS[placement.kind] ?? placement.kind,
            roundNo: placement.roundNo,
            decidedAt: placement.decidedAt,
            autoConfirmed: placement.autoConfirmed,
          }
        : null,
      publicity: publicity
        ? {
            startsAt: publicity.startsAt,
            endsAt: publicity.endsAt,
            open: now >= publicity.startsAt && now <= publicity.endsAt,
            finished: now > publicity.endsAt,
          }
        : null,
      enroll: enroll
        ? {
            startsAt: enroll.startsAt,
            endsAt: enroll.endsAt,
            open: now >= enroll.startsAt && now <= enroll.endsAt,
          }
        : null,
      history: allOffers.map((o) => ({
        id: o.id,
        roundNo: o.roundNo,
        kind: o.kind,
        kindLabel: OFFER_KIND_LABELS[o.kind] ?? o.kind,
        status: o.status,
        statusLabel: OFFER_STATUS_LABELS[o.status] ?? o.status,
        mentorName: mentorMap.get(o.mentorId)?.name ?? '',
        labName: labMap.get(o.labId)?.name ?? '',
        createdAt: o.createdAt,
        decidedAt: o.decidedAt,
        note: o.note,
      })),
    };
  }
}
