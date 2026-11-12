# 学生实训室进组选拔系统

双向选择 + 分轮录取 + 统筹调剂的学生实训室进组选拔系统。覆盖学院官方 8 个环节：集中宣讲、实训室开放日、意向填报、导师初选与面试、拟录取与学生确认、分轮补录、统筹调剂、公示与正式入组。

- 前端：React 18 + TypeScript + Vite + Ant Design 5（学生端 / 导师端 / 学院管理后台三个入口）
- 后端：NestJS 10 + Prisma 6
- 数据库：PostgreSQL（交付完整 DDL）；本地零依赖演练默认使用 SQLite
- 锁与缓存：Redis（可选，未配置时自动降级为进程内串行锁 + 内存 TTL 缓存）

---

## 一、本机环境现状与替代方案

已在本机检测到：

| 组件 | 现状 | 处理方式 |
| --- | --- | --- |
| Node / npm | ✅ Node v24.22.2、npm 11.19.1 可用 | 直接使用 |
| PostgreSQL | ❌ 5432 端口无服务 | 本地演练用 SQLite（Prisma 自动建库）；生产/联调用 `docker compose up -d` |
| Docker | ❌ 未安装 | 不影响本地演练；有 Docker 的环境可一键起 PG + Redis |
| Redis | ❌ 未安装 | 可选。未配置 `REDIS_URL` 时自动使用进程内锁与内存缓存 |
| git | ✅ 已安装（2.56.0） | 直接使用 |

> 说明：系统在数据访问层只依赖 Prisma，SQLite 与 PostgreSQL 的业务代码完全一致。切换到 PostgreSQL 只需两步（见第五节）。

---

## 二、目录结构

```
d:\志愿填报系统
├─ docs/design.md                 # 设计文档（架构、权限矩阵、状态机、算法、接口清单）
├─ db/schema.postgresql.sql       # PostgreSQL 完整 DDL（枚举/索引/唯一约束/外键/种子数据）
├─ docker-compose.yml             # 本地开发：PostgreSQL 16 + Redis 7 一键启动
├─ docker-compose.prod.yml        # 全栈部署：PostgreSQL + Redis + 后端 + 前端
├─ .env.example                   # 部署环境变量示例
├─ backend/                       # NestJS 后端
│  ├─ Dockerfile                  # 后端多阶段构建镜像（生产依赖 + 预生成 Prisma Client）
│  ├─ prisma/schema.prisma        # Prisma 模型（SQLite 演练库）
│  ├─ prisma/schema.postgresql.prisma  # Prisma 模型（容器部署用 PostgreSQL）
│  ├─ prisma/seed.ts              # 种子数据：实训室/导师/名额/时间窗/账号
│  └─ src/                        # auth / meta / student / mentor / offers / admin / jobs
└─ frontend/                      # React 前端
   ├─ Dockerfile                  # 前端构建 + Nginx 托管
   ├─ nginx.conf                  # 静态资源与 /api 反向代理
   └─ src/
      ├─ pages/                   # 学生端、导师端、管理后台页面
      ├─ api.ts / auth.tsx / Shell.tsx / App.tsx
      └─ main.tsx / styles.css
```

---

## 三、快速开始（本地零依赖模式，推荐先跑通）

### 1. 启动后端

```powershell
cd d:\志愿填报系统\backend
npm install --registry=https://registry.npmmirror.com
copy .env.example .env # 生成本地配置（默认指向 SQLite 演练库）
npm run setup          # = prisma db push + 写入种子数据（生成 backend/prisma/dev.db）
npm run start:dev      # http://localhost:3000/api
```

健康检查：`http://localhost:3000/api/meta/health`

> 若 `npm install` 出现 `ECONNRESET`，是访问 npmjs 官方源不稳定，使用上面的国内镜像参数即可。
> 若 Prisma 引擎下载失败，可在 PowerShell 中先设置：`$env:PRISMA_ENGINES_MIRROR="https://npmmirror.com/mirrors/prisma"` 再执行 `npm run setup`。

### 2. 启动前端

```powershell
cd d:\志愿填报系统\frontend
npm install --registry=https://registry.npmmirror.com
npm run dev            # http://localhost:5173
```

前端通过 Vite 代理把 `/api` 转发到 `http://localhost:3000`，无需配置跨域。

### 3. 访问地址

| 入口 | 地址 |
| --- | --- |
| 登录页 | http://localhost:5173/login |
| 学生端 | http://localhost:5173/student |
| 导师端 | http://localhost:5173/mentor |
| 管理后台 | http://localhost:5173/admin |
| 后端 API | http://localhost:3000/api |

### 4. 测试账号

| 角色 | 账号 | 密码 | 说明 |
| --- | --- | --- | --- |
| 学院管理员 | `admin` | `admin123` | 名额总览、对账、调剂、公示、时钟演练 |
| 导师 | `mentor01` ~ `mentor06` | `mentor123` | mentor01/02 属 AI 室，03/04 属数据室，05/06 属安全室 |
| 学生 | `student01` ~ `student10` | `student123` | 共 10 人 |

种子数据：3 个实训室、6 位导师、总名额 14（3+2、3+2、2+2）、10 名学生、15 条环节时间窗。

> 登录页提供「一键填入」按钮，可直接切换三类账号。

---

## 四、完整流程演练（第 3 → 第 8 步）

系统所有环节开关由**服务端时间窗**判定（`system_configs.SIMULATED_NOW` 模拟时钟优先，否则取真实时间）。种子数据默认模拟时钟为 **2026-11-02 08:30**，正好处于第一轮意向填报窗口。管理后台「名额总览 → 演练时钟」可一键跳转到任意环节。

1. **意向填报（第 3 步）**
   学生登录 → 意向填报。可选轮次、勾选导师（最多 3 个平行意向，允许同一实训室选多位导师），页面实时显示「该实训室已报 N 位」；设置「服从室内调剂」「服从全院调剂」两个开关后提交。窗口内可改填。

2. **面试与评分（第 4 步）**
   管理员把时钟跳到 `2026-11-02 12:00` 之后 → 导师登录 → 面试评分，对本室**所有报名学生**逐一评分（学习态度 / 逻辑思维 / 编程基础 / 时间投入，加权总分由服务端计算）或标记缺考。未完成全员评分时不允许发布名单。

3. **拟录取与确认（第 5 步）**
   导师在「名额与名单」页选择拟录取与递补（选择顺序即递补顺位）→ 发布。若本批使「已确认 + 待确认 + 本批」超过名额，会弹出超录二次确认（软约束 + 告警）。管理员把时钟跳到 `2026-11-04 08:00`：
   - 只有 1 个拟录取的学生**立即自动确认**（不是等到截止）；
   - 收到 2 个及以上拟录取的学生在「我的录取」页自主选择，先确认者先锁定名额，确认瞬间其余 pending offer 全部失效；
   - 页面显示服务端时间偏移后的倒计时，确认需勾选「不可逆」二次确认；
   - 逾期未确认由定时任务置为过期并按递补顺位补录。

4. **分轮补录（第 6 步）**
   时钟进入 `2026-11-04 12:00` 的第二轮：未被录取的学生重新填报，导师再次面试、发布、双向确认，依次完成第二轮与第三轮。

5. **统筹调剂（第 7 步）**
   时钟进入 `2026-11-06 08:00` → 管理后台「调剂与公示」：L1 实训室内部调剂（候选池按学生去重）→ L2 全院跨实训室调剂 → L3 未服从调剂学生的最终统筹。执行结果直接生成已确认录取记录。

6. **公示与入组（第 8 步）**
   公示窗口内管理后台可查看最终名单与放弃记录；公示期有异议可查「异常与审计」。公示结束后登记正式入组；入组未报到按「放鸽子」登记（生成 withdraw 记录释放名额，人回到补录池）。

> 「放鸽子」不删除任何记录：确认后放弃、公示后放弃、入组未报到，都会生成 `withdrawals` 记录并释放名额，学生回到补录池。

---

## 五、切换到 PostgreSQL（联调/生产）

方式 A：Docker 一键起库（容器初始化时自动执行 DDL，建表 + 实训室/导师/时间窗种子）

```powershell
cd d:\志愿填报系统
docker compose up -d
# PostgreSQL: localhost:5432  lab / lab123 / lab_selection
# Redis:      localhost:6379
```

方式 B：已有 PostgreSQL 实例

```powershell
psql -U postgres -c "CREATE DATABASE lab_selection;"
psql -U postgres -d lab_selection -f d:\志愿填报系统\db\schema.postgresql.sql
```

然后修改两处并初始化账号：

1. `backend/.env`：

```dotenv
DATABASE_URL="postgresql://lab:lab123@localhost:5432/lab_selection?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
```

2. `backend/prisma/schema.prisma`：把 `provider = "sqlite"` 改为 `provider = "postgresql"`。

```powershell
cd d:\志愿填报系统\backend
npx prisma generate
npm run seed      # 写入测试账号，并重建全部种子数据（会先清空）
npm start
```

> DDL 中的状态列使用 `DOMAIN (text + CHECK)`，既保留数据库层枚举校验，也与 Prisma 的 String 映射兼容，应用可直接读写。
> 也可以跳过 DDL，直接 `npx prisma db push` 建表，再 `npm run seed`；两种方式表结构一致。

---

## 六、Docker 部署（全栈一键启动）

仓库内置多阶段 Dockerfile：后端为 NestJS（生产依赖 + 预生成的 PostgreSQL Prisma Client），前端 Vite 构建后由 Nginx 托管并反向代理 `/api`；数据库使用 PostgreSQL，DDL 在数据卷首次创建时自动执行。

```powershell
cd d:\志愿填报系统
copy .env.example .env                                                    # 至少修改 JWT_SECRET
docker compose -f docker-compose.prod.yml up -d --build                   # 构建并启动全栈
docker compose -f docker-compose.prod.yml --profile seed run --rm seed    # 首次：写入账号与种子数据
```

启动后访问 <http://localhost:8080>（端口由 `.env` 的 `WEB_PORT` 控制），账号与本地演练一致。

| 服务 | 作用 | 对外端口 |
| --- | --- | --- |
| frontend | Nginx：静态资源 + `/api` 反向代理 | `${WEB_PORT}`（默认 8080） |
| backend | NestJS，`node dist/main.js` | 仅内网 3000 |
| postgres | PostgreSQL 16，自动执行 `db/schema.postgresql.sql` | 仅内网 5432 |
| redis | Redis 7（未配置时后端自动降级为内存锁） | 仅内网 6379 |
| seed | 一次性种子任务（`--profile seed`） | — |

常用运维命令：

```powershell
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml down        # 停止，保留数据卷
docker compose -f docker-compose.prod.yml down -v     # 停止并清空数据（下次启动重新执行 DDL）
```

注意事项：

- `seed` 会先清空业务表，只用于首次初始化或演练重置，不要在有真实数据的库上执行。
- 国内网络构建时若 Prisma 引擎下载缓慢，可在 `backend/Dockerfile` 顶部加一行 `ENV PRISMA_ENGINES_MIRROR=https://npmmirror.com/mirrors/prisma`。
- 需要 HTTPS 时，在 Nginx 前再放一层反向代理，或修改 `frontend/nginx.conf` 监听 443 并挂载证书。
- 也可单独部署镜像：后端镜像监听 3000（需外部 PostgreSQL），前端镜像监听 80（需能解析主机名 `backend`，或在 nginx.conf 中改成你的后端地址）。

---

## 七、核心设计要点

详见 [docs/design.md](docs/design.md)，此处仅列关键约定：

- **服务端时间是唯一权威**：所有环节开关由 `TimeService.assertOpen` 判定，前端按钮只是表现；管理后台可设置模拟时钟用于演练，也可一键恢复真实时间。
- **三张表分离**：意向（`intents`）、拟录取（`offers`）、确认（`confirmations`）分表存储，状态不混用。
- **名额账本三层**：已确认占用 / 待确认预占 / 可释放，每轮结束对账，差异写入 `anomalies`，不静默放过。
- **超发是软约束**：导师发布名单时若超名额，必须带二次确认；后台展示「已确认/名额」与超录比例，超发记录打 `over_quota` 标记并写审计。
- **单 offer 立即自动确认**：发布时若确认窗已开放则立即生效；确认窗开启后由定时任务扫描「恰好 1 个 pending」的学生统一自动确认。
- **实时抢占 + 幂等**：确认使用唯一约束 + 状态机 CAS（`id + studentId + status='PENDING'`），并发双击只有一次成功；确认后同轮其余 pending 置为失效。
- **三级调剂**：L1 室内（候选池按学生去重）→ L2 全院跨室 → L3 未服从调剂学生最终统筹；优先级、递补规则、超发系数均为 `system_configs` 可配置项。
- **全量审计**：关键操作写 `audit_logs`，供公示期异议追溯。
- **RBAC 四类角色**：学生 / 导师 / 学院管理员 / 系统定时任务。

---

## 八、常见问题

| 问题 | 处理 |
| --- | --- |
| `npm install` 报 `ECONNRESET` | 使用 `--registry=https://registry.npmmirror.com` |
| Prisma 引擎下载失败 | 设置 `$env:PRISMA_ENGINES_MIRROR="https://npmmirror.com/mirrors/prisma"` 后重试 |
| 端口 3000 / 5173 被占用 | 改 `backend/.env` 的 `PORT`，并同步修改 `frontend/vite.config.ts` 的 proxy target |
| 页面提示「当前不在某环节窗口」 | 属正常门控；用管理员账号在「名额总览 → 演练时钟」跳转到对应时间 |
| 想重置演练数据 | `cd backend; npm run db:reset` |
| 没有 Redis | 无需配置，后端自动降级；日志会注明使用内存实现 |
