import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Mentor } from '@prisma/client';
import fs from 'fs';
import { AuditService } from '../common/services/audit.service';
import { resumeAbsolutePath } from '../common/resume';
import { TimeService } from '../common/services/time.service';
import { AuthUser, OFFER_KIND_LABELS, OFFER_STATUS_LABELS } from '../common/types';
import { MetaService } from '../meta/meta.service';
import { OfferService } from '../offers/offer.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublishOffersDto, ScoreInterviewDto } from './dto/mentor.dto';

@Injectable()
export class MentorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: TimeService,
    private readonly audit: AuditService,
    private readonly offers: OfferService,
    private readonly meta: MetaService,
  ) {}

  async getMentor(user: AuthUser): Promise<Mentor> {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser?.mentorId) throw new ForbiddenException('当前账号未绑定导师身份');
    const mentor = await this.prisma.mentor.findUnique({ where: { id: dbUser.mentorId } });
    if (!mentor) throw new NotFoundException('导师信息不存在');
    return mentor;
  }

  async applicants(user: AuthUser, roundNo: number) {
    const mentor = await this.getMentor(user);
    const [intents, students, interviews, myIntents, apps, profiles] = await Promise.all([
      this.prisma.intent.findMany({ where: { roundNo, labId: mentor.labId } }),
      this.prisma.user.findMany({ where: { role: 'STUDENT', active: true } }),
      this.prisma.interview.findMany({ where: { roundNo, labId: mentor.labId } }),
      this.prisma.intent.findMany({ where: { roundNo, mentorId: mentor.id } }),
      this.prisma.application.findMany({ where: { roundNo } }),
      this.prisma.studentProfile.findMany(),
    ]);
    const studentMap = new Map(students.map((s) => [s.id, s]));
    const interviewMap = new Map(interviews.map((i) => [i.studentId, i]));
    const mySet = new Set(myIntents.map((i) => i.studentId));
    const appMap = new Map(apps.map((a) => [a.studentId, a]));
    const profileMap = new Map(profiles.map((p) => [p.studentId, p]));

    const rows = intents.map((i) => {
      const s = studentMap.get(i.studentId);
      const iv = interviewMap.get(i.studentId);
      const app = appMap.get(i.studentId);
      const profile = profileMap.get(i.studentId);
      return {
        studentId: i.studentId,
        name: s?.name ?? '',
        studentNo: s?.studentNo ?? '',
        major: profile?.major ?? '',
        className: profile?.className ?? '',
        appliedToMe: mySet.has(i.studentId),
        intentMentorCount: intents.filter((x) => x.studentId === i.studentId).length,
        acceptLabAdjust: app?.acceptLabAdjust ?? false,
        acceptCollegeAdjust: app?.acceptCollegeAdjust ?? false,
        interview: iv
          ? {
              id: iv.id,
              status: iv.status,
              attitude: iv.attitude,
              logic: iv.logic,
              coding: iv.coding,
              timeInvest: iv.timeInvest,
              total: iv.total,
              remark: iv.remark,
              scoredAt: iv.scoredAt,
            }
          : null,
      };
    });
    const deduped = Array.from(new Map(rows.map((r) => [r.studentId, r])).values());

    return {
      roundNo,
      mentor: { id: mentor.id, name: mentor.name, labId: mentor.labId, quota: mentor.quota },
      labName: (await this.prisma.lab.findUnique({ where: { id: mentor.labId } }))?.name ?? '',
      quota: await this.offers.getQuota(mentor.id, roundNo),
      interviewWindow: await this.time.getWindow('INTERVIEW', roundNo),
      rows: deduped.sort((a, b) => (b.interview?.total ?? -1) - (a.interview?.total ?? -1)),
    };
  }

  async studentDetail(user: AuthUser, studentId: string, roundNo: number) {
    const mentor = await this.getMentor(user);
    const intent = await this.prisma.intent.findFirst({
      where: { roundNo, labId: mentor.labId, studentId },
    });
    if (!intent) throw new BadRequestException('该学生未报名本实训室');

    const [student, profile, app, intents] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: studentId } }),
      this.prisma.studentProfile.findUnique({ where: { studentId } }),
      this.prisma.application.findUnique({ where: { studentId_roundNo: { studentId, roundNo } } }),
      this.prisma.intent.findMany({ where: { roundNo, studentId } }),
    ]);
    if (!student) throw new NotFoundException('学生不存在');

    const [mentors, labs, interview] = await Promise.all([
      this.prisma.mentor.findMany({ where: { id: { in: intents.map((i) => i.mentorId) } } }),
      this.prisma.lab.findMany({ where: { id: { in: intents.map((i) => i.labId) } } }),
      this.prisma.interview.findUnique({
        where: { roundNo_studentId_labId: { roundNo, studentId, labId: mentor.labId } },
      }),
    ]);
    const mentorMap = new Map(mentors.map((m) => [m.id, m]));
    const labMap = new Map(labs.map((l) => [l.id, l]));

    return {
      roundNo,
      student: { id: student.id, name: student.name, studentNo: student.studentNo ?? '' },
      profile: profile
        ? {
            major: profile.major,
            className: profile.className,
            phone: profile.phone,
            email: profile.email,
            gpa: profile.gpa,
            rankNo: profile.rankNo,
            rankTotal: profile.rankTotal,
            intro: profile.intro,
            resume:
              profile.resumeFile && profile.resumeName
                ? { name: profile.resumeName, size: profile.resumeSize ?? 0, uploadedAt: profile.resumeUploadedAt }
                : null,
          }
        : null,
      application: app
        ? {
            acceptLabAdjust: app.acceptLabAdjust,
            acceptCollegeAdjust: app.acceptCollegeAdjust,
            status: app.status,
            submittedAt: app.submittedAt,
          }
        : null,
      intents: intents.map((i) => {
        const m = mentorMap.get(i.mentorId);
        const lab = labMap.get(i.labId);
        return {
          mentorId: i.mentorId,
          mentorName: m?.name ?? '',
          mentorTitle: m?.title ?? '',
          labName: lab?.name ?? '',
          appliedToMe: i.mentorId === mentor.id,
        };
      }),
      interview: interview
        ? {
            status: interview.status,
            attitude: interview.attitude,
            logic: interview.logic,
            coding: interview.coding,
            timeInvest: interview.timeInvest,
            total: interview.total,
            remark: interview.remark,
            scoredAt: interview.scoredAt,
          }
        : null,
    };
  }

  async studentResume(user: AuthUser, studentId: string) {
    const mentor = await this.getMentor(user);
    const intent = await this.prisma.intent.findFirst({
      where: { labId: mentor.labId, studentId },
    });
    if (!intent) throw new BadRequestException('该学生未报名本实训室');
    const profile = await this.prisma.studentProfile.findUnique({ where: { studentId } });
    if (!profile?.resumeFile) throw new NotFoundException('该学生尚未上传简历');
    const absPath = resumeAbsolutePath(profile.resumeFile);
    if (!fs.existsSync(absPath)) throw new NotFoundException('简历文件已丢失，请联系学生重新上传');
    return { absPath, name: profile.resumeName || '简历' };
  }

  async score(user: AuthUser, dto: ScoreInterviewDto) {
    const mentor = await this.getMentor(user);
    await this.time.assertOpen('INTERVIEW', dto.roundNo);
    const student = await this.prisma.user.findUnique({ where: { id: dto.studentId } });
    if (!student || student.role !== 'STUDENT') throw new NotFoundException('学生不存在');
    const intent = await this.prisma.intent.findFirst({
      where: { roundNo: dto.roundNo, labId: mentor.labId, studentId: dto.studentId },
    });
    if (!intent) throw new BadRequestException('该学生未报名本实训室');

    const weights = await this.meta.getWeights();
    let total: number | null = null;
    if (!dto.absent) {
      const attitude = dto.attitude ?? 0;
      const logic = dto.logic ?? 0;
      const coding = dto.coding ?? 0;
      const timeInvest = dto.timeInvest ?? 0;
      const weightSum = weights.attitude + weights.logic + weights.coding + weights.timeInvest || 100;
      total = Number(
        (
          (attitude * weights.attitude + logic * weights.logic + coding * weights.coding + timeInvest * weights.timeInvest) /
          weightSum
        ).toFixed(2),
      );
    }
    const now = await this.time.getNow();
    const data = {
      attitude: dto.absent ? null : dto.attitude ?? 0,
      logic: dto.absent ? null : dto.logic ?? 0,
      coding: dto.absent ? null : dto.coding ?? 0,
      timeInvest: dto.absent ? null : dto.timeInvest ?? 0,
      total: dto.absent ? null : total,
      remark: dto.remark ?? '',
      status: dto.absent ? 'ABSENT' : 'SCORED',
      scoredBy: user.sub,
      scoredAt: now,
    };
    const interview = await this.prisma.interview.upsert({
      where: {
        roundNo_studentId_labId: {
          roundNo: dto.roundNo,
          studentId: dto.studentId,
          labId: mentor.labId,
        },
      },
      create: { roundNo: dto.roundNo, studentId: dto.studentId, labId: mentor.labId, ...data },
      update: data,
    });
    await this.audit.log({
      actor: user,
      action: 'INTERVIEW_SCORE',
      entityType: 'INTERVIEW',
      entityId: interview.id,
      detail: { roundNo: dto.roundNo, studentId: dto.studentId, total, absent: Boolean(dto.absent) },
    });
    return { ok: true, interview };
  }

  async quota(user: AuthUser, roundNo: number) {
    const mentor = await this.getMentor(user);
    const lab = await this.prisma.lab.findUnique({ where: { id: mentor.labId } });
    return {
      labName: lab?.name ?? '',
      ...(await this.offers.getQuota(mentor.id, roundNo)),
    };
  }

  async getOffers(user: AuthUser, roundNo: number) {
    const mentor = await this.getMentor(user);
    const offers = await this.prisma.offer.findMany({
      where: { mentorId: mentor.id, roundNo },
      orderBy: [{ kind: 'asc' }, { rank: 'asc' }, { createdAt: 'asc' }],
    });
    const students = await this.prisma.user.findMany({
      where: { id: { in: offers.map((o) => o.studentId) } },
    });
    const studentMap = new Map(students.map((s) => [s.id, s]));
    return {
      roundNo,
      mentorId: mentor.id,
      quota: await this.offers.getQuota(mentor.id, roundNo),
      labAdjustCandidates: await this.offers.labAdjustCandidateView(mentor.id, mentor.labId, roundNo),
      offers: offers.map((o) => ({
        id: o.id,
        studentId: o.studentId,
        studentName: studentMap.get(o.studentId)?.name ?? '',
        studentNo: studentMap.get(o.studentId)?.studentNo ?? '',
        kind: o.kind,
        kindLabel: OFFER_KIND_LABELS[o.kind] ?? o.kind,
        rank: o.rank,
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

  async publish(user: AuthUser, dto: PublishOffersDto) {
    const mentor = await this.getMentor(user);
    await this.time.assertOpen('INTERVIEW', dto.roundNo);

    // 规则：本室所有报名学生必须完成面试（已评分或缺考登记）
    const labIntents = await this.prisma.intent.findMany({
      where: { roundNo: dto.roundNo, labId: mentor.labId },
    });
    const interviews = await this.prisma.interview.findMany({
      where: { roundNo: dto.roundNo, labId: mentor.labId },
    });
    const scoredSet = new Set(
      interviews.filter((i) => i.status === 'SCORED' || i.status === 'ABSENT').map((i) => i.studentId),
    );
    const missing = Array.from(new Set(labIntents.map((i) => i.studentId))).filter((id) => !scoredSet.has(id));
    if (missing.length > 0) {
      const students = await this.prisma.user.findMany({ where: { id: { in: missing } } });
      throw new BadRequestException(
        `本实训室还有 ${missing.length} 名报名学生未完成面试评分（${students.map((s) => s.name).join('、')}），请先完成评分或登记缺考`,
      );
    }

    return this.offers.publishForMentor({
      mentor,
      roundNo: dto.roundNo,
      primary: dto.primary || [],
      waitlist: dto.waitlist || [],
      labAdjustCandidates: dto.labAdjustCandidates,
      overQuotaConfirm: Boolean(dto.overQuotaConfirm),
      actor: user,
    });
  }
}
