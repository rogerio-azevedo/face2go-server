import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { StorageModule } from '../storage/storage.module';
import { FaceEnrollmentController } from './face-enrollment.controller';
import { MemberFaceEnrollmentController } from './member-face-enrollment.controller';
import { FaceEnrollmentService } from './face-enrollment.service';

@Module({
  imports: [DatabaseModule, StorageModule, FaceSyncModule],
  controllers: [FaceEnrollmentController, MemberFaceEnrollmentController],
  providers: [FaceEnrollmentService],
})
export class FaceEnrollmentModule {}
