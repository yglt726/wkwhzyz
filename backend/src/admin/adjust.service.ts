import { BadRequestException, Injectable } from '@nestjs/common';
import { Application, Interview, Mentor } from '@prisma/client';
import { AuditService } from '../common/services/audit.service';
import { LockService } from '../common/services/lock.service';
import { TimeService } from '../common/services/time.service';
import { AuthUser } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdjustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: TimeService,
    private readonly lock: LockService,
    private readonly audit: AuditService,
  ) {}

  async run(level: number, actor: AuthUser) {
    await this.time.assertOpen('ADJUST', 0);
    if (![1, 2, 3].includes(level)) throw new BadRequestException('调剂优先级只能是 1 / 2 / 3');
    const now = await this.time.getNow();

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

    const interviewFor = (studentId: string, labId?: string): Interview | undefined => {
      const list = interviews.filter((i) => i.studentId === studentId && (!labId || i.labId === labId));
      return list.sort((a, b) => (b.total ?? 0) - (a.total ?? 0))[0];
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
      // 导师提交的室内调剂顺位（同室多导师时取该学生在本室的最小顺位），未列出者按自动顺序排在后面
      const savedCandidates = await this.prisma.labAdjustCandidate.findMany({
        orderBy: [{ rank: 'asc' }],
      });
      for (const lab of labs) {
        const labSavedRank = new Map<string, number>();
        for (const row of savedCandidates) {
          if (row.labId !== lab.id) continue;
          const app = latestApp.get(row.studentId);
          if (!app || app.roundNo !== row.roundNo) continue;
          const prev = labSavedRank.get(row.studentId);
          if (prev === undefined || row.rank < prev) labSavedRank.set(row.studentId, row.rank);
        }
        const labMentors = mentors.filter((m) => m.labId === lab.id);
        const candidates = students
          .filter((s) => {
            if (placed.has(s.id)) return false;
            const app = latestApp.get(s.id);
            if (!app || !app.acceptLabAdjust) return false;
            return (latestIntents.get(s.id) ?? []).some((i) => i.labId === lab.id);
          })
          .sort((a, b) => {
            const ra = labSavedRank.get(a.id);
            const rb = labSavedRank.get(b.id);
            if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
            if (ra !== undefined && rb === undefined) return -1;
            if (ra === undefined && rb !== undefined) return 1;
            const sa = interviewFor(a.id, lab.id)?.total ?? -1;
            const sb = interviewFor(b.id, lab.id)?.total ?? -1;
            if (sb !== sa) return sb - sa;
            return (latestApp.get(a.id)?.submittedAt.getTime() ?? 0) - (latestApp.get(b.id)?.submittedAt.getTime() ?? 0);
          });

        for (const candidate of candidates) {
          if (placed.has(candidate.id)) continue;
          const preferred = (latestIntents.get(candidate.id) ?? []).find((i) => i.labId === lab.id);
          const freeMentors = labMentors.filter((m) => (capacity.get(m.id) ?? 0) > 0);
          if (freeMentors.length === 0) continue;
          const target =
            freeMentors.find((m) => m.id === preferred?.mentorId) ||
            freeMentors.sort((a, b) => (capacity.get(b.id) ?? 0) - (capacity.get(a.id) ?? 0))[0];
          await assign(candidate.id, target, 1);
        }
      }
    } else if (level === 2) {
      const candidates = students
        .filter((s) => {
          if (placed.has(s.id)) return false;
          const app = latestApp.get(s.id);
          return Boolean(app && app.acceptCollegeAdjust);
        })
        .sort((a, b) => {
          const sa = interviewFor(a.id)?.total ?? -1;
          const sb = interviewFor(b.id)?.total ?? -1;
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
