import { Module } from '@nestjs/common';
import { MetaModule } from '../meta/meta.module';
import { OfferModule } from '../offers/offer.module';
import { MentorController } from './mentor.controller';
import { MentorService } from './mentor.service';

@Module({
  imports: [OfferModule, MetaModule],
  controllers: [MentorController],
  providers: [MentorService],
})
export class MentorModule {}
