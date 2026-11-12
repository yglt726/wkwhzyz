import { Global, Module } from '@nestjs/common';
import { AuditService } from './services/audit.service';
import { CacheService } from './services/cache.service';
import { LockService } from './services/lock.service';
import { TimeService } from './services/time.service';

@Global()
@Module({
  providers: [TimeService, LockService, CacheService, AuditService],
  exports: [TimeService, LockService, CacheService, AuditService],
})
export class CommonModule {}
