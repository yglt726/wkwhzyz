export type UserRole = 'STUDENT' | 'MENTOR' | 'ADMIN' | 'SYSTEM';

export interface AuthUser {
  sub: string;
  username: string;
  name: string;
  role: UserRole;
  mentorId?: string | null;
}

export const STAGE_LABELS: Record<string, string> = {
  BRIEFING: '集中宣讲',
  OPEN_DAY: '实训室开放日',
  INTENT: '意向填报',
  INTERVIEW: '导师面试考核',
  CONFIRM: '拟录取与学生确认',
  SUPPLEMENT: '分轮补录',
  ADJUST: '统筹调剂录取',
  PUBLICITY: '结果公示',
  ENROLL: '正式入组',
};

export const OFFER_KIND_LABELS: Record<string, string> = {
  PRIMARY: '拟录取',
  WAITLIST: '递补',
  LAB_ADJUST: '室内调剂',
  COLLEGE_ADJUST: '全院调剂',
  FINAL: '最终统筹',
};

export const OFFER_STATUS_LABELS: Record<string, string> = {
  PENDING: '待确认',
  CONFIRMED: '已确认',
  DECLINED: '已拒绝',
  EXPIRED: '已逾期',
  VOID: '已失效',
  WITHDRAWN: '已放弃',
  PROMOTED: '已递补',
  CANCELLED: '已取消',
  ACTIVE: '排队中',
};
