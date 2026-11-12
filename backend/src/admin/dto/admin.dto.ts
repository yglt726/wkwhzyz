import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ReconcileDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  roundNo?: number;
}

export class AdjustDto {
  @IsInt()
  @Min(1)
  @Max(3)
  level: number;
}

export class WithdrawDto {
  @IsString()
  offerId: string;

  @IsIn(['CONFIRM_ABANDON', 'PUBLICITY_ABANDON', 'NO_SHOW', 'ADMIN_RELEASE'])
  reason: 'CONFIRM_ABANDON' | 'PUBLICITY_ABANDON' | 'NO_SHOW' | 'ADMIN_RELEASE';

  @IsOptional()
  @IsString()
  detail?: string;
}

export class UpdateWindowDto {
  @IsString()
  startsAt: string;

  @IsString()
  endsAt: string;
}

export class SetClockDto {
  @IsString()
  now: string;
}

export class ResolveAnomalyDto {
  @IsOptional()
  @IsBoolean()
  resolved?: boolean;
}
