# 学生实训室进组选拔系统 · 设计文档

> 双向选择 + 分轮录取 + 统筹调剂。覆盖学院官方 8 个环节，服务端为时间窗唯一权威。

## 1. 总体架构

```
┌───────────────────────────────────────────────────────────────────────┐
│                         浏览器（React + AntD）                         │
│  /student 学生端        /mentor 导师端        /admin 学院管理后台       │
└───────────────────────────┬───────────────────────────────────────────┘
                            │ HTTPS / JWT (Bearer)
┌───────────────────────────▼───────────────────────────────────────────┐
│                       NestJS API（/api，单一服务）                     │
│  Auth  JwtAuthGuard/RolesGuard(RBAC)                                  │
│  Meta  环节时间窗 / 实训室热度 / 模拟时钟                               │
│  Student 意向填报 / 确认 / 放弃 / 结果                                  │
│  Mentor 面试评分 / 拟录取+递补名单提交 / 名额视图                        │
│  Admin  名额账本 / 对账 / 三级调剂 / 公示 / 放鸽子释放 / 审计            │
│  Jobs   @Interval 到期未确认 → 失效 → 递补 → 异常                       │
│  Common TimeService(唯一时间源) LockService(Redis→内存) AuditService     │
└───────────────┬──────────────────────────────┬────────────────────────┘
                │ Prisma                       │ 可选
      ┌─────────▼─────────┐          ┌──────────▼──────────┐
      │ PostgreSQL        │          │ Redis（锁/名额缓存）│
      │ （生产，DDL 手写） │          │ 无则内存实现兜底     │
      └───────────────────┘          └─────────────────────┘
```

本地环境（当前机器）无 PostgreSQL / Docker，运行骨架使用 **Prisma + SQLite**，业务代码与 PG 版同构；
生产部署执行 `db/schema.postgresql.sql` 并把 Prisma datasource 切为 `postgresql`。详见 README。

## 2. 模块划分

| 模块 | 目录 | 职责 |
| --- | --- | --- |
| auth | `backend/src/auth` | 登录、JWT 签发、当前用户 |
| common | `backend/src/common` | 时间窗权威、分布式锁、审计、角色装饰器 |
| meta | `backend/src/meta` | 实训室/导师/热度、环节窗口、评分配置 |
| student | `backend/src/student` | 意向填报、确认/放弃、结果查询 |
| mentor | `backend/src/mentor` | 面试评分、拟录取/递补名单提交、名额视图 |
| offers | `backend/src/offers` | 名额账本、自动确认、递补提升、到期失效、对账 |
| admin | `backend/src/admin` | 总览、调剂、公示、放鸽子、审计、窗口/时钟 |
| jobs | `backend/src/jobs` | 定时任务（失效/递补） |

三端入口：`/student`、`/mentor`、`/admin`（同一 SPA，按角色路由守卫）。

## 3. 角色权限矩阵

| 能力 | 学生 | 导师 | 学院管理员 | 定时任务 |
| --- | --- | --- | --- | --- |
| 查看环节时间窗 / 实训室热度 | ✓ | ✓ | ✓ | ✓ |
| 提交/修改本人意向（≤3，可同室多导师） | ✓ | – | – | – |
| 查看本人 pending offer / 倒计时 | ✓ | – | – | – |
| 确认唯一去向（实时抢占、幂等） | ✓ | – | – | – |
| 面试评分（填报本导师的学生，同室多导师分别独立打分） | – | ✓ | – | – |
| 提交拟录取/递补名单（可超发，二次确认） | – | ✓ | – | – |
| 查看本导师名额账本 | – | ✓ | ✓ | ✓ |
| 三级统筹调剂 | – | – | ✓ | – |
| 释放已确认名额（放鸽子/公示后放弃） | – | – | ✓ | – |
| 对账 / 异常记录 / 全量审计 | – | – | ✓ | 只写 |
| 修改时间窗 / 模拟时钟（演练用） | – | – | ✓ | – |

RBAC 由 `@Roles()` + `RolesGuard` 强制；所有写接口前端按钮只是表现，服务端二次校验身份与时间窗。

## 4. 环节与轮次状态机

### 4.1 八个官方环节 → 时间窗

| # | 环节 | stage_key | round_no | 时间（2026） |
| --- | --- | --- | --- | --- |
| 1 | 集中宣讲 | BRIEFING | 0 | 10-29 14:00–15:30 |
| 2 | 开放日 | OPEN_DAY | 0 | 10-29 15:30–10-30 18:00 |
| 3 | 意向填报 | INTENT | 1 | 11-02 08:00–12:00 |
| 4 | 面试考核 | INTERVIEW | 1 | 11-02 12:00–11-03 17:00 |
| 5 | 拟录取确认 | CONFIRM | 1 | 11-4 08:00–12:00 |
| 6 | 分轮补录 | SUPPLEMENT / INTENT·INTERVIEW·CONFIRM | 2、3 | 11-4 12:00–11-5 17:00 |
| 7 | 统筹调剂 | ADJUST | 0 | 11-6 08:00–12:00 |
| 8 | 公示 / 入组 | PUBLICITY / ENROLL | 0 | 11-6 12:00–11-7 12:00 / 11-7 12:00 起 |

### 4.2 学生志愿单状态

```
(无) --提交--> SUBMITTED --面试开始--> INTERVIEWING
   |                |                       |
   |                +----(窗口内改填)---------+
   |                                        v
   +------------------------------------> CLOSED（本轮结束）
```

### 4.3 单条 offer 状态（拟录取 / 递补 / 调剂共用）

```
                  ┌───────────── 学生确认(幂等 CAS) ─────────────┐
PENDING(待确认) ──┤                                            ├─> CONFIRMED
   │              └───────────── 学生拒绝 / 到期 / 管理员释放 ────┘      │
   │                                                                    │
   ├─ 到期未确认 ─────────────────> EXPIRED ──> 触发同导师递补            │
   ├─ 其他 offer 先确认 ───────────> VOID（实时抢占，不可逆）             │
   ├─ 学生主动拒绝 ───────────────> DECLINED ──> 触发递补                 │
   └─ 管理员登记放鸽子 ────────────> WITHDRAWN ──> 名额释放，人回补录池    │
                                                                    v
                                                   CONFIRMED --放鸽子--> WITHDRAWN
WAITLIST：PENDING(排队) --递补--> PROMOTED（转为 PRIMARY/PENDING 并重新确认）
```

- 确认是 **CAS**：`UPDATE offers SET status='CONFIRMED' WHERE id=? AND student_id=? AND status='PENDING'`，
  影响行数为 0 时若已是 `CONFIRMED` 返回幂等成功，否则 409。PG 上另有
  `UNIQUE(student_id, round_no) WHERE status='CONFIRMED'` 兜底。
- 确认成功后，同一学生本轮其余 `PENDING` 全部置 `VOID`，不可逆。

### 4.4 轮次流转

```
R1 意向 → R1 面试 → R1 确认/递补 ─┐
                                  ├─> 未录取学生进入 R2 → R2 确认/递补 ─┐
                                  │                                    ├─> R3 …
                                  └────────────────────────────────────┘
R3 结束 → ADJUST(1 室内 → 2 全院 → 3 未服从调剂者统筹) → PUBLICITY → ENROLL
每一轮确认窗结束时：PENDING 到期 → EXPIRED → 按递补顺位补录；随后生成名额快照。
```

## 5. 三条已拍板规则的实现方案

### 5.1 同一实训室可报多个导师，室内候选池按人去重

- `intents` 只约束 `(application_id, mentor_id)` 唯一，**不约束 lab**；`lab_id` 冗余存储便于热度统计与室内调剂。
- 服务端校验：单轮意向 ≤3、导师不重复、导师必须存在且启用；同实验室多个导师合法。
- 填报页 `/meta/bootstrap` 返回每个实训室的 `applicantCount`（本轮 distinct 学生数），前端提示「该实训室已报 N 位（截至当前）」。
- 室内调剂在 `AdjustService.level1` 中按学生逐个处理：同一学生即使报了同室 3 位导师，也只会被分配 1 次；先去给他打分最高的导师，该导师满员时才在本室学生也报过、且仍有余额的导师中选分高者。
- 导师也可在面试阶段提交/重提名单时**直接录取**本室服从调剂、尚未被任何导师占用的学生：服务端校验本轮同室意向 + `accept_lab_adjust` + 未被确认/预占，创建 `kind=LAB_ADJUST`、`status=PENDING`（`note=MENTOR_LAB_ADJUST`）；占用本人名额、先到先得，并发下后到者自动跳过并在返回的 `skippedLabAdjust` 中提示。导师端候选表展示同室每位导师的分项评分、总分与评语，可直接「加入拟录取 / 移出拟录取」。
- 导师端候选只展示同室、服从调剂、未被任何导师占用的学生；自己的室内调剂预占在重提时仍可见（便于核对评分），自己的拟录取/递补学生不再计入候选顺位。

### 5.2 允许超发 + 软名额 + withdraw 释放

- `mentors.quota` 是软约束：提交名单时计算 `已确认 + 待确认预占 + 本批` > 名额 时，
  若未带 `overQuotaConfirm=true` 返回 409 + 超录明细；前端弹二次确认后重提。
- 超发的 offer 标 `over_quota=true`，写 `OFFER_OVER_QUOTA` 审计；后台显示「已确认/名额」与超录比例 `confirmed/quota - 1`。
- 放鸽子不删记录：`offer.status=WITHDRAWN` + 新建 `withdrawals(reason)`，名额回到账本；
  确认窗内若还有递补名单，立即递补；否则该生回到补录/调剂池（`CONFIRMED` 计数已减少，调剂可再捞）。
- 放鸽子来源：确认后放弃（`CONFIRM_ABANDON`）、公示后放弃（`PUBLICITY_ABANDON`）、入组未报到（`NO_SHOW`），管理员登记。

### 5.3 单 offer 立即自动确认 + 实时抢占

- 名单发布（`publish`）在同一事务/锁内完成：创建 primary offer → 对每个学生检查本轮 `PENDING` 数量；
  若恰好 1 且无 `CONFIRMED`，立刻写 `CONFIRMED` + `confirmations(source=AUTO)`，不等截止时间。
- 若学生收到 2 个及以上：全部 `PENDING`，`expires_at = 本轮确认窗结束`；前端展示倒计时。
- 学生点击确认时：先锁 `student:{id}:offer`，CAS 抢占 → 其余 pending 置 `VOID`。谁先确认谁锁名额。
- 已在本轮/往轮确认过的学生，后续名单提交时直接被拒绝（避免一人占两席），由导师移除该生。

## 6. 名额账本

三层口径（实时计算，按导师）：

| 层 | 口径 | 用途 |
| --- | --- | --- |
| 已确认占用 | `offers.status=CONFIRMED` 计数 | 超录判断 / 公示 |
| 待确认预占 | `offers.status=PENDING` 且非 WAITLIST | 防超发瞬时穿透 |
| 可释放 | `withdrawals` 累计 + `max(0, quota-已确认)` | 放鸽子/递补容量 |

- `quota_snapshots` 按 `(round_no, mentor_id)` 存每轮快照：quota / confirmed / pending / released / over_ratio。
- 对账 `reconcile` 校验并写 `anomalies`（不静默）：
  1. `OVER_QUOTA`：confirmed + pending > quota；
  2. `DANGLING_PENDING`：PENDING 已过 expires_at；
  3. `MISSING_CONFIRMATION`：CONFIRMED 无 confirmation 记录；
  4. `DOUBLE_BOOKED`：同一学生同一轮出现 2 条 CONFIRMED；
  5. `WITHDRAW_MISMATCH`：withdrawal 指向未 WITHDRAWN 的 offer。
- 每轮确认窗结束由任务/管理员触发对账；差异只记录异常并告警，不做静默修正。

## 7. 递补与调剂算法

### 7.1 递补

1. 触发：offer `EXPIRED / DECLINED / WITHDRAWN`。
2. 条件：本轮 `CONFIRM` 窗口仍开放，且该导师 `quota - confirmed - pending > 0`。
3. 取该导师本轮 `kind=WAITLIST, status=PENDING, rank` 最小者；转为 `PRIMARY/PENDING`，`expires_at=确认窗结束`。
4. 该生若本轮仅此 1 个 pending → 立即自动确认；若已有多个 → 倒计时等待。
5. 递补顺位规则可配置（`WAITLIST_RULE=INTERVIEW_TOTAL_DESC`，同分按面试提交时间）。

### 7.2 三级统筹调剂（`AdjustService.run(level)`）

统一前置：仅 `ADJUST` 窗口内可执行；候选 = 无任何 `CONFIRMED` 的学生；按最近一轮 application 读取调剂意愿。

| 优先级 | 候选池 | 排序 | 目标 |
| --- | --- | --- | --- |
| L1 室内调剂 | `accept_lab_adjust=true`、仍未被录取，且本轮至少有一位填报导师已打分 | 学生按本轮最高分降序 → 室内候选顺位（同分） → 填报时间 | 先去给他打分最高的导师；该导师满员时，去其所在实训室里学生也报过、且仍有名额的导师；都没有则留给 L2 |
| L2 全院调剂 | `accept_college_adjust=true` 且尚未录取 | 本轮面试最高分降序 → 填报时间 | 全院剩余名额最多（优先未报过的实训室） |
| L3 最终统筹 | 仍未录取者（含不服从调剂） | 填报时间 → 学号 | 剩余任意名额 |

- 命中即建 `CONFIRMED` offer（kind=`LAB_ADJUST/COLLEGE_ADJUST/FINAL`，priority_level=1/2/3）+ `confirmations(source=SYSTEM)`；
- 每轮调剂开跑前先结算已过确认窗的 `PENDING`（置 `EXPIRED`），避免过期占位让容量判断偏小；
- 同一学生一次 run 内只能被分配一次；幂等（已 CONFIRMED 直接跳过）。
- 优先级顺序、超发系数、递补规则、评分权重存 `system_configs`，不硬编码。

## 8. 时间权威与演练

- 所有写操作入口调用 `TimeService.assertOpen(stage, round)`；前端只展示状态。
- `system_configs.SIMULATED_NOW` 可设置模拟时钟（管理员），用于演练/演示；`DELETE /admin/clock` 恢复真实时间。
- 种子默认模拟时间 `2026-11-02 08:30`（R1 意向窗口内），后台可按环节一键跳转。

## 9. 并发、幂等与审计

- 锁：`LockService.withLock(key)`；有 `REDIS_URL` 用 `SET NX PX` 分布式锁，无则进程内队列锁（注明降级）。
- 确认、发布、递补、调剂均加锁；确认另用 CAS + 唯一约束双保险。
- 审计：登录、填报、改填、评分、发布、确认、放弃、失效、递补、调剂、对账、放鸽子、改窗、改时钟全部写 `audit_logs`，含 actor/role/action/entity/detail。
- 审计日志只追加，不提供更新/删除接口，用于公示期异议追溯。

## 10. 核心 API

| Method | Path | 角色 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 公开 | 登录 |
| GET | `/api/auth/me` | 登录 | 当前用户 |
| GET | `/api/meta/bootstrap` | 登录 | 窗口/时钟/实验室热度/导师/权重 |
| POST | `/api/student/intents` | 学生 | 提交或改填意向（≤3） |
| GET | `/api/student/intents` | 学生 | 本人志愿单 |
| GET | `/api/student/offers` | 学生 | 本轮 offer + 服务端时间 + 确认窗 |
| POST | `/api/student/offers/:id/confirm` | 学生 | 幂等确认（实时抢占） |
| POST | `/api/student/offers/:id/decline` | 学生 | 拒绝（触发递补） |
| GET | `/api/student/result` | 学生 | 最终结果/公示 |
| GET | `/api/mentor/applicants` | 导师 | 填报本导师的学生 + 本导师面试分 |
| POST | `/api/mentor/interviews/score` | 导师 | 四维评分 |
| GET | `/api/mentor/quota` | 导师 | 名额三层账本 |
| POST | `/api/mentor/offers/publish` | 导师 | 拟录取 + 递补名单（可超发） |
| GET | `/api/mentor/offers` | 导师 | 已提交名单 |
| GET | `/api/admin/overview` | 管理员 | 全导师名额/超录/异常 |
| POST | `/api/admin/reconcile` | 管理员 | 对账生成快照/异常 |
| POST | `/api/admin/adjust` | 管理员 | L1/L2/L3 调剂 |
| GET | `/api/admin/publicity` | 管理员 | 公示汇总 + 已确认列表 |
| POST | `/api/admin/withdrawals` | 管理员 | 登记放鸽子释放名额 |
| GET | `/api/admin/anomalies` | 管理员 | 异常列表 |
| GET | `/api/admin/audit` | 管理员 | 审计日志 |
| GET/PATCH | `/api/admin/windows` | 管理员 | 查看/调整时间窗 |
| POST/DELETE | `/api/admin/clock` | 管理员 | 模拟时钟设置/恢复 |

## 11. 数据表关系（ER 概览）

```
labs 1─n mentors 1─n offers ─1 confirmations
users(student) 1─n applications 1─n intents ─n mentors
interviews: (round_no, student_id, mentor_id) 唯一 —— 每位导师独立评分；同一学生报同室多位导师时分别产生面试记录
offers: 拟录取/递补/调剂共用；kind 区分，status 状态机
withdrawals: 放鸽子记录（offer 不删除）
quota_snapshots / anomalies: 每轮账本快照与差异
audit_logs: 全量追加审计
```

关注意向、拟录取、确认三态分表：`intents` / `offers` / `confirmations`。
