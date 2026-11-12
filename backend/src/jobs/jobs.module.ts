import { Module } from '@nestjs/common';
import { OfferModule } from '../offers/offer.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [OfferModule],
  providers: [JobsService],
})
export class JobsModule {}
