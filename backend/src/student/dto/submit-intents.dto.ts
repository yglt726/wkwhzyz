import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsString, Max, Min } from 'class-validator';

export class SubmitIntentsDto {
  @IsInt()
  @Min(1)
  @Max(3)
  roundNo: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  mentorIds: string[];

  @IsBoolean()
  acceptLabAdjust: boolean;

  @IsBoolean()
  acceptCollegeAdjust: boolean;
}
