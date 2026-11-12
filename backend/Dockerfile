# NestJS 后端镜像：多阶段构建，运行时只保留生产依赖
FROM node:22-alpine AS base
RUN apk add --no-cache openssl
WORKDIR /app

# 1) 安装全部依赖（含 prisma CLI / ts-node，供构建与种子脚本使用）
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# 2) 生成 PostgreSQL 版 Prisma Client 并编译
FROM deps AS build
COPY prisma ./prisma
RUN npx prisma generate --schema prisma/schema.postgresql.prisma
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# 3) 运行时镜像
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# 复用构建阶段生成的 Prisma Client 与查询引擎
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/dist ./dist
COPY prisma ./prisma

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/meta/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
