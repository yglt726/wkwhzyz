-- =============================================================================
-- 学生实训室进组选拔系统 · PostgreSQL 生产库 DDL
-- PostgreSQL 14+ ；包含枚举、索引、唯一约束、外键与初始化种子数据
-- 与 backend/prisma/schema.prisma（SQLite 本地演练库）字段一一对应
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 状态枚举以 PostgreSQL DOMAIN（text + CHECK）实现：
-- 既保留数据库层枚举校验，又兼容 Prisma 的 String 字段映射（可直接被 NestJS 读写）
CREATE DOMAIN user_role AS text CHECK (VALUE IN ('STUDENT', 'MENTOR', 'ADMIN', 'SYSTEM'));
CREATE DOMAIN application_status AS text CHECK (VALUE IN ('SUBMITTED', 'INTERVIEWING', 'CLOSED', 'CANCELLED'));
CREATE DOMAIN interview_status AS text CHECK (VALUE IN ('PENDING', 'SCORED', 'ABSENT'));
CREATE DOMAIN offer_kind AS text CHECK (VALUE IN ('PRIMARY', 'WAITLIST', 'LAB_ADJUST', 'COLLEGE_ADJUST', 'FINAL'));
CREATE DOMAIN offer_status AS text CHECK (VALUE IN (
  'PENDING',      -- 拟录取/调剂待确认；WAITLIST 排队中
  'CONFIRMED',    -- 已确认占用名额
  'DECLINED',     -- 学生主动拒绝
  'EXPIRED',      -- 逾期未确认 / 递补队列关闭
  'VOID',         -- 被其他 offer 抢占而失效
  'WITHDRAWN',    -- 确认后放鸽子（放鸽子记录见 withdrawals）
  'PROMOTED',     -- 递补名单已转为拟录取
  'CANCELLED'     -- 管理员取消
));
CREATE DOMAIN confirmation_decision AS text CHECK (VALUE IN ('CONFIRM', 'DECLINE', 'EXPIRE', 'WITHDRAW'));
CREATE DOMAIN confirmation_source AS text CHECK (VALUE IN ('STUDENT', 'AUTO', 'SYSTEM', 'ADMIN'));
CREATE DOMAIN withdraw_reason AS text CHECK (VALUE IN (
  'CONFIRM_ABANDON',    -- 确认后放弃
  'PUBLICITY_ABANDON',  -- 公示后放弃
  'NO_SHOW',            -- 入组未报到
  'ADMIN_RELEASE'       -- 管理员人工释放
));
CREATE DOMAIN stage_key AS text CHECK (VALUE IN (
  'BRIEFING',   -- 1 集中宣讲
  'OPEN_DAY',   -- 2 实训室开放日
  'INTENT',     -- 3 意向填报
  'INTERVIEW',  -- 4 导师初选与面试考核
  'CONFIRM',    -- 5 拟录取与学生确认
  'SUPPLEMENT', -- 6 分轮补录（轮次级总窗口）
  'ADJUST',     -- 7 统筹调剂录取
  'PUBLICITY',  -- 8 结果公示
  'ENROLL'      -- 正式入组
));

-- ----------------------------------------------------------------------------
-- 2. 基础表
-- ----------------------------------------------------------------------------
CREATE TABLE labs (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code        varchar(32)  NOT NULL UNIQUE,
  name        varchar(100) NOT NULL,
  intro       text         NOT NULL DEFAULT '',
  created_at  timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE labs IS '实训室';

CREATE TABLE mentors (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lab_id      text        NOT NULL REFERENCES labs(id) ON DELETE RESTRICT,
  name        varchar(50) NOT NULL,
  title       varchar(50) NOT NULL DEFAULT '',
  quota       integer     NOT NULL DEFAULT 0 CHECK (quota >= 0),   -- 软名额
  intro       text        NOT NULL DEFAULT '',
  sort_order  integer     NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE mentors IS '导师（实训室侧），quota 为软约束，允许超发';

CREATE INDEX idx_mentors_lab ON mentors(lab_id, sort_order);

CREATE TABLE users (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username      varchar(50) NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  name          varchar(50) NOT NULL,
  role          user_role   NOT NULL,
  student_no    varchar(30) UNIQUE,
  mentor_id     text REFERENCES mentors(id) ON DELETE RESTRICT,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE users IS '四类角色：学生 / 导师 / 学院管理员 / 系统任务';

CREATE INDEX idx_users_role ON users(role);

CREATE TABLE rounds (
  round_no   integer PRIMARY KEY CHECK (round_no BETWEEN 1 AND 3),
  name       varchar(50) NOT NULL,
  status     varchar(20) NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stage_windows (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  stage_key  stage_key   NOT NULL,
  round_no   integer     NOT NULL DEFAULT 0 CHECK (round_no BETWEEN 0 AND 3),
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  CONSTRAINT ck_stage_window_range CHECK (starts_at < ends_at),
  CONSTRAINT uq_stage_window UNIQUE (stage_key, round_no)
);
COMMENT ON TABLE stage_windows IS 'round_no=0 表示全局/轮次后置环节；服务端以此表为唯一时间权威';

CREATE INDEX idx_stage_windows_time ON stage_windows(starts_at, ends_at);

-- ----------------------------------------------------------------------------
-- 3. 意向（志愿单 + 3 条平行导师意向）
-- ----------------------------------------------------------------------------
CREATE TABLE applications (
  id                   text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  student_id           text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  round_no             integer NOT NULL REFERENCES rounds(round_no) ON DELETE RESTRICT,
  accept_lab_adjust    boolean NOT NULL DEFAULT false,  -- 是否服从实训室内部调剂
  accept_college_adjust boolean NOT NULL DEFAULT false, -- 是否服从全院实训室调剂
  status               application_status NOT NULL DEFAULT 'SUBMITTED',
  submitted_at         timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_application_student_round UNIQUE (student_id, round_no)
);
COMMENT ON TABLE applications IS '一名学生一轮一张志愿单；两个服从调剂开关属于志愿单';

CREATE INDEX idx_applications_round ON applications(round_no, status);

CREATE TABLE intents (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  application_id text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  student_id     text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  round_no       integer NOT NULL REFERENCES rounds(round_no) ON DELETE RESTRICT,
  mentor_id      text NOT NULL REFERENCES mentors(id) ON DELETE RESTRICT,
  lab_id         text NOT NULL REFERENCES labs(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_intent_application_mentor UNIQUE (application_id, mentor_id)
);
COMMENT ON TABLE intents IS '平行意向不分先后；允许同一 lab 多个导师，仅限制同一导师不可重复；每轮 ≤3 由服务端校验';

CREATE INDEX idx_intents_round_lab ON intents(round_no, lab_id);
CREATE INDEX idx_intents_round_student ON intents(round_no, student_id);
CREATE INDEX idx_intents_mentor ON intents(mentor_id, round_no);

-- ----------------------------------------------------------------------------
-- 4. 面试（以实训室为单位，全室共享一条面试记录）
-- ----------------------------------------------------------------------------
CREATE TABLE interviews (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  round_no      integer NOT NULL REFERENCES rounds(round_no) ON DELETE RESTRICT,
  student_id    text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  lab_id        text NOT NULL REFERENCES labs(id) ON DELETE RESTRICT,
  attitude      integer CHECK (attitude BETWEEN 0 AND 100),      -- 学习态度
  logic         integer CHECK (logic BETWEEN 0 AND 100),         -- 逻辑思维
  coding        integer CHECK (coding BETWEEN 0 AND 100),        -- 编程基础
  time_invest   integer CHECK (time_invest BETWEEN 0 AND 100),   -- 时间投入
  total         numeric(6,2) CHECK (total BETWEEN 0 AND 100),    -- 加权总分
  remark        text NOT NULL DEFAULT '',
  status        interview_status NOT NULL DEFAULT 'PENDING',
  scored_by     text REFERENCES users(id) ON DELETE SET NULL,
  scored_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_interview_student_lab_round UNIQUE (round_no, student_id, lab_id)
);
COMMENT ON TABLE interviews IS '不论报名是否超额，所有报名学生均须参加面试；同室多导师共享评分';

CREATE INDEX idx_interviews_lab_round ON interviews(lab_id, round_no, status);
CREATE INDEX idx_interviews_student ON interviews(student_id, round_no);

-- ----------------------------------------------------------------------------
-- 5. 拟录取 / 递补 / 调剂（offers）
-- ----------------------------------------------------------------------------
CREATE TABLE offers (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  round_no       integer NOT NULL REFERENCES rounds(round_no) ON DELETE RESTRICT,
  student_id     text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mentor_id      text NOT NULL REFERENCES mentors(id) ON DELETE RESTRICT,
  lab_id         text NOT NULL REFERENCES labs(id) ON DELETE RESTRICT,
  kind           offer_kind NOT NULL,
  rank           integer CHECK (rank >= 1),              -- 递补顺位
  status         offer_status NOT NULL DEFAULT 'PENDING',
  priority_level integer CHECK (priority_level BETWEEN 1 AND 3), -- 调剂优先级
  auto_confirmed boolean NOT NULL DEFAULT false,         -- 单 offer 立即生效
  over_quota     boolean NOT NULL DEFAULT false,         -- 超发标记
  note           text NOT NULL DEFAULT '',
  expires_at     timestamptz,                            -- 确认窗结束（倒计时依据）
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_offer_waitlist_rank CHECK (kind <> 'WAITLIST' OR rank IS NOT NULL),
  CONSTRAINT ck_offer_waitlist_status CHECK (kind <> 'WAITLIST' OR status <> 'CONFIRMED')
);
COMMENT ON TABLE offers IS '拟录取 / 递补 / 三级调剂共用表，kind 与 status 驱动状态机';

CREATE INDEX idx_offers_mentor_status ON offers(mentor_id, status);
CREATE INDEX idx_offers_student_round ON offers(student_id, round_no, status);
CREATE INDEX idx_offers_lab_round ON offers(lab_id, round_no, kind);
CREATE INDEX idx_offers_expire ON offers(expires_at) WHERE status = 'PENDING';

-- 防并发一人占两个名额（应用层 CAS 之外的最后一道硬约束）
CREATE UNIQUE INDEX uq_offers_confirmed_student_round
  ON offers(student_id, round_no)
  WHERE status = 'CONFIRMED';

-- 同一导师同一轮递补顺位唯一
CREATE UNIQUE INDEX uq_offers_waitlist_rank
  ON offers(mentor_id, round_no, rank)
  WHERE kind = 'WAITLIST' AND status = 'PENDING';

-- ----------------------------------------------------------------------------
-- 5.5 室内调剂候选顺位（导师可编辑；未提交时由系统按面试总分自动生成）
-- ----------------------------------------------------------------------------
CREATE TABLE lab_adjust_candidates (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  round_no   integer NOT NULL REFERENCES rounds(round_no) ON DELETE RESTRICT,
  lab_id     text NOT NULL REFERENCES labs(id) ON DELETE RESTRICT,
  mentor_id  text NOT NULL REFERENCES mentors(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rank       integer NOT NULL CHECK (rank >= 1),           -- 顺序即优先顺位
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_lab_adjust_candidate UNIQUE (round_no, mentor_id, student_id)
);
COMMENT ON TABLE lab_adjust_candidates IS '导师提交的室内调剂候选顺位，缺省时系统按面试总分自动生成';

CREATE INDEX idx_lab_adjust_candidates_lab ON lab_adjust_candidates(round_no, lab_id, rank);

-- ----------------------------------------------------------------------------
-- 6. 确认（与 offers 分表存储）
-- ----------------------------------------------------------------------------
CREATE TABLE confirmations (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  offer_id   text NOT NULL REFERENCES offers(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision   confirmation_decision NOT NULL,
  source     confirmation_source NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_confirmation_offer UNIQUE (offer_id)
);
COMMENT ON TABLE confirmations IS '确认动作独立存证，一 offer 一条；用于公示异议追溯';

CREATE INDEX idx_confirmations_student ON confirmations(student_id, decided_at);

-- ----------------------------------------------------------------------------
-- 7. 放鸽子（不删除 offer，保留记录并释放名额）
-- ----------------------------------------------------------------------------
CREATE TABLE withdrawals (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  offer_id    text NOT NULL REFERENCES offers(id) ON DELETE RESTRICT,
  student_id  text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mentor_id   text NOT NULL REFERENCES mentors(id) ON DELETE RESTRICT,
  reason      withdraw_reason NOT NULL,
  detail      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_withdrawals_mentor ON withdrawals(mentor_id, created_at);

-- ----------------------------------------------------------------------------
-- 8. 名额账本快照 / 异常 / 审计 / 配置
-- ----------------------------------------------------------------------------
CREATE TABLE quota_snapshots (
  id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  round_no         integer NOT NULL DEFAULT 0,        -- 0 表示全流程对账
  mentor_id        text NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
  quota            integer NOT NULL CHECK (quota >= 0),
  confirmed_count  integer NOT NULL CHECK (confirmed_count >= 0), -- 已确认占用
  pending_count    integer NOT NULL CHECK (pending_count >= 0),   -- 待确认预占
  released_count   integer NOT NULL CHECK (released_count >= 0),  -- 可释放（withdraw 累计）
  over_ratio       numeric(6,3) NOT NULL DEFAULT 0,               -- confirmed/quota - 1，仅超录时 > 0
  note             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_quota_snapshot UNIQUE (round_no, mentor_id)
);

CREATE TABLE anomalies (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  round_no    integer NOT NULL DEFAULT 0,
  type        varchar(30) NOT NULL,   -- OVER_QUOTA / DANGLING_PENDING / MISSING_CONFIRMATION / DOUBLE_BOOKED / WITHDRAW_MISMATCH
  entity_type varchar(30) NOT NULL,   -- MENTOR / OFFER / STUDENT
  entity_id   text NOT NULL,
  detail      text NOT NULL DEFAULT '',
  resolved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_anomalies_open ON anomalies(resolved, created_at);
CREATE UNIQUE INDEX uq_anomalies_open_entity
  ON anomalies(type, entity_type, entity_id)
  WHERE resolved = false;

CREATE TABLE audit_logs (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  actor_id    text,
  actor_name  varchar(50) NOT NULL DEFAULT 'system',
  actor_role  varchar(20) NOT NULL DEFAULT 'SYSTEM',
  action      varchar(40) NOT NULL,
  entity_type varchar(30) NOT NULL DEFAULT '',
  entity_id   text NOT NULL DEFAULT '',
  detail      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE audit_logs IS '只追加；公示期异议追溯依据';

CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE system_configs (
  key        varchar(60) PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 9. 初始化种子数据
-- ----------------------------------------------------------------------------
INSERT INTO labs (id, code, name, intro) VALUES
  ('lab-ai',   'AI-LAB',   '人工智能应用实训室', '方向：机器学习工程、计算机视觉、智能体应用；每周 2 次组会 + 项目实战。'),
  ('lab-data', 'DATA-LAB', '大数据与云原生实训室', '方向：数据平台、实时计算、云原生后端；以真实业务数据做课程项目。'),
  ('lab-sec',  'SEC-LAB',  '网络与信息安全实训室', '方向：渗透测试、安全运营、代码审计；参与学院攻防演练。');

INSERT INTO mentors (id, lab_id, name, title, quota, intro, sort_order) VALUES
  ('m-ai-zhang',   'lab-ai',   '张启明', '教授',   3, '机器学习工程与视觉方向，偏好能长期投入的同学。', 1),
  ('m-ai-li',      'lab-ai',   '李若曦', '讲师',   2, '智能体与多模态应用，重视编程基础与主动性。',     2),
  ('m-data-wang',  'lab-data', '王浩然', '副教授', 3, '实时计算与数据平台，重视工程规范。',             1),
  ('m-data-chen',  'lab-data', '陈思远', '讲师',   2, '云原生后端与可观测性，重视动手能力。',           2),
  ('m-sec-zhao',   'lab-sec',  '赵乾',   '教授',   2, '攻防演练与安全运营，要求时间投入稳定。',         1),
  ('m-sec-sun',    'lab-sec',  '孙亚楠', '讲师',   2, '代码审计与漏洞挖掘，重视逻辑思维。',             2);

INSERT INTO rounds (round_no, name, status) VALUES
  (1, '第一轮（集中填报）', 'OPEN'),
  (2, '第二轮补录', 'OPEN'),
  (3, '第三轮补录', 'OPEN');

INSERT INTO stage_windows (stage_key, round_no, starts_at, ends_at) VALUES
  -- 1 集中宣讲
  ('BRIEFING',  0, timestamptz '2026-10-29 14:00:00+08', timestamptz '2026-10-29 15:30:00+08'),
  -- 2 实训室开放日
  ('OPEN_DAY',  0, timestamptz '2026-10-29 15:30:00+08', timestamptz '2026-10-30 18:00:00+08'),
  -- 3 第一轮意向填报
  ('INTENT',    1, timestamptz '2026-11-02 08:00:00+08', timestamptz '2026-11-02 12:00:00+08'),
  -- 4 第一轮面试考核
  ('INTERVIEW', 1, timestamptz '2026-11-02 12:00:00+08', timestamptz '2026-11-03 17:00:00+08'),
  -- 5 第一轮拟录取确认
  ('CONFIRM',   1, timestamptz '2026-11-04 08:00:00+08', timestamptz '2026-11-04 12:00:00+08'),
  -- 6 分轮补录：总窗口 + 第二/三轮子窗口
  ('SUPPLEMENT',2, timestamptz '2026-11-04 12:00:00+08', timestamptz '2026-11-05 17:00:00+08'),
  ('INTENT',    2, timestamptz '2026-11-04 12:00:00+08', timestamptz '2026-11-04 16:00:00+08'),
  ('INTERVIEW', 2, timestamptz '2026-11-04 16:00:00+08', timestamptz '2026-11-04 23:00:00+08'),
  ('CONFIRM',   2, timestamptz '2026-11-04 23:00:00+08', timestamptz '2026-11-05 04:00:00+08'),
  ('INTENT',    3, timestamptz '2026-11-05 04:00:00+08', timestamptz '2026-11-05 08:00:00+08'),
  ('INTERVIEW', 3, timestamptz '2026-11-05 08:00:00+08', timestamptz '2026-11-05 13:00:00+08'),
  ('CONFIRM',   3, timestamptz '2026-11-05 13:00:00+08', timestamptz '2026-11-05 17:00:00+08'),
  -- 7 统筹调剂
  ('ADJUST',    0, timestamptz '2026-11-06 08:00:00+08', timestamptz '2026-11-06 12:00:00+08'),
  -- 8 公示 1 天
  ('PUBLICITY', 0, timestamptz '2026-11-06 12:00:00+08', timestamptz '2026-11-07 12:00:00+08'),
  -- 正式入组
  ('ENROLL',    0, timestamptz '2026-11-07 12:00:00+08', timestamptz '2026-11-10 23:59:00+08');

INSERT INTO system_configs (key, value) VALUES
  ('ADJUST_PRIORITY_LEVELS', '1,2,3'),
  ('WAITLIST_RULE',          'INTERVIEW_TOTAL_DESC'),
  ('OVER_QUOTA_FACTOR',      '1.0'),
  ('INTERVIEW_WEIGHTS',      '{"attitude":30,"logic":25,"coding":30,"timeInvest":15}'),
  ('SIMULATED_NOW',          '2026-11-02T08:30:00+08:00'),
  ('MAX_INTENTS_PER_ROUND',  '3');
