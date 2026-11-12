import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/services/audit.service';
import { AuthUser } from '../common/types';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user || !user.active) throw new UnauthorizedException('账号或密码错误');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('账号或密码错误');

    const payload: AuthUser = {
      sub: user.id,
      username: user.username,
      name: user.name,
      role: user.role as AuthUser['role'],
      mentorId: user.mentorId,
    };
    const token = await this.jwt.signAsync(payload);
    const profile = await this.buildProfile(user);
    await this.audit.log({
      actor: payload,
      action: 'LOGIN',
      entityType: 'USER',
      entityId: user.id,
      detail: { username: user.username, role: user.role },
    });
    return { token, user: profile };
  }

  async me(auth: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.sub } });
    if (!user || !user.active) throw new UnauthorizedException('用户不存在或已停用');
    return this.buildProfile(user);
  }

  private async buildProfile(user: User) {
    let labId: string | null = null;
    let labName: string | null = null;
    let mentorQuota: number | null = null;
    let mentorTitle: string | null = null;
    if (user.mentorId) {
      const mentor = await this.prisma.mentor.findUnique({ where: { id: user.mentorId } });
      if (mentor) {
        labId = mentor.labId;
        mentorQuota = mentor.quota;
        mentorTitle = mentor.title;
        const lab = await this.prisma.lab.findUnique({ where: { id: mentor.labId } });
        labName = lab?.name ?? null;
      }
    }
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      studentNo: user.studentNo,
      mentorId: user.mentorId,
      mentorQuota,
      mentorTitle,
      labId,
      labName,
    };
  }
}
