import { Injectable } from '@nestjs/common';
import { CacheService } from '../common/services/cache.service';
import { TimeService } from '../common/services/time.service';
import { STAGE_LABELS } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MetaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: TimeService,
    private readonly cache: CacheService,
  ) {}

  async bootstrap(roundNoInput?: number) {
    const stage = await this.time.stageSnapshot();
    const roundNo = roundNoInput || stage.currentRound;
    const [labs, weights, maxIntents] = await Promise.all([
      this.labsWithPopularity(roundNo),
      this.getWeights(),
      this.getMaxIntents(),
    ]);
    return {
      stage,
      serverNow: new Date(),
      currentRound: stage.currentRound,
      roundNo,
      labs,
      interviewWeights: weights,
      maxIntents,
      stageLabels: STAGE_LABELS,
    };
  }

  async labsWithPopularity(roundNo: number) {
    const cacheKey = `labs:${roundNo}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const [labs, mentors, intents, offers] = await Promise.all([
      this.prisma.lab.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.mentor.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.intent.findMany({ where: { roundNo }, select: { labId: true, mentorId: true, studentId: true } }),
      this.prisma.offer.findMany({
        where: { status: { in: ['CONFIRMED', 'PENDING'] }, kind: { not: 'WAITLIST' } },
        select: { mentorId: true, status: true },
      }),
    ]);

    const labStudents = new Map<string, Set<string>>();
    const mentorStudents = new Map<string, Set<string>>();
    for (const i of intents) {
      if (!labStudents.has(i.labId)) labStudents.set(i.labId, new Set());
      labStudents.get(i.labId)!.add(i.studentId);
      if (!mentorStudents.has(i.mentorId)) mentorStudents.set(i.mentorId, new Set());
      mentorStudents.get(i.mentorId)!.add(i.studentId);
    }
    const mentorConfirmed = new Map<string, number>();
    const mentorPending = new Map<string, number>();
    for (const o of offers) {
      const map = o.status === 'CONFIRMED' ? mentorConfirmed : mentorPending;
      map.set(o.mentorId, (map.get(o.mentorId) || 0) + 1);
    }

    const result = labs.map((lab) => {
      const labMentors = mentors
        .filter((m) => m.labId === lab.id)
        .map((m) => {
          const confirmed = mentorConfirmed.get(m.id) || 0;
          const pending = mentorPending.get(m.id) || 0;
          return {
            id: m.id,
            name: m.name,
            title: m.title,
            intro: m.intro,
            quota: m.quota,
            confirmed,
            pending,
            remaining: Math.max(0, m.quota - confirmed - pending),
            applicantCount: mentorStudents.get(m.id)?.size || 0,
          };
        });
      return {
        id: lab.id,
        code: lab.code,
        name: lab.name,
        intro: lab.intro,
        applicantCount: labStudents.get(lab.id)?.size || 0,
        quota: labMentors.reduce((s, m) => s + m.quota, 0),
        mentors: labMentors,
      };
    });
    await this.cache.set(cacheKey, result, 3000);
    return result;
  }

  async getWeights(): Promise<{ attitude: number; logic: number; coding: number; timeInvest: number }> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'INTERVIEW_WEIGHTS' } });
    try {
      const parsed = cfg?.value ? JSON.parse(cfg.value) : null;
      if (parsed) return parsed;
    } catch {
      // ignore
    }
    return { attitude: 30, logic: 25, coding: 30, timeInvest: 15 };
  }

  async getMaxIntents(): Promise<number> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'MAX_INTENTS_PER_ROUND' } });
    return cfg ? Number(cfg.value) || 3 : 3;
  }

  async labsSimple() {
    return this.prisma.lab.findMany({ orderBy: { code: 'asc' } });
  }
}
