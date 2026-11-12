import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OfferService } from '../offers/offer.service';

@Injectable()
export class JobsService implements OnModuleInit {
  private running = false;

  constructor(private readonly offers: OfferService) {}

  onModuleInit() {
    setTimeout(() => void this.tick(), 1000);
  }

  /** 系统定时任务角色：到期失效 → 递补；确认窗内单 offer 自动确认 */
  @Interval(20000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.offers.expireDueOffers();
      const autoConfirmed = await this.offers.sweepAutoConfirm();
      if (expired > 0 || autoConfirmed > 0) {
        // eslint-disable-next-line no-console
        console.log(`[jobs] 逾期失效 ${expired} 条，自动确认 ${autoConfirmed} 条`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[jobs] tick 失败', e);
    } finally {
      this.running = false;
    }
  }
}
