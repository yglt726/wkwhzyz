import 'dotenv/config';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { MetaModule } from './meta/meta.module';
import { OfferModule } from './offers/offer.module';
import { StudentModule } from './student/student.module';
import { MentorModule } from './mentor/mentor.module';
import { AdminModule } from './admin/admin.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'lab-selection-dev-secret',
      signOptions: { expiresIn: '12h' },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,
    AuthModule,
    MetaModule,
    OfferModule,
    StudentModule,
    MentorModule,
    AdminModule,
    JobsModule,
  ],
})
export class AppModule {}
