import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Mentor, Offer } from '@prisma/client';
import { AuditService } from '../common/services/audit.service';
import { LockService } from '../common/services/lock.service';
import { TimeService } from '../common/services/time.service';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

export interface MentorQuota {
  mentorId: string;
  mentorName: string;
  labId: string;
  quota: number;
  confirmed: number;
  pending: number;
  waitlistPending: number;
  released: number;
  free: number;
  overQuota: boolean;
  overRatio: number;
}

@Injectable()
export class OfferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: TimeService,
    private readonly lock: LockService,
    private readonly audit: AuditService,
  ) {}

  /** 系统自动生成的室内调剂候选：本室服从室内调剂、尚未确认去向的学生，按面试总分降序 */
  async autoLabAdjustCandidates(labId: string, roundNo: number) {
    const [intents, interviews, apps, placed, pendingOffers] = await Promise.all([
      this.prisma.intent.findMany({ where: { roundNo, labId } }),
      this.prisma.interview.findMany({ where: { roundNo, labId } }),
      this.prisma.application.findMany({ where: { roundNo } }),
      this.prisma.offer.findMany({ where: { status: 'CONFIRMED' }, select: { studentId: true } }),
      this.prisma.offer.findMany({
        where: { roundNo, status: 'PENDING', kind: { in: ['PRIMARY', 'WAITLIST'] } },
        select: { studentId: true },
      }),
    ]);
    const placedSet = new Set(placed.map((p) => p.studentId));
    const pendingSet = new Set(pendingOffers.map((p) => p.studentId));
    const appMap = new Map(apps.map((a) => [a.studentId, a]));
    const interviewMap = new Map(interviews.map((i) => [i.studentId, i]));
    const ids = Array.from(new Set(intents.map((i) => i.studentId))).filter((id) => {
      if (!appMap.get(id)?.acceptLabAdjust) return false;
      return !placedSet.has(id) && !pendingSet.has(id);
    });
    const students = await this.prisma.user.findMany({ where: { id: { in: ids } } });
    const studentMap = new Map(students.map((s) => [s.id, s]));
    return ids
      .map((id) => ({
        studentId: id,
        studentName: studentMap.get(id)?.name ?? '',
        studentNo: studentMap.get(id)?.studentNo ?? '',
        total: interviewMap.get(id)?.total ?? null,
        submittedAt: appMap.get(id)?.submittedAt ?? null,
      }))
      .sort((a, b) => {
        if ((b.total ?? -1) !== (a.total ?? -1)) return (b.total ?? -1) - (a.total ?? -1);
        return (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0);
      })
      .map((x, i) => ({
        studentId: x.studentId,
        studentName: x.studentName,
        studentNo: x.studentNo,
        total: x.total,
        rank: i + 1,
      }));
  }

  /** 导师端展示用：自动候选 + 已提交顺位 + 生效顺序 */
  async labAdjustCandidateView(mentorId: string, labId: string, roundNo: number) {
    const [auto, saved] = await Promise.all([
      this.autoLabAdjustCandidates(labId, roundNo),
      this.prisma.labAdjustCandidate.findMany({
        where: { roundNo, mentorId },
        orderBy: { rank: 'asc' },
      }),
    ]);
    const autoMap = new Map(auto.map((a) => [a.studentId, a]));
    const savedIds = saved.map((s) => s.studentId).filter((id) => autoMap.has(id));
    const effective = [
      ...savedIds.map((id, i) => ({ ...autoMap.get(id)!, rank: i + 1, source: 'MENTOR' })),
      ...auto
        .filter((a) => !savedIds.includes(a.studentId))
        .map((a, i) => ({ ...a, rank: savedIds.length + i + 1, source: 'AUTO' })),
    ];
    return { auto, saved: savedIds, effective };
  }

  /** 名额三层账本：已确认占用 / 待确认预占 / 可释放（实时口径，不做缓存） */
  async getQuota(mentorId: string, roundNo = 0): Promise<MentorQuota> {
    const mentor = await this.prisma.mentor.findUnique({ where: { id: mentorId } });
    if (!mentor) throw new NotFoundException('导师不存在');
    const confirmed = await this.prisma.offer.count({
      where: { mentorId, status: 'CONFIRMED' },
    });
    const pending = await this.prisma.offer.count({
      where: {
        mentorId,
        status: 'PENDING',
        kind: { in: ['PRIMARY', 'LAB_ADJUST', 'COLLEGE_ADJUST', 'FINAL'] },
      },
    });
    const waitlistPending = await this.prisma.offer.count({
      where: { mentorId, roundNo, kind: 'WAITLIST', status: 'PENDING' },
    });
    const released = await this.prisma.withdrawal.count({ where: { mentorId } });
    const free = Math.max(0, mentor.quota - confirmed - pending);
    const overRatio = mentor.quota > 0 && confirmed > mentor.quota ? confirmed / mentor.quota - 1 : 0;
    return {
      mentorId,
      mentorName: mentor.name,
      labId: mentor.labId,
      quota: mentor.quota,
      confirmed,
      pending,
      waitlistPending,
      released,
      free,
      overQuota: confirmed > mentor.quota,
      overRatio: Number(overRatio.toFixed(3)),
    };
  }

  /** 全校导师名额账本（管理后台） */
  async ledger() {
    const [mentors, labs, offers, withdrawals] = await Promise.all([
      this.prisma.mentor.findMany({ where: { active: true }, orderBy: [{ labId: 'asc' }, { sortOrder: 'asc' }] }),
      this.prisma.lab.findMany(),
      this.prisma.offer.findMany(),
      this.prisma.withdrawal.findMany(),
    ]);
    const labMap = new Map(labs.map((l) => [l.id, l.name]));
    const rows = mentors.map((m) => {
      const confirmed = offers.filter((o) => o.mentorId === m.id && o.status === 'CONFIRMED').length;
      const pending = offers.filter(
        (o) => o.mentorId === m.id && o.status === 'PENDING' && o.kind !== 'WAITLIST',
      ).length;
      const waitlistPending = offers.filter(
        (o) => o.mentorId === m.id && o.kind === 'WAITLIST' && o.status === 'PENDING',
      ).length;
      const released = withdrawals.filter((w) => w.mentorId === m.id).length;
      const free = Math.max(0, m.quota - confirmed - pending);
      const overRatio = m.quota > 0 && confirmed > m.quota ? Number((confirmed / m.quota - 1).toFixed(3)) : 0;
      return {
        mentorId: m.id,
        mentorName: m.name,
        mentorTitle: m.title,
        labId: m.labId,
        labName: labMap.get(m.labId) ?? '',
        quota: m.quota,
        confirmed,
        pending,
        waitlistPending,
        released,
        free,
        overQuota: confirmed > m.quota,
        overRatio,
      };
    });
    return {
      rows,
      summary: {
        quota: rows.reduce((s, r) => s + r.quota, 0),
        confirmed: rows.reduce((s, r) => s + r.confirmed, 0),
        pending: rows.reduce((s, r) => s + r.pending, 0),
        free: rows.reduce((s, r) => s + r.free, 0),
        overQuotaMentors: rows.filter((r) => r.overQuota).length,
      },
    };
  }

  /** 导师提交拟录取 + 递补名单（同一事务内完成校验、超发判定与自动确认） */
  async publishForMentor(params: {
    mentor: Mentor;
    roundNo: number;
    primary: string[];
    waitlist: string[];
    labAdjustCandidates?: string[];
    overQuotaConfirm: boolean;
    actor: AuthUser;
  }) {
    const { mentor, roundNo, actor } = params;
    await this.time.requireRound(roundNo);
    await this.time.assertAnyOpen([
      { stageKey: 'INTERVIEW', roundNo },
      { stageKey: 'CONFIRM', roundNo },
    ]);
    const confirmWin = await this.time.roundConfirmWindow(roundNo);

    const primary = Array.from(new Set(params.primary || []));
    const waitlist = Array.from(new Set(params.waitlist || []));
    if (primary.length === 0 && waitlist.length === 0) {
      throw new BadRequestException('请至少选择 1 名学生');
    }
    const overlap = primary.filter((id) => waitlist.includes(id));
    if (overlap.length) throw new BadRequestException('同一学生不能同时出现在拟录取与递补名单');

    const allIds = [...primary, ...waitlist];
    const users = await this.prisma.user.findMany({
      where: { id: { in: allIds }, role: 'STUDENT', active: true },
    });
    if (users.length !== allIds.length) throw new BadRequestException('存在无效的学生账号');
    const nameMap = new Map(users.map((u) => [u.id, u.name]));

    const intents = await this.prisma.intent.findMany({
      where: { roundNo, mentorId: mentor.id, studentId: { in: allIds } },
    });
    const intentSet = new Set(intents.map((i) => i.studentId));
    const notApplied = allIds.filter((id) => !intentSet.has(id)).map((id) => nameMap.get(id) || id);
    if (notApplied.length) {
      throw new BadRequestException(`以下学生未在${roundNo}轮填报你：${notApplied.join('、')}`);
    }

    // 已确认去向的学生不能再次被拟录取（由导师移除，不阻塞整批）
    const placed = await this.prisma.offer.findMany({
      where: { studentId: { in: allIds }, status: 'CONFIRMED' },
      select: { studentId: true },
    });
    const placedSet = new Set(placed.map((p) => p.studentId));
    const skippedPlaced = allIds.filter((id) => placedSet.has(id)).map((id) => nameMap.get(id) || id);
    const primaryEff = primary.filter((id) => !placedSet.has(id));
    const waitlistEff = waitlist.filter((id) => !placedSet.has(id));

    // 室内调剂候选：必须属于本室、本轮未被拟录取、不得与拟录取/递补冲突、同一学生不得重复
    const candidateIds = Array.from(params.labAdjustCandidates ?? []);
    if (new Set(candidateIds).size !== candidateIds.length) {
      throw new BadRequestException('室内调剂候选名单存在重复学生');
    }
    if (candidateIds.length > 0) {
      const [labIntents, titled, candApps, candPlaced] = await Promise.all([
        this.prisma.intent.findMany({
          where: { roundNo, labId: mentor.labId, studentId: { in: candidateIds } },
        }),
        this.prisma.user.findMany({ where: { id: { in: candidateIds }, role: 'STUDENT', active: true } }),
        this.prisma.application.findMany({ where: { roundNo, studentId: { in: candidateIds } } }),
        this.prisma.offer.findMany({
          where: { studentId: { in: candidateIds }, status: 'CONFIRMED' },
          select: { studentId: true },
        }),
      ]);
      const candName = new Map(titled.map((u) => [u.id, u.name]));
      const inLab = new Set(labIntents.map((i) => i.studentId));
      const outside = candidateIds.filter((id) => !inLab.has(id)).map((id) => candName.get(id) || id);
      if (outside.length) {
        throw new BadRequestException(`室内调剂候选必须属于本实训室本轮报名学生：${outside.join('、')}`);
      }
      const conflict = candidateIds
        .filter((id) => primaryEff.includes(id) || waitlistEff.includes(id))
        .map((id) => candName.get(id) || id);
      if (conflict.length) {
        throw new BadRequestException(`室内调剂候选不能与拟录取/递补名单重复：${conflict.join('、')}`);
      }
      const confirmed = new Set(candPlaced.map((p) => p.studentId));
      const alreadyPlaced = candidateIds.filter((id) => confirmed.has(id)).map((id) => candName.get(id) || id);
      if (alreadyPlaced.length) {
        throw new BadRequestException(`以下学生本轮已有确认去向，不能进入室内调剂候选：${alreadyPlaced.join('、')}`);
      }
      const consent = new Map(candApps.map((a) => [a.studentId, a.acceptLabAdjust]));
      const noConsent = candidateIds.filter((id) => !consent.get(id)).map((id) => candName.get(id) || id);
      if (noConsent.length) {
        throw new BadRequestException(`以下学生未勾选服从室内调剂，不能作为候选：${noConsent.join('、')}`);
      }
    }

    // 重提：仅允许覆盖尚未生效的名单
    const existing = await this.prisma.offer.findMany({
      where: { mentorId: mentor.id, roundNo, kind: { in: ['PRIMARY', 'WAITLIST'] } },
    });
    if (existing.length > 0) {
      const locked = existing.filter((o) => o.status !== 'PENDING' || o.note === 'WAITLIST_PROMOTED');
      const confirmCount = await this.prisma.confirmation.count({
        where: { offerId: { in: existing.map((o) => o.id) } },
      });
      if (locked.length > 0 || confirmCount > 0) {
        throw new ConflictException('该轮名单已生效（存在已确认/已拒绝/已递补记录），不能重新提交');
      }
      await this.prisma.offer.deleteMany({ where: { id: { in: existing.map((o) => o.id) } } });
      await this.audit.log({
        actor,
        action: 'OFFERS_REPUBLISH',
        entityType: 'MENTOR',
        entityId: mentor.id,
        detail: { roundNo, deleted: existing.length },
      });
    }

    const quotaInfo = await this.getQuota(mentor.id, roundNo);
    const projected = quotaInfo.confirmed + quotaInfo.pending + primaryEff.length;
    const overQuota = projected > mentor.quota;
    if (overQuota && !params.overQuotaConfirm) {
      throw new ConflictException({
        code: 'OVER_QUOTA_CONFIRM_REQUIRED',
        message: `拟录取将超发：名额 ${mentor.quota}，已确认 ${quotaInfo.confirmed}，待确认预占 ${quotaInfo.pending}，本次拟录取 ${primaryEff.length}，合计 ${projected}。超发需二次确认。`,
        data: {
          quota: mentor.quota,
          confirmed: quotaInfo.confirmed,
          pending: quotaInfo.pending,
          adding: primaryEff.length,
          projected,
          overRatio: mentor.quota > 0 ? Number((projected / mentor.quota - 1).toFixed(3)) : 0,
        },
      });
    }

    if (overQuota) {
      await this.audit.log({
        actor,
        action: 'OFFER_OVER_QUOTA',
        entityType: 'MENTOR',
        entityId: mentor.id,
        detail: { roundNo, quota: mentor.quota, confirmed: quotaInfo.confirmed, pending: quotaInfo.pending, adding: primaryEff.length },
      });
    }

    const createdPrimary: Offer[] = [];
    const finalSkipped = [...skippedPlaced];
    for (let i = 0; i < primaryEff.length; i += 1) {
      const studentId = primaryEff[i];
      const offer = await this.lock.withLock(`student:${studentId}:offer`, async () => {
        const placedNow = await this.prisma.offer.findFirst({
          where: { studentId, status: 'CONFIRMED' },
        });
        if (placedNow) return null;
        return this.prisma.offer.create({
          data: {
            roundNo,
            studentId,
            mentorId: mentor.id,
            labId: mentor.labId,
            kind: 'PRIMARY',
            status: 'PENDING',
            overQuota: quotaInfo.confirmed + quotaInfo.pending + i + 1 > mentor.quota,
            expiresAt: confirmWin.endsAt,
            note: '',
          },
        });
      });
      if (!offer) {
        finalSkipped.push(nameMap.get(studentId) || studentId);
        continue;
      }
      createdPrimary.push(offer);
      await this.audit.log({
        actor,
        action: 'OFFER_CREATED',
        entityType: 'OFFER',
        entityId: offer.id,
        detail: { roundNo, studentId, mentorId: mentor.id, kind: 'PRIMARY' },
      });
    }

    for (let i = 0; i < waitlistEff.length; i += 1) {
      const studentId = waitlistEff[i];
      const offer = await this.prisma.offer.create({
        data: {
          roundNo,
          studentId,
          mentorId: mentor.id,
          labId: mentor.labId,
          kind: 'WAITLIST',
          rank: i + 1,
          status: 'PENDING',
          note: 'WAITLIST',
          expiresAt: null,
        },
      });
      await this.audit.log({
        actor,
        action: 'WAITLIST_CREATED',
        entityType: 'OFFER',
        entityId: offer.id,
        detail: { roundNo, studentId, mentorId: mentor.id, rank: i + 1 },
      });
    }

    // 室内调剂候选顺位：整体替换为本轮提交值；未提交（空数组）时回落到系统自动生成
    const [previousSaved, autoCandidates] = await Promise.all([
      this.prisma.labAdjustCandidate.findMany({
        where: { roundNo, mentorId: mentor.id },
        orderBy: { rank: 'asc' },
      }),
      this.autoLabAdjustCandidates(mentor.labId, roundNo),
    ]);
    const previousOrder = previousSaved.length
      ? previousSaved.map((c) => c.studentId)
      : autoCandidates.map((c) => c.studentId);
    // 未提交候选时按自动顺序生效，审计记录的实际生效顺序与行为保持一致
    const afterOrder = candidateIds.length ? candidateIds : autoCandidates.map((c) => c.studentId);
    await this.prisma.$transaction([
      this.prisma.labAdjustCandidate.deleteMany({ where: { roundNo, mentorId: mentor.id } }),
      ...candidateIds.map((studentId, i) =>
        this.prisma.labAdjustCandidate.create({
          data: { roundNo, labId: mentor.labId, mentorId: mentor.id, studentId, rank: i + 1 },
        }),
      ),
    ]);
    if (JSON.stringify(previousOrder) !== JSON.stringify(afterOrder)) {
      await this.audit.log({
        actor,
        action: 'LAB_ADJUST_CANDIDATES_UPDATE',
        entityType: 'MENTOR',
        entityId: mentor.id,
        detail: {
          roundNo,
          before: previousOrder,
          after: afterOrder,
          submitted: candidateIds,
          source: previousSaved.length ? 'MENTOR' : 'AUTO',
        },
      });
    }

    // 确认窗已开放时，单 offer 立即生效（实时自动确认）
    const autoConfirmed: string[] = [];
    if (await this.time.isOpen('CONFIRM', roundNo)) {
      for (const o of createdPrimary) {
        const confirmed = await this.autoConfirmIfSingle(o.studentId, roundNo);
        if (confirmed) autoConfirmed.push(o.studentId);
      }
    }

    await this.audit.log({
      actor,
      action: 'OFFERS_PUBLISH',
      entityType: 'MENTOR',
      entityId: mentor.id,
      detail: {
        roundNo,
        primary: createdPrimary.length,
        waitlist: waitlistEff.length,
        labAdjustCandidates: candidateIds.length,
        autoConfirmed,
        skippedPlaced: finalSkipped,
        overQuota,
      },
    });

    return {
      primary: createdPrimary.length,
      waitlist: waitlistEff.length,
      labAdjustCandidates: candidateIds.length,
      autoConfirmed,
      skippedPlaced: finalSkipped,
      overQuota,
      quota: await this.getQuota(mentor.id, roundNo),
    };
  }

  /** 单 offer 立即自动确认（核心规则 5.3） */
  async autoConfirmIfSingle(studentId: string, roundNo: number, actor?: AuthUser): Promise<Offer | null> {
    return this.lock.withLock(`student:${studentId}:offer`, async () => {
      const confirmedAny = await this.prisma.offer.findFirst({
        where: { studentId, status: 'CONFIRMED' },
      });
      if (confirmedAny) return null;
      const pending = await this.prisma.offer.findMany({
        where: { studentId, roundNo, status: 'PENDING', kind: { not: 'WAITLIST' } },
      });
      if (pending.length !== 1) return null;
      const now = await this.time.getNow();
      return this.confirmInternal(pending[0], 'AUTO', actor, now);
    });
  }

  /** 学生/管理员确认；CAS + 唯一约束 + 锁三重防并发 */
  async confirmOffer(studentId: string, offerId: string, source: 'STUDENT' | 'ADMIN', actor: AuthUser) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer || offer.studentId !== studentId) throw new NotFoundException('拟录取记录不存在');
    if (offer.kind === 'WAITLIST') throw new BadRequestException('该记录为递补排队，尚未转为拟录取');
    if (offer.status === 'CONFIRMED') {
      return { ok: true, idempotent: true, offer };
    }
    if (offer.status !== 'PENDING') {
      throw new ConflictException(`该拟录取已处理（${offer.status}），无法确认`);
    }
    if (source === 'STUDENT') await this.time.assertOpen('CONFIRM', offer.roundNo);

    return this.lock.withLock(`student:${studentId}:offer`, async () => {
      const current = await this.prisma.offer.findUnique({ where: { id: offerId } });
      if (!current) throw new NotFoundException('拟录取记录不存在');
      if (current.status === 'CONFIRMED') return { ok: true, idempotent: true, offer: current };
      if (current.status !== 'PENDING') {
        throw new ConflictException(`该拟录取已处理（${current.status}），无法确认`);
      }
      const already = await this.prisma.offer.findFirst({
        where: { studentId, status: 'CONFIRMED' },
      });
      if (already) throw new ConflictException('你已确认其他去向，无法重复确认');
      const now = await this.time.getNow();
      const result = await this.confirmInternal(current, source === 'ADMIN' ? 'ADMIN' : 'STUDENT', actor, now);
      if (!result) throw new ConflictException('该拟录取已被其他操作处理，请刷新');
      return { ok: true, idempotent: false, offer: result };
    });
  }

  /** 学生主动拒绝（触发递补） */
  async declineOffer(studentId: string, offerId: string, actor: AuthUser) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer || offer.studentId !== studentId) throw new NotFoundException('拟录取记录不存在');
    if (offer.kind === 'WAITLIST') throw new BadRequestException('递补排队记录不能拒绝');
    if (offer.status !== 'PENDING') throw new ConflictException(`该拟录取已处理（${offer.status}）`);
    await this.time.assertOpen('CONFIRM', offer.roundNo);

    const ok = await this.lock.withLock(`student:${studentId}:offer`, async () => {
      const now = await this.time.getNow();
      const res = await this.prisma.offer.updateMany({
        where: { id: offerId, studentId, status: 'PENDING' },
        data: { status: 'DECLINED', decidedAt: now, note: 'STUDENT_DECLINED' },
      });
      if (res.count === 0) return null;
      await this.prisma.confirmation.upsert({
        where: { offerId },
        create: { offerId, studentId, decision: 'DECLINE', source: 'STUDENT', decidedAt: now, note: '' },
        update: { decision: 'DECLINE', source: 'STUDENT', decidedAt: now },
      });
      await this.audit.log({
        actor,
        action: 'OFFER_DECLINED',
        entityType: 'OFFER',
        entityId: offerId,
        detail: { roundNo: offer.roundNo, mentorId: offer.mentorId },
      });
      return offer;
    });

    if (ok) {
      await this.promoteWaitlist(offer.mentorId, offer.roundNo);
      await this.autoConfirmIfSingle(studentId, offer.roundNo);
    }
    return { ok: true };
  }

  /** 递补：确认窗内释放名额后按顺位补录，并执行单 offer 自动确认 */
  async promoteWaitlist(mentorId: string, roundNo: number, actor?: AuthUser): Promise<Offer | null> {
    if (!(await this.time.isOpen('CONFIRM', roundNo))) return null;
    return this.lock.withLock(`mentor:${mentorId}:waitlist`, async () => {
      for (let guard = 0; guard < 10; guard += 1) {
        const quota = await this.getQuota(mentorId, roundNo);
        if (quota.free <= 0) return null;
        const next = await this.prisma.offer.findFirst({
          where: { mentorId, roundNo, kind: 'WAITLIST', status: 'PENDING' },
          orderBy: { rank: 'asc' },
        });
        if (!next) return null;
        const placed = await this.prisma.offer.findFirst({
          where: { studentId: next.studentId, status: 'CONFIRMED' },
        });
        if (placed) {
          await this.prisma.offer.update({
            where: { id: next.id },
            data: { status: 'CANCELLED', note: 'ALREADY_PLACED' },
          });
          continue;
        }
        const confirmWin = await this.time.roundConfirmWindow(roundNo);
        const res = await this.prisma.offer.updateMany({
          where: { id: next.id, status: 'PENDING' },
          data: {
            kind: 'PRIMARY',
            status: 'PENDING',
            expiresAt: confirmWin.endsAt,
            note: 'WAITLIST_PROMOTED',
          },
        });
        if (res.count === 0) continue;
        await this.audit.log({
          actor,
          action: 'WAITLIST_PROMOTED',
          entityType: 'OFFER',
          entityId: next.id,
          detail: { roundNo, mentorId, studentId: next.studentId, rank: next.rank },
        });
        await this.autoConfirmIfSingle(next.studentId, roundNo);
        return this.prisma.offer.findUnique({ where: { id: next.id } });
      }
      return null;
    });
  }

  /** 定时任务：逾期未确认 → EXPIRED → 触发递补 */
  async expireDueOffers(): Promise<number> {
    const now = await this.time.getNow();
    const due = await this.prisma.offer.findMany({
      where: {
        status: 'PENDING',
        kind: { not: 'WAITLIST' },
        expiresAt: { lte: now },
      },
    });
    let expired = 0;
    for (const offer of due) {
      const changed = await this.lock.withLock(`student:${offer.studentId}:offer`, async () => {
        const res = await this.prisma.offer.updateMany({
          where: { id: offer.id, status: 'PENDING' },
          data: { status: 'EXPIRED', decidedAt: now, note: 'CONFIRM_TIMEOUT' },
        });
        if (res.count === 0) return false;
        await this.prisma.confirmation.upsert({
          where: { offerId: offer.id },
          create: {
            offerId: offer.id,
            studentId: offer.studentId,
            decision: 'EXPIRE',
            source: 'SYSTEM',
            decidedAt: now,
            note: '确认窗内未确认，视为放弃',
          },
          update: { decision: 'EXPIRE', source: 'SYSTEM', decidedAt: now, note: '确认窗内未确认，视为放弃' },
        });
        await this.audit.log({
          action: 'OFFER_EXPIRED',
          entityType: 'OFFER',
          entityId: offer.id,
          detail: { roundNo: offer.roundNo, mentorId: offer.mentorId, studentId: offer.studentId },
        });
        return true;
      });
      if (changed) {
        expired += 1;
        await this.promoteWaitlist(offer.mentorId, offer.roundNo);
      }
    }
    return expired;
  }

  /** 确认窗开启后扫描：恰好 1 个 pending 的学生立即自动确认 */
  async sweepAutoConfirm(roundNo?: number): Promise<number> {
    const rounds = roundNo ? [roundNo] : [1, 2, 3];
    let count = 0;
    for (const r of rounds) {
      if (!(await this.time.isOpen('CONFIRM', r))) continue;
      const pending = await this.prisma.offer.findMany({
        where: { roundNo: r, status: 'PENDING', kind: { not: 'WAITLIST' } },
      });
      const groups = new Map<string, Offer[]>();
      for (const o of pending) {
        const list = groups.get(o.studentId) || [];
        list.push(o);
        groups.set(o.studentId, list);
      }
      for (const [studentId, list] of groups.entries()) {
        if (list.length !== 1) continue;
        const done = await this.autoConfirmIfSingle(studentId, r);
        if (done) count += 1;
      }
    }
    return count;
  }

  /** 名额对账：写快照 + 异常（差异不静默） */
  async reconcile(roundNo = 0, actor?: AuthUser) {
    const [mentors, offers, withdrawals, confirmations, unresolved] = await Promise.all([
      this.prisma.mentor.findMany({ where: { active: true } }),
      this.prisma.offer.findMany(),
      this.prisma.withdrawal.findMany(),
      this.prisma.confirmation.findMany(),
      this.prisma.anomaly.findMany({ where: { resolved: false } }),
    ]);
    const now = await this.time.getNow();
    const confirmationSet = new Set(confirmations.map((c) => c.offerId));
    const offerMap = new Map(offers.map((o) => [o.id, o]));
    const openKeys = new Set(unresolved.map((a) => `${a.type}|${a.entityType}|${a.entityId}`));
    const created: Array<{ type: string; entityId: string }> = [];
    const flag = async (
      type: string,
      entityType: string,
      entityId: string,
      detail: unknown,
      rn = 0,
    ) => {
      const key = `${type}|${entityType}|${entityId}`;
      if (openKeys.has(key)) return;
      openKeys.add(key);
      await this.prisma.anomaly.create({
        data: {
          roundNo: rn,
          type,
          entityType,
          entityId,
          detail: JSON.stringify(detail),
        },
      });
      created.push({ type, entityId });
    };

    for (const m of mentors) {
      const confirmed = offers.filter((o) => o.mentorId === m.id && o.status === 'CONFIRMED').length;
      const pending = offers.filter(
        (o) => o.mentorId === m.id && o.status === 'PENDING' && o.kind !== 'WAITLIST',
      ).length;
      const released = withdrawals.filter((w) => w.mentorId === m.id).length;
      const overRatio = m.quota > 0 && confirmed > m.quota ? Number((confirmed / m.quota - 1).toFixed(3)) : 0;
      await this.prisma.quotaSnapshot.upsert({
        where: { roundNo_mentorId: { roundNo, mentorId: m.id } },
        create: {
          roundNo,
          mentorId: m.id,
          quota: m.quota,
          confirmedCount: confirmed,
          pendingCount: pending,
          releasedCount: released,
          overRatio,
          note: `对账时间 ${now.toISOString()}`,
        },
        update: {
          quota: m.quota,
          confirmedCount: confirmed,
          pendingCount: pending,
          releasedCount: released,
          overRatio,
          note: `对账时间 ${now.toISOString()}`,
          createdAt: now,
        },
      });
      if (confirmed + pending > m.quota) {
        await flag('OVER_QUOTA', 'MENTOR', m.id, { quota: m.quota, confirmed, pending, overRatio }, roundNo);
      }
    }

    for (const o of offers) {
      if (o.status === 'CONFIRMED' && !confirmationSet.has(o.id)) {
        await flag('MISSING_CONFIRMATION', 'OFFER', o.id, { roundNo: o.roundNo, studentId: o.studentId }, o.roundNo);
      }
      if (o.status === 'PENDING' && o.kind !== 'WAITLIST' && o.expiresAt && o.expiresAt < now) {
        await flag('DANGLING_PENDING', 'OFFER', o.id, { expiresAt: o.expiresAt, roundNo: o.roundNo }, o.roundNo);
      }
    }

    const confirmedGroups = new Map<string, number>();
    for (const o of offers) {
      if (o.status !== 'CONFIRMED') continue;
      const key = `${o.studentId}|${o.roundNo}`;
      confirmedGroups.set(key, (confirmedGroups.get(key) || 0) + 1);
    }
    for (const [key, count] of confirmedGroups.entries()) {
      if (count > 1) {
        const [studentId, rn] = key.split('|');
        await flag('DOUBLE_BOOKED', 'STUDENT', studentId, { roundNo: Number(rn), count }, Number(rn));
      }
    }

    for (const w of withdrawals) {
      const offer = offerMap.get(w.offerId);
      if (!offer || offer.status !== 'WITHDRAWN') {
        await flag('WITHDRAW_MISMATCH', 'OFFER', w.offerId, { withdrawalId: w.id, offerStatus: offer?.status }, 0);
      }
    }

    await this.audit.log({
      actor,
      action: 'QUOTA_RECONCILE',
      entityType: 'ROUND',
      entityId: String(roundNo),
      detail: { roundNo, mentors: mentors.length, anomaliesCreated: created.length, anomalies: created },
    });

    return {
      roundNo,
      snapshotCount: mentors.length,
      anomaliesCreated: created.length,
      anomalies: created,
      reconciledAt: now,
    };
  }

  private async confirmInternal(
    offer: Offer,
    source: 'STUDENT' | 'AUTO' | 'SYSTEM' | 'ADMIN',
    actor: AuthUser | undefined,
    now: Date,
  ): Promise<Offer | null> {
    const res = await this.prisma.offer.updateMany({
      where: { id: offer.id, status: 'PENDING' },
      data: {
        status: 'CONFIRMED',
        decidedAt: now,
        autoConfirmed: source === 'AUTO' ? true : offer.autoConfirmed,
      },
    });
    if (res.count === 0) return null;

    await this.prisma.confirmation.upsert({
      where: { offerId: offer.id },
      create: {
        offerId: offer.id,
        studentId: offer.studentId,
        decision: 'CONFIRM',
        source,
        decidedAt: now,
        note: source === 'AUTO' ? '仅收到 1 个拟录取，系统立即自动确认' : '',
      },
      update: {
        decision: 'CONFIRM',
        source,
        decidedAt: now,
        note: source === 'AUTO' ? '仅收到 1 个拟录取，系统立即自动确认' : '',
      },
    });

    const voided = await this.prisma.offer.updateMany({
      where: {
        studentId: offer.studentId,
        roundNo: offer.roundNo,
        status: 'PENDING',
        kind: { not: 'WAITLIST' },
        id: { not: offer.id },
      },
      data: { status: 'VOID', note: 'STUDENT_CONFIRMED_ELSEWHERE', decidedAt: now },
    });
    await this.prisma.offer.updateMany({
      where: { studentId: offer.studentId, status: 'PENDING', kind: 'WAITLIST' },
      data: { status: 'CANCELLED', note: 'STUDENT_CONFIRMED', decidedAt: now },
    });

    await this.audit.log({
      actor,
      action: source === 'AUTO' ? 'OFFER_AUTO_CONFIRMED' : 'OFFER_CONFIRMED',
      entityType: 'OFFER',
      entityId: offer.id,
      detail: {
        studentId: offer.studentId,
        mentorId: offer.mentorId,
        roundNo: offer.roundNo,
        source,
        voidedOthers: voided.count,
        quotaLocked: true,
      },
    });

    return this.prisma.offer.findUnique({ where: { id: offer.id } });
  }
}
