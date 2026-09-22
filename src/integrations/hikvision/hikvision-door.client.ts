import type { AxiosResponse } from 'axios';

import type { HikvisionReaderConnection } from './hikvision-connection.types';
import {
  hikvisionFaceErrorMessage,
  isHikvisionSuccess,
} from './hikvision-error.util';
import { hikvisionIsapiRequest } from './hikvision-isapi-request';
import { mapReaderError } from '../intelbras/intelbras-device.client';

export const HIKVISION_REMOTE_OPEN_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<RemoteControlDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">' +
  '<cmd>open</cmd>' +
  '</RemoteControlDoor>';

export function hikvisionOpenDoorUrl(
  connection: Pick<HikvisionReaderConnection, 'baseUrl'>,
  doorNo = 1,
): string {
  return `${connection.baseUrl.replace(/\/$/, '')}/ISAPI/AccessControl/RemoteControl/door/${doorNo}`;
}

export async function hikvisionOpenDoor(
  connection: HikvisionReaderConnection,
  doorNo = 1,
): Promise<void> {
  const url = hikvisionOpenDoorUrl(connection, doorNo);
  let response: AxiosResponse<unknown>;
  try {
    response = await hikvisionIsapiRequest(connection, {
      method: 'PUT',
      url,
      headers: { 'Content-Type': 'application/xml' },
      data: HIKVISION_REMOTE_OPEN_XML,
    });
  } catch (err: unknown) {
    throw new Error(mapReaderError(err));
  }
  if (!isHikvisionSuccess(response.data)) {
    throw new Error(
      hikvisionFaceErrorMessage({ response: { data: response.data } }) ||
        'Falha ao acionar a porta do leitor.',
    );
  }
}
