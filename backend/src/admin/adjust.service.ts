import { BadRequestException, Injectable } from '@nestjs/common';
import { Application, Mentor } from '@prisma/client';
import { AuditService } from '../common/services/audit.service';
import { LockService } from '../common/services/lock.service';
import { TimeService } from '../common/services/time.service';
import { AuthUser } from '../common/types';
import { OfferService } from '../offers/offer.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdjustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: TimeService,
    private readonly lock: LockService,
    private readonly audit: AuditService,
    private readonly offers: OfferService,
  ) {}

  async run(level: number, actor: AuthUser) {
    await this.time.assertOpen('ADJUST', 0);
    if (![1, 2, 3].includes(level)) throw new BadRequestException('调剂优先级只能是 1 / 2 / 3');
    const now = await this.time.getNow();

    // 先结算已过确认窗的待确认 offer，否则过期占位会让容量判断偏小
    await this.offers.expireDueOffers();

    const [students, apps, intents, interviews, mentors, labs, offers] = await Promise.all([
      this.prisma.user.findMany({ where: { role: 'STUDENT', active: true } }),
      this.prisma.application.findMany({ orderBy: { roundNo: 'desc' } }),
      this.prisma.intent.findMany(),
      this.prisma.interview.findMany({ where: { status: 'SCORED' } }),
      this.prisma.mentor.findMany({ where: { active: true }, orderBy: [{ labId: 'asc' }, { sortOrder: 'asc' }] }),
      this.prisma.lab.findMany(),
      this.prisma.offer.findMany(),
    ]);

    const labMap = new Map(labs.map((l) => [l.id, l]));
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const latestApp = new Map<string, Application>();
    for (const a of apps) if (!latestApp.has(a.studentId)) latestApp.set(a.studentId, a);

    const latestIntents = new Map<string, typeof intents>();
    for (const [studentId, app] of latestApp.entries()) {
      latestIntents.set(
        studentId,
        intents.filter((i) => i.studentId === studentId && i.roundNo === app.roundNo),
      );
    }

    // 每位导师独立评分，按 (轮次, 学生, 导师) 取分，避免误用往轮成绩
    const scoreByMentor = new Map<string, number>();
    for (const i of interviews) {
      if (i.total == null) continue;
      scoreByMentor.set(`${i.roundNo}:${i.studentId}:${i.mentorId}`, i.total);
    }
    const scoreOf = (roundNo: number, studentId: string, mentorId: string): number | undefined =>
      scoreByMentor.get(`${roundNo}:${studentId}:${mentorId}`);

    // 学生在最近一轮的最高面试分（只统计其本轮填报的导师）
    const bestScore = (studentId: string): number => {
      const app = latestApp.get(studentId);
      if (!app) return -1;
      let best = -1;
      for (const intent of latestIntents.get(studentId) ?? []) {
        const score = scoreOf(app.roundNo, studentId, intent.mentorId);
        if (score != null && score > best) best = score;
      }
      return best;
    };

    const placed = new Set(offers.filter((o) => o.status === 'CONFIRMED').map((o) => o.studentId));
    const capacity = new Map<string, number>();
    for (const m of mentors) {
      const used = offers.filter(
        (o) => o.mentorId === m.id && (o.status === 'CONFIRMED' || (o.status === 'PENDING' && o.kind !== 'WAITLIST')),
      ).length;
      capacity.set(m.id, Math.max(0, m.quota - used));
    }

    const assignments: Array<{
      offerId: string;
      studentId: string;
      studentName: string;
      mentorId: string;
      mentorName: string;
      labId: string;
      labName: string;
      level: number;
      roundNo: number;
    }> = [];

    const assign = async (studentId: string, mentor: Mentor, levelNo: number) => {
      return this.lock.withLock(`student:${studentId}:offer`, async () => {
        const existing = await this.prisma.offer.findFirst({
          where: { studentId, status: 'CONFIRMED' },
        });
        if (existing) return null;
        const free = capacity.get(mentor.id) ?? 0;
        if (free <= 0) return null;
        const app = latestApp.get(studentId);
        if (!app) return null;
        const kind = levelNo === 1 ? 'LAB_ADJUST' : levelNo === 2 ? 'COLLEGE_ADJUST' : 'FINAL';
        const offer = await this.prisma.offer.create({
          data: {
            roundNo: app.roundNo,
            studentId,
            mentorId: mentor.id,
            labId: mentor.labId,
            kind,
            status: 'CONFIRMED',
            priorityLevel: levelNo,
            autoConfirmed: false,
            note: `统筹调剂 L${levelNo}`,
            decidedAt: now,
          },
        });
        await this.prisma.confirmation.create({
          data: {
            offerId: offer.id,
            studentId,
            decision: 'CONFIRM',
            source: 'SYSTEM',
            decidedAt: now,
            note: `统筹调剂 L${levelNo}`,
          },
        });
        await this.prisma.offer.updateMany({
          where: { studentId, status: 'PENDING', kind: { not: 'WAITLIST' } },
          data: { status: 'VOID', note: 'ADJUSTED_ELSEWHERE', decidedAt: now },
        });
        // 递补排队记录不会占名额，但学生已被调剂后必须一并作废，否则学生端会残留“排队中”
        await this.prisma.offer.updateMany({
          where: { studentId, status: 'PENDING', kind: 'WAITLIST' },
          data: { status: 'CANCELLED', note: 'ADJUSTED_ELSEWHERE', decidedAt: now },
        });
        capacity.set(mentor.id, free - 1);
        placed.add(studentId);
        await this.audit.log({
          actor,
          action: 'ADJUST_ASSIGN',
          entityType: 'OFFER',
          entityId: offer.id,
          detail: { level: levelNo, studentId, mentorId: mentor.id, labId: mentor.labId, roundNo: app.roundNo },
        });
        assignments.push({
          offerId: offer.id,
          studentId,
          studentName: studentMap.get(studentId)?.name ?? '',
          mentorId: mentor.id,
          mentorName: mentor.name,
          labId: mentor.labId,
          labName: labMap.get(mentor.labId)?.name ?? '',
          level: levelNo,
          roundNo: app.roundNo,
        });
        return offer;
      });
    };

    if (level === 1) {
      // L1 逻辑：按“给他打分最高的导师”定向调剂，而不是按实训室顺序轮流捞人
      // 1) 最高分导师仍有名额 → 直接去该导师
      // 2) 最高分导师已满 → 看该导师所在实训室里、学生本轮也报过且有剩余名额的导师
      // 3) 仍无去处 → 留给 L2 学院统筹
      const savedCandidates = await this.prisma.labAdjustCandidate.findMany({
        orderBy: [{ rank: 'asc' }],
      });
      const savedRank = new Map<string, number>();
      for (const row of savedCandidates) {
        const app = latestApp.get(row.studentId);
        if (!app || app.roundNo !== row.roundNo) continue;
        const prev = savedRank.get(row.studentId);
        if (prev === undefined || row.rank < prev) savedRank.set(row.studentId, row.rank);
      }
      const mentorMap = new Map(mentors.map((m) => [m.id, m]));

      const candidates = students
        .filter((s) => {
          if (placed.has(s.id)) return false;
          const app = latestApp.get(s.id);
          if (!app || !app.acceptLabAdjust) return false;
          // 至少有一位填报导师给出了面试成绩，才参与 L1
          return (latestIntents.get(s.id) ?? []).some(
            (i) => scoreOf(app.roundNo, s.id, i.mentorId) != null,
          );
        })
        .sort((a, b) => {
          // 高分学生优先挑去处；同分时参考导师提交的室内顺位，再按填报时间
          const sa = bestScore(a.id);
          const sb = bestScore(b.id);
          if (sb !== sa) return sb - sa;
          const ra = savedRank.get(a.id);
          const rb = savedRank.get(b.id);
          if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
          if (ra !== undefined && rb === undefined) return -1;
          if (ra === undefined && rb !== undefined) return 1;
          return (latestApp.get(a.id)?.submittedAt.getTime() ?? 0) - (latestApp.get(b.id)?.submittedAt.getTime() ?? 0);
        });

      for (const candidate of candidates) {
        if (placed.has(candidate.id)) continue;
        const app = latestApp.get(candidate.id);
        if (!app) continue;

        // 学生本轮填报的导师按“该导师给他的分”降序，未打分排最后，同分按填报先后
        const rankedIntents = [...(latestIntents.get(candidate.id) ?? [])].sort((x, y) => {
          const sx = scoreOf(app.roundNo, candidate.id, x.mentorId) ?? -1;
          const sy = scoreOf(app.roundNo, candidate.id, y.mentorId) ?? -1;
          if (sy !== sx) return sy - sx;
          return x.createdAt.getTime() - y.createdAt.getTime();
        });
        if (rankedIntents.length === 0) continue;

        const topMentor = mentorMap.get(rankedIntents[0].mentorId);
        if (!topMentor) continue;

        if ((capacity.get(topMentor.id) ?? 0) > 0) {
          await assign(candidate.id, topMentor, 1);
          continue;
        }

        // 最高分导师已满：在本实训室内找学生也报过、且还有名额的导师（按分数高者优先）
        let fallback: Mentor | undefined;
        for (const intent of rankedIntents) {
          if (intent.mentorId === topMentor.id) continue;
          const m = mentorMap.get(intent.mentorId);
          if (!m || m.labId !== topMentor.labId) continue;
          if ((capacity.get(m.id) ?? 0) > 0) {
            fallback = m;
            break;
          }
        }
        if (fallback) {
          await assign(candidate.id, fallback, 1);
          continue;
        }
        // 室内也没有可去的导师，保持未录取，交给 L2 学院统筹
      }
    } else if (level === 2) {
      const candidates = students
        .filter((s) => {
          if (placed.has(s.id)) return false;
          const app = latestApp.get(s.id);
          return Boolean(app && app.acceptCollegeAdjust);
        })
        .sort((a, b) => {
          const sa = bestScore(a.id);
          const sb = bestScore(b.id);
          if (sb !== sa) return sb - sa;
          return (latestApp.get(a.id)?.submittedAt.getTime() ?? 0) - (latestApp.get(b.id)?.submittedAt.getTime() ?? 0);
        });

      for (const candidate of candidates) {
        if (placed.has(candidate.id)) continue;
        const appliedLabs = new Set((latestIntents.get(candidate.id) ?? []).map((i) => i.labId));
        const freeMentors = mentors.filter((m) => (capacity.get(m.id) ?? 0) > 0);
        if (freeMentors.length === 0) break;
        const crossLab = freeMentors.filter((m) => !appliedLabs.has(m.labId));
        const pool = crossLab.length ? crossLab : freeMentors;
        const target = pool.sort((a, b) => (capacity.get(b.id) ?? 0) - (capacity.get(a.id) ?? 0))[0];
        await assign(candidate.id, target, 2);
      }
    } else {
      const candidates = students
        .filter((s) => !placed.has(s.id) && latestApp.has(s.id))
        .sort((a, b) => {
          const sa = latestApp.get(a.id)?.submittedAt.getTime() ?? 0;
          const sb = latestApp.get(b.id)?.submittedAt.getTime() ?? 0;
          return sa - sb;
        });
      for (const candidate of candidates) {
        if (placed.has(candidate.id)) continue;
        const freeMentors = mentors.filter((m) => (capacity.get(m.id) ?? 0) > 0);
        if (freeMentors.length === 0) break;
        const target = freeMentors.sort((a, b) => (capacity.get(b.id) ?? 0) - (capacity.get(a.id) ?? 0))[0];
        await assign(candidate.id, target, 3);
      }
    }

    await this.audit.log({
      actor,
      action: 'ADJUST_RUN',
      entityType: 'ROUND',
      entityId: '0',
      detail: { level, assigned: assignments.length },
    });

    return {
      level,
      assigned: assignments.length,
      assignments,
      remainingFree: Array.from(capacity.values()).reduce((s, n) => s + Math.max(0, n), 0),
      unplacedAfter: students.length - placed.size,
      runAt: now,
    };
  }
}
