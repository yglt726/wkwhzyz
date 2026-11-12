import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types';
import { PublishOffersDto, ScoreInterviewDto } from './dto/mentor.dto';
import { MentorService } from './mentor.service';

@Controller('mentor')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('MENTOR')
export class MentorController {
  constructor(private readonly mentor: MentorService) {}

  @Get('applicants')
  applicants(@CurrentUser() user: AuthUser, @Query('roundNo') roundNo?: string) {
    return this.mentor.applicants(user, roundNo ? Number(roundNo) : 1);
  }

  @Post('interviews/score')
  score(@CurrentUser() user: AuthUser, @Body() dto: ScoreInterviewDto) {
    return this.mentor.score(user, dto);
  }

  @Get('quota')
  quota(@CurrentUser() user: AuthUser, @Query('roundNo') roundNo?: string) {
    return this.mentor.quota(user, roundNo ? Number(roundNo) : 1);
  }

  @Get('offers')
  offers(@CurrentUser() user: AuthUser, @Query('roundNo') roundNo?: string) {
    return this.mentor.getOffers(user, roundNo ? Number(roundNo) : 1);
  }

  @Post('offers/publish')
  publish(@CurrentUser() user: AuthUser, @Body() dto: PublishOffersDto) {
    return this.mentor.publish(user, dto);
  }
}
