import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/services/audit.service';
import { LockService } from '../common/services/lock.service';
import { TimeService } from '../common/services/time.service';
import { AuthUser, OFFER_KIND_LABELS, STAGE_LABELS } from '../common/types';
import { OfferService } from '../offers/offer.service';
import { PrismaService } from '../prisma/prisma.service';

const WITHDRAW_REASON_LABELS: Record<string, string> = {
  CONFIRM_ABANDON: '确认后放弃',
  PUBLICITY_ABANDON: '公示后放弃',
  NO_SHOW: '入组未报到',
  ADMIN_RELEASE: '管理员人工释放',
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: TimeService,
    private readonly offers: OfferService,
    private readonly audit: AuditService,
    private readonly lock: LockService,
  ) {}

  async overview(roundNo = 0) {
    const [ledger, anomalies, stage, confirmed] = await Promise.all([
      this.offers.ledger(),
      this.prisma.anomaly.findMany({ where: { resolved: false }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.time.stageSnapshot(),
      this.prisma.offer.findMany({ where: { status: 'CONFIRMED' }, orderBy: { decidedAt: 'desc' }, take: 200 }),
    ]);
    const [students, mentors, labs, withdrawals] = await Promise.all([
      this.prisma.user.findMany({ where: { role: 'STUDENT', active: true } }),
      this.prisma.mentor.findMany(),
      this.prisma.lab.findMany(),
      this.prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const mentorMap = new Map(mentors.map((m) => [m.id, m]));
    const labMap = new Map(labs.map((l) => [l.id, l]));
    return {
      stage,
      roundNo,
      ledger,
      anomalyCount: anomalies.length,
      anomalies,
      confirmedOffers: confirmed.map((o) => ({
        id: o.id,
        studentId: o.studentId,
        studentName: studentMap.get(o.studentId)?.name ?? '',
        studentNo: studentMap.get(o.studentId)?.studentNo ?? '',
        mentorId: o.mentorId,
        mentorName: mentorMap.get(o.mentorId)?.name ?? '',
        labId: o.labId,
        labName: labMap.get(o.labId)?.name ?? '',
        kind: o.kind,
        kindLabel: OFFER_KIND_LABELS[o.kind] ?? o.kind,
        overQuota: o.overQuota,
        autoConfirmed: o.autoConfirmed,
        decidedAt: o.decidedAt,
      })),
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        offerId: w.offerId,
        studentName: studentMap.get(w.studentId)?.name ?? '',
        mentorName: mentorMap.get(w.mentorId)?.name ?? '',
        reason: w.reason,
        reasonLabel: WITHDRAW_REASON_LABELS[w.reason] ?? w.reason,
        detail: w.detail,
        createdAt: w.createdAt,
      })),
    };
  }

  async reconcile(roundNo: number, actor: AuthUser) {
    return this.offers.reconcile(roundNo, actor);
  }

  async anomalies() {
    const items = await this.prisma.anomaly.findMany({
      orderBy: [{ resolved: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return { items, unresolvedCount: items.filter((i) => !i.resolved).length };
  }

  async resolveAnomaly(id: string, actor: AuthUser) {
    const anomaly = await this.prisma.anomaly.findUnique({ where: { id } });
    if (!anomaly) throw new NotFoundException('异常记录不存在');
    const updated = await this.prisma.anomaly.update({ where: { id }, data: { resolved: true } });
    await this.audit.log({
      actor,
      action: 'ANOMALY_RESOLVE',
      entityType: 'ANOMALY',
      entityId: id,
      detail: { type: anomaly.type, entityId: anomaly.entityId },
    });
    return updated;
  }

  async auditLogs(action?: string) {
    return this.prisma.auditLog.findMany({
      where: action ? { action } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async publicity() {
    const [offers, withdrawals, students, mentors, labs, stage] = await Promise.all([
      this.prisma.offer.findMany({ where: { status: 'CONFIRMED' }, orderBy: { decidedAt: 'asc' } }),
      this.prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.user.findMany({ where: { role: 'STUDENT', active: true } }),
      this.prisma.mentor.findMany({ where: { active: true }, orderBy: [{ labId: 'asc' }, { sortOrder: 'asc' }] }),
      this.prisma.lab.findMany({ orderBy: { code: 'asc' } }),
      this.time.stageSnapshot(),
    ]);
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const mentorMap = new Map(mentors.map((m) => [m.id, m]));
    const labMap = new Map(labs.map((l) => [l.id, l]));
    const placedIds = new Set(offers.map((o) => o.studentId));

    const finalList = offers.map((o) => ({
      offerId: o.id,
      studentId: o.studentId,
      studentName: studentMap.get(o.studentId)?.name ?? '',
      studentNo: studentMap.get(o.studentId)?.studentNo ?? '',
      mentorId: o.mentorId,
      mentorName: mentorMap.get(o.mentorId)?.name ?? '',
      labId: o.labId,
      labName: labMap.get(o.labId)?.name ?? '',
      kind: o.kind,
      kindLabel: OFFER_KIND_LABELS[o.kind] ?? o.kind,
      roundNo: o.roundNo,
      overQuota: o.overQuota,
      autoConfirmed: o.autoConfirmed,
      decidedAt: o.decidedAt,
    }));

    const byLab = labs
      .map((lab) => ({
        labId: lab.id,
        labName: lab.name,
        quota: mentors.filter((m) => m.labId === lab.id).reduce((s, m) => s + m.quota, 0),
        members: finalList.filter((f) => f.labId === lab.id),
      }))
      .filter((l) => l.members.length > 0 || l.quota > 0);

    return {
      stage,
      publicity: stage.windows.find((w) => w.stageKey === 'PUBLICITY') ?? null,
      enroll: stage.windows.find((w) => w.stageKey === 'ENROLL') ?? null,
      finalList,
      byLab,
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        studentName: studentMap.get(w.studentId)?.name ?? '',
        mentorName: mentorMap.get(w.mentorId)?.name ?? '',
        reason: w.reason,
        reasonLabel: WITHDRAW_REASON_LABELS[w.reason] ?? w.reason,
        detail: w.detail,
        createdAt: w.createdAt,
      })),
      summary: {
        totalQuota: mentors.reduce((s, m) => s + m.quota, 0),
        placed: placedIds.size,
        unplaced: students.length - placedIds.size,
        overQuotaMentors: (await this.offers.ledger()).rows.filter((r) => r.overQuota).length,
        released: withdrawals.length,
      },
    };
  }

  /** 放鸽子：不删除 offer，生成 withdraw 记录释放名额，人回到补录/调剂池 */
  async withdraw(offerId: string, reason: string, detail: string, actor: AuthUser) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('拟录取记录不存在');
    if (offer.status !== 'CONFIRMED') throw new ConflictException('只有已确认的录取才能登记放弃');
    const now = await this.time.getNow();
    const ok = await this.lock.withLock(`student:${offer.studentId}:offer`, async () => {
      const res = await this.prisma.offer.updateMany({
        where: { id: offerId, status: 'CONFIRMED' },
        data: {
          status: 'WITHDRAWN',
          decidedAt: now,
          note: `WITHDRAWN:${reason}`,
        },
      });
      if (res.count === 0) return false;
      await this.prisma.withdrawal.create({
        data: {
          offerId,
          studentId: offer.studentId,
          mentorId: offer.mentorId,
          reason,
          detail: detail || '',
        },
      });
      return true;
    });
    if (!ok) throw new ConflictException('该录取状态已变更，请刷新');
    await this.audit.log({
      actor,
      action: 'OFFER_WITHDRAWN',
      entityType: 'OFFER',
      entityId: offerId,
      detail: {
        reason,
        detail,
        studentId: offer.studentId,
        mentorId: offer.mentorId,
        roundNo: offer.roundNo,
        releasedQuota: true,
      },
    });
    await this.offers.promoteWaitlist(offer.mentorId, offer.roundNo, actor);
    return { ok: true, quota: await this.offers.getQuota(offer.mentorId, offer.roundNo) };
  }

  async windows() {
    const snapshot = await this.time.stageSnapshot();
    return {
      now: snapshot.now,
      activeStage: snapshot.activeStage,
      windows: snapshot.windows.map((w) => ({ ...w, stageLabel: STAGE_LABELS[w.stageKey] ?? w.stageKey })),
    };
  }

  async updateWindow(id: string, startsAt: string, endsAt: string, actor: AuthUser) {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new BadRequestException('时间格式不正确');
    if (start >= end) throw new BadRequestException('开始时间必须早于结束时间');
    const win = await this.prisma.stageWindow.findUnique({ where: { id } });
    if (!win) throw new NotFoundException('环节时间窗不存在');
    const updated = await this.prisma.stageWindow.update({ where: { id }, data: { startsAt: start, endsAt: end } });
    await this.audit.log({
      actor,
      action: 'WINDOW_UPDATE',
      entityType: 'STAGE_WINDOW',
      entityId: id,
      detail: { stageKey: win.stageKey, roundNo: win.roundNo, startsAt: start, endsAt: end },
    });
    return updated;
  }

  async setClock(iso: string, actor: AuthUser) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) throw new BadRequestException('模拟时间格式不正确');
    await this.prisma.systemConfig.upsert({
      where: { key: 'SIMULATED_NOW' },
      create: { key: 'SIMULATED_NOW', value: d.toISOString() },
      update: { value: d.toISOString() },
    });
    await this.audit.log({
      actor,
      action: 'CLOCK_SET',
      entityType: 'SYSTEM',
      entityId: 'SIMULATED_NOW',
      detail: { now: d.toISOString() },
    });
    const autoConfirmed = await this.offers.sweepAutoConfirm();
    return { ok: true, autoConfirmed, stage: await this.time.stageSnapshot() };
  }

  async resetClock(actor: AuthUser) {
    await this.prisma.systemConfig.deleteMany({ where: { key: 'SIMULATED_NOW' } });
    await this.audit.log({
      actor,
      action: 'CLOCK_RESET',
      entityType: 'SYSTEM',
      entityId: 'SIMULATED_NOW',
      detail: { now: 'REAL_TIME' },
    });
    return { ok: true, stage: await this.time.stageSnapshot() };
  }
}
