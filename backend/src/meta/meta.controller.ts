import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MetaService } from './meta.service';

@Controller('meta')
export class MetaController {
  constructor(private readonly meta: MetaService) {}

  @Get('health')
  health() {
    return { ok: true, service: 'lab-selection', time: new Date().toISOString() };
  }

  @Get('bootstrap')
  @UseGuards(JwtAuthGuard)
  bootstrap(@Query('roundNo') roundNo?: string) {
    return this.meta.bootstrap(roundNo ? Number(roundNo) : undefined);
  }

  @Get('labs')
  @UseGuards(JwtAuthGuard)
  labs(@Query('roundNo') roundNo?: string) {
    return this.meta.labsWithPopularity(roundNo ? Number(roundNo) : 0);
  }
}
