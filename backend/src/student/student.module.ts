import { Module } from '@nestjs/common';
import { OfferModule } from '../offers/offer.module';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';

@Module({
  imports: [OfferModule],
  controllers: [StudentController],
  providers: [StudentService],
})
export class StudentModule {}
