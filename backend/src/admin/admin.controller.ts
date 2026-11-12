import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser } from '../common/types';
import { AdjustService } from './adjust.service';
import { AdminService } from './admin.service';
import { AdjustDto, ReconcileDto, SetClockDto, UpdateWindowDto, WithdrawDto } from './dto/admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly adjust: AdjustService,
  ) {}

  @Get('overview')
  overview(@Query('roundNo') roundNo?: string) {
    return this.admin.overview(roundNo ? Number(roundNo) : 0);
  }

  @Post('reconcile')
  reconcile(@CurrentUser() user: AuthUser, @Body() dto: ReconcileDto) {
    return this.admin.reconcile(dto.roundNo ?? 0, user);
  }

  @Get('anomalies')
  anomalies() {
    return this.admin.anomalies();
  }

  @Patch('anomalies/:id/resolve')
  resolveAnomaly(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.resolveAnomaly(id, user);
  }

  @Get('audit')
  audit(@Query('action') action?: string) {
    return this.admin.auditLogs(action);
  }

  @Get('publicity')
  publicity() {
    return this.admin.publicity();
  }

  @Post('withdrawals')
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: WithdrawDto) {
    return this.admin.withdraw(dto.offerId, dto.reason, dto.detail ?? '', user);
  }

  @Post('adjust')
  runAdjust(@CurrentUser() user: AuthUser, @Body() dto: AdjustDto) {
    return this.adjust.run(dto.level, user);
  }

  @Get('windows')
  windows() {
    return this.admin.windows();
  }

  @Patch('windows/:id')
  updateWindow(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateWindowDto) {
    return this.admin.updateWindow(id, dto.startsAt, dto.endsAt, user);
  }

  @Post('clock')
  setClock(@CurrentUser() user: AuthUser, @Body() dto: SetClockDto) {
    return this.admin.setClock(dto.now, user);
  }

  @Delete('clock')
  resetClock(@CurrentUser() user: AuthUser) {
    return this.admin.resetClock(user);
  }
}
