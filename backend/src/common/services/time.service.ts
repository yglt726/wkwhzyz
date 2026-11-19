import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { StageWindow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { STAGE_LABELS } from '../types';

export function formatCN(d: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(/\//g, '-');
}

@Injectable()
export class TimeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 服务端唯一时间源：管理员设置的模拟时钟优先，否则真实时间 */
  async getNow(): Promise<Date> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'SIMULATED_NOW' } });
    if (cfg?.value) {
      const d = new Date(cfg.value);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  }

  async listWindows(): Promise<StageWindow[]> {
    return this.prisma.stageWindow.findMany({ orderBy: [{ startsAt: 'asc' }, { roundNo: 'asc' }] });
  }

  async getWindow(stageKey: string, roundNo = 0): Promise<StageWindow | null> {
    return this.prisma.stageWindow.findUnique({
      where: { stageKey_roundNo: { stageKey, roundNo } },
    });
  }

  async isOpen(stageKey: string, roundNo = 0): Promise<boolean> {
    const w = await this.getWindow(stageKey, roundNo);
    if (!w) return false;
    const now = await this.getNow();
    return now >= w.startsAt && now <= w.endsAt;
  }

  async isAnyOpen(list: Array<{ stageKey: string; roundNo: number }>): Promise<boolean> {
    for (const item of list) {
      if (await this.isOpen(item.stageKey, item.roundNo)) return true;
    }
    return false;
  }

  async assertOpen(stageKey: string, roundNo = 0): Promise<StageWindow> {
    const w = await this.getWindow(stageKey, roundNo);
    if (!w) throw new ForbiddenException(`环节「${STAGE_LABELS[stageKey] || stageKey}」尚未开放`);
    const now = await this.getNow();
    if (now < w.startsAt || now > w.endsAt) {
      throw new ForbiddenException({
        code: 'TIME_WINDOW_CLOSED',
        message: `当前进度不在「${STAGE_LABELS[stageKey] || stageKey}」阶段，该操作暂未开放`,
        stageKey,
        roundNo,
      });
    }
    return w;
  }

  async assertAnyOpen(list: Array<{ stageKey: string; roundNo: number }>): Promise<void> {
    if (!(await this.isAnyOpen(list))) {
      const names = list.map((i) => STAGE_LABELS[i.stageKey] || i.stageKey).join(' / ');
      throw new ForbiddenException(`当前进度不在「${names}」任一阶段，该操作暂未开放`);
    }
  }

  /** 当前所处环节快照，供三端展示 */
  async stageSnapshot() {
    const now = await this.getNow();
    const windows = await this.listWindows();
    const enriched = windows.map((w) => {
      const open = now >= w.startsAt && now <= w.endsAt;
      const phase = open ? 'OPEN' : now < w.startsAt ? 'UPCOMING' : 'CLOSED';
      return {
        id: w.id,
        stageKey: w.stageKey,
        stageLabel: STAGE_LABELS[w.stageKey] || w.stageKey,
        roundNo: w.roundNo,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        open,
        phase,
        remainingMs: open ? w.endsAt.getTime() - now.getTime() : 0,
      };
    });
    const openWindows = enriched.filter((w) => w.open);
    const business = openWindows.filter((w) => ['INTENT', 'INTERVIEW', 'CONFIRM', 'ADJUST'].includes(w.stageKey));
    return {
      now,
      activeStage: openWindows.length ? openWindows[0].stageKey : 'CLOSED',
      activeStageLabel: openWindows.length ? STAGE_LABELS[openWindows[0].stageKey] : '非环节开放时间',
      currentRound: await this.currentRound(),
      openWindows,
      windows: enriched,
      businessOpen: business,
    };
  }

  async currentRound(): Promise<number> {
    for (const roundNo of [1, 2, 3]) {
      if (
        (await this.isOpen('INTENT', roundNo)) ||
        (await this.isOpen('INTERVIEW', roundNo)) ||
        (await this.isOpen('CONFIRM', roundNo))
      ) {
        return roundNo;
      }
    }
    if (await this.isOpen('SUPPLEMENT', 2)) return 2;
    return 1;
  }

  async roundConfirmWindow(roundNo: number): Promise<StageWindow> {
    const w = await this.getWindow('CONFIRM', roundNo);
    if (!w) throw new NotFoundException(`第 ${roundNo} 轮确认环节尚未配置`);
    return w;
  }

  async requireRound(roundNo: number): Promise<void> {
    const r = await this.prisma.round.findUnique({ where: { roundNo } });
    if (!r) throw new NotFoundException(`第 ${roundNo} 轮不存在`);
  }

  async stageSnapshotAt(roundNo: number) {
    const confirm = await this.getWindow('CONFIRM', roundNo);
    const intent = await this.getWindow('INTENT', roundNo);
    const interview = await this.getWindow('INTERVIEW', roundNo);
    return { confirm, intent, interview };
  }
}
