import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types';
import { SubmitIntentsDto } from './dto/submit-intents.dto';
import { StudentService } from './student.service';

@Controller('student')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class StudentController {
  constructor(private readonly student: StudentService) {}

  @Get('intents')
  getIntents(@CurrentUser() user: AuthUser, @Query('roundNo') roundNo?: string) {
    return this.student.getIntents(user.sub, roundNo ? Number(roundNo) : 1);
  }

  @Post('intents')
  submitIntents(@CurrentUser() user: AuthUser, @Body() dto: SubmitIntentsDto) {
    return this.student.submitIntents(user.sub, dto, user);
  }

  @Get('offers')
  getOffers(@CurrentUser() user: AuthUser, @Query('roundNo') roundNo?: string) {
    return this.student.getOffers(user.sub, roundNo ? Number(roundNo) : undefined);
  }

  @Post('offers/:id/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.student.confirm(user.sub, id, user);
  }

  @Post('offers/:id/decline')
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.student.decline(user.sub, id, user);
  }

  @Get('result')
  result(@CurrentUser() user: AuthUser) {
    return this.student.result(user.sub);
  }
}
