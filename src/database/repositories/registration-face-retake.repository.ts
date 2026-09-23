import { Injectable } from '@nestjs/common';

import * as registrationsQueries from '../queries/registrations.queries';
import * as faceRetakeQueries from '../queries/registration-face-retake.queries';
import { BaseRepository } from './base.repository';

@Injectable()
export class RegistrationFaceRetakeRepository extends BaseRepository {
  findRegistration(clientId: string, registrationId: string) {
    return registrationsQueries.getRegistrationByIdForClient(
      this.db,
      registrationId,
      clientId,
    );
  }

  findBundleByCode(code: string) {
    return faceRetakeQueries.getFaceRetakeBundleByCode(this.db, code);
  }

  insertReplacingOpen(
    input: Parameters<
      typeof faceRetakeQueries.insertFaceRetakeLinkReplacingOpen
    >[1],
  ) {
    return faceRetakeQueries.insertFaceRetakeLinkReplacingOpen(this.db, input);
  }

  consumeAndSetFace(code: string, faceImageKey: string) {
    return faceRetakeQueries.consumeFaceRetakeAndSetPhoto(
      this.db,
      code,
      faceImageKey,
    );
  }
}
