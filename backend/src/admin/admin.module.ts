import { Module } from '@nestjs/common';
import { OfferModule } from '../offers/offer.module';
import { AdjustService } from './adjust.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [OfferModule],
  controllers: [AdminController],
  providers: [AdminService, AdjustService],
})
export class AdminModule {}
