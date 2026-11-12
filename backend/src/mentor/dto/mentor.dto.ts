import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ScoreInterviewDto {
  @IsString()
  studentId: string;

  @IsInt()
  @Min(1)
  @Max(3)
  roundNo: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  attitude?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  logic?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  coding?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  timeInvest?: number;

  @IsOptional()
  @IsBoolean()
  absent?: boolean;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class PublishOffersDto {
  @IsInt()
  @Min(1)
  @Max(3)
  roundNo: number;

  @IsArray()
  @IsString({ each: true })
  primary: string[];

  @IsArray()
  @IsString({ each: true })
  waitlist: string[];

  @IsOptional()
  @IsBoolean()
  overQuotaConfirm?: boolean;

  /** 室内调剂候选（顺序即优先顺位）；不传则默认使用系统自动生成结果 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labAdjustCandidates?: string[];
}
