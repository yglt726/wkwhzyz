import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const T = (s: string) => new Date(s);

async function main() {
  // 清空并按依赖顺序重建（演练库专用）
  await prisma.confirmation.deleteMany();
  await prisma.withdrawal.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.interview.deleteMany();
  await prisma.intent.deleteMany();
  await prisma.application.deleteMany();
  await prisma.quotaSnapshot.deleteMany();
  await prisma.anomaly.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.mentor.deleteMany();
  await prisma.lab.deleteMany();
  await prisma.stageWindow.deleteMany();
  await prisma.round.deleteMany();
  await prisma.systemConfig.deleteMany();

  const labs = [
    { id: 'lab-ai', code: 'AI-LAB', name: '人工智能应用实训室', intro: '方向：机器学习工程、计算机视觉、智能体应用；每周 2 次组会 + 项目实战。' },
    { id: 'lab-data', code: 'DATA-LAB', name: '大数据与云原生实训室', intro: '方向：数据平台、实时计算、云原生后端；以真实业务数据做课程项目。' },
    { id: 'lab-sec', code: 'SEC-LAB', name: '网络与信息安全实训室', intro: '方向：渗透测试、安全运营、代码审计；参与学院攻防演练。' },
  ];
  await prisma.lab.createMany({ data: labs });

  const mentors = [
    { id: 'm-ai-zhang', labId: 'lab-ai', name: '张启明', title: '教授', quota: 3, intro: '机器学习工程与视觉方向，偏好能长期投入的同学。', sortOrder: 1 },
    { id: 'm-ai-li', labId: 'lab-ai', name: '李若曦', title: '讲师', quota: 2, intro: '智能体与多模态应用，重视编程基础与主动性。', sortOrder: 2 },
    { id: 'm-data-wang', labId: 'lab-data', name: '王浩然', title: '副教授', quota: 3, intro: '实时计算与数据平台，重视工程规范。', sortOrder: 1 },
    { id: 'm-data-chen', labId: 'lab-data', name: '陈思远', title: '讲师', quota: 2, intro: '云原生后端与可观测性，重视动手能力。', sortOrder: 2 },
    { id: 'm-sec-zhao', labId: 'lab-sec', name: '赵乾', title: '教授', quota: 2, intro: '攻防演练与安全运营，要求时间投入稳定。', sortOrder: 1 },
    { id: 'm-sec-sun', labId: 'lab-sec', name: '孙亚楠', title: '讲师', quota: 2, intro: '代码审计与漏洞挖掘，重视逻辑思维。', sortOrder: 2 },
  ];
  await prisma.mentor.createMany({ data: mentors });

  await prisma.round.createMany({
    data: [
      { roundNo: 1, name: '第一轮（集中填报）', status: 'OPEN' },
      { roundNo: 2, name: '第二轮补录', status: 'OPEN' },
      { roundNo: 3, name: '第三轮补录', status: 'OPEN' },
    ],
  });

  const windows: Array<{ stageKey: string; roundNo: number; startsAt: string; endsAt: string }> = [
    { stageKey: 'BRIEFING', roundNo: 0, startsAt: '2026-10-29T14:00:00+08:00', endsAt: '2026-10-29T15:30:00+08:00' },
    { stageKey: 'OPEN_DAY', roundNo: 0, startsAt: '2026-10-29T15:30:00+08:00', endsAt: '2026-10-30T18:00:00+08:00' },
    { stageKey: 'INTENT', roundNo: 1, startsAt: '2026-11-02T08:00:00+08:00', endsAt: '2026-11-02T12:00:00+08:00' },
    { stageKey: 'INTERVIEW', roundNo: 1, startsAt: '2026-11-02T12:00:00+08:00', endsAt: '2026-11-03T17:00:00+08:00' },
    { stageKey: 'CONFIRM', roundNo: 1, startsAt: '2026-11-04T08:00:00+08:00', endsAt: '2026-11-04T12:00:00+08:00' },
    { stageKey: 'SUPPLEMENT', roundNo: 2, startsAt: '2026-11-04T12:00:00+08:00', endsAt: '2026-11-05T17:00:00+08:00' },
    { stageKey: 'INTENT', roundNo: 2, startsAt: '2026-11-04T12:00:00+08:00', endsAt: '2026-11-04T16:00:00+08:00' },
    { stageKey: 'INTERVIEW', roundNo: 2, startsAt: '2026-11-04T16:00:00+08:00', endsAt: '2026-11-04T23:00:00+08:00' },
    { stageKey: 'CONFIRM', roundNo: 2, startsAt: '2026-11-04T23:00:00+08:00', endsAt: '2026-11-05T04:00:00+08:00' },
    { stageKey: 'INTENT', roundNo: 3, startsAt: '2026-11-05T04:00:00+08:00', endsAt: '2026-11-05T08:00:00+08:00' },
    { stageKey: 'INTERVIEW', roundNo: 3, startsAt: '2026-11-05T08:00:00+08:00', endsAt: '2026-11-05T13:00:00+08:00' },
    { stageKey: 'CONFIRM', roundNo: 3, startsAt: '2026-11-05T13:00:00+08:00', endsAt: '2026-11-05T17:00:00+08:00' },
    { stageKey: 'ADJUST', roundNo: 0, startsAt: '2026-11-06T08:00:00+08:00', endsAt: '2026-11-06T12:00:00+08:00' },
    { stageKey: 'PUBLICITY', roundNo: 0, startsAt: '2026-11-06T12:00:00+08:00', endsAt: '2026-11-07T12:00:00+08:00' },
    { stageKey: 'ENROLL', roundNo: 0, startsAt: '2026-11-07T12:00:00+08:00', endsAt: '2026-11-10T23:59:00+08:00' },
  ];
  await prisma.stageWindow.createMany({
    data: windows.map((w) => ({ stageKey: w.stageKey, roundNo: w.roundNo, startsAt: T(w.startsAt), endsAt: T(w.endsAt) })),
  });

  await prisma.systemConfig.createMany({
    data: [
      { key: 'ADJUST_PRIORITY_LEVELS', value: '1,2,3' },
      { key: 'WAITLIST_RULE', value: 'INTERVIEW_TOTAL_DESC' },
      { key: 'OVER_QUOTA_FACTOR', value: '1.0' },
      { key: 'INTERVIEW_WEIGHTS', value: '{"attitude":30,"logic":25,"coding":30,"timeInvest":15}' },
      { key: 'SIMULATED_NOW', value: '2026-11-02T08:30:00+08:00' },
      { key: 'MAX_INTENTS_PER_ROUND', value: '3' },
    ],
  });

  const adminHash = bcrypt.hashSync('admin123', 10);
  const mentorHash = bcrypt.hashSync('mentor123', 10);
  const studentHash = bcrypt.hashSync('student123', 10);

  await prisma.user.create({
    data: { username: 'admin', passwordHash: adminHash, name: '学院管理员', role: 'ADMIN' },
  });

  await prisma.user.createMany({
    data: mentors.map((m, i) => ({
      username: `mentor0${i + 1}`,
      passwordHash: mentorHash,
      name: m.name,
      role: 'MENTOR',
      mentorId: m.id,
    })),
  });

  const studentNames = ['林子涵', '周雨桐', '陈皓', '许知远', '苏晓', '何嘉', '郑一鸣', '吴桐', '沈亦舟', '方雨欣'];
  await prisma.user.createMany({
    data: studentNames.map((name, i) => ({
      username: `student${String(i + 1).padStart(2, '0')}`,
      passwordHash: studentHash,
      name,
      role: 'STUDENT',
      studentNo: `2026${String(i + 1).padStart(3, '0')}`,
    })),
  });

  console.log('种子数据完成：3 个实训室 / 6 位导师 / 10 名学生 / 15 条时间窗');
  console.log('测试账号：admin/admin123，mentor01~06/mentor123，student01~10/student123');
  console.log('默认模拟时钟：2026-11-02 08:30（第一轮意向填报窗口内）');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
