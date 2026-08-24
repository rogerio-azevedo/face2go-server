import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Namespace, Socket } from 'socket.io';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CompanyFeaturesService } from '../company-features/company-features.service';
import { PermissionsService } from '../permissions/permissions.service';
import type {
  EmergencyCheckinUpdatedPayload,
  EmergencyEventPayload,
} from './emergency-events.events';

type EmergencySocketData = {
  userId: string;
  companyId: string;
  name: string;
  role: string;
};

@WebSocketGateway({
  namespace: '/emergency',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class EmergencyGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EmergencyGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwtService: JwtService,
    private readonly permissionsService: PermissionsService,
    private readonly companyFeaturesService: CompanyFeaturesService,
  ) {}

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }
    return null;
  }

  private eventRoom(eventId: string): string {
    return `emergency:${eventId}`;
  }

  private async assertEmergencyAccess(
    payload: JwtPayload,
  ): Promise<string | null> {
    const companyId = payload.companyId ?? null;
    if (!companyId) return null;

    const companyEnabled = await this.companyFeaturesService.isEnabled(
      companyId,
      'presence',
    );
    if (!companyEnabled) return null;

    if (payload.role === 'company_admin') return companyId;
    if (payload.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        payload.role,
        payload.companyUserId,
        'presence',
        'can_read',
      );
      return ok ? companyId : null;
    }
    if (payload.role === 'client_admin' || payload.role === 'client_operator') {
      return companyId;
    }
    return null;
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const companyId = await this.assertEmergencyAccess(payload);
      if (!companyId) {
        client.disconnect(true);
        return;
      }

      const eventId =
        typeof client.handshake.query.eventId === 'string'
          ? client.handshake.query.eventId
          : null;
      if (!eventId) {
        client.disconnect(true);
        return;
      }

      client.data = {
        userId: payload.sub,
        companyId,
        name: payload.name ?? payload.email,
        role: payload.role,
      } satisfies EmergencySocketData;
      await client.join(this.eventRoom(eventId));
      this.logger.log(
        `Operador conectado ao emergency=${eventId} user=${payload.sub}`,
      );
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as EmergencySocketData | undefined;
    if (data?.userId) {
      this.logger.log(`Operador desconectado user=${data.userId}`);
    }
  }

  emitCheckinUpdated(payload: EmergencyCheckinUpdatedPayload): void {
    if (!this.server) return;
    this.server
      .to(this.eventRoom(payload.eventId))
      .emit('emergency:checkin-updated', payload);
  }

  emitEventSnapshot(eventId: string, payload: EmergencyEventPayload): void {
    if (!this.server) return;
    this.server.to(this.eventRoom(eventId)).emit('emergency:snapshot', payload);
  }
}
