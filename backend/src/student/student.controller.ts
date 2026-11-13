import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RESUME_DIR, RESUME_MAX_SIZE } from '../common/resume';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types';
import { SubmitIntentsDto } from './dto/submit-intents.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { StudentService } from './student.service';

@Controller('student')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STUDENT')
export class StudentController {
  constructor(private readonly student: StudentService) {}

  @Get('profile')
  getProfile(@CurrentUser() user: AuthUser) {
    return this.student.getProfile(user.sub);
  }

  @Put('profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.student.updateProfile(user.sub, dto, user);
  }

  @Post('profile/resume')
  @UseInterceptors(FileInterceptor('file', { dest: RESUME_DIR, limits: { fileSize: RESUME_MAX_SIZE } }))
  uploadResume(@CurrentUser() user: AuthUser, @UploadedFile() file: any) {
    return this.student.uploadResume(user.sub, file, user);
  }

  @Get('profile/resume')
  async downloadResume(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const { absPath, name } = await this.student.resumeForStudent(user.sub);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.sendFile(absPath);
  }

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
