import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PermissionsService } from '../permissions/permissions.service';
import type { ReaderOfflineDetectedEvent } from '../face-listener/face-listener.events';
import type {
  PanicCreatedEvent,
  PanicEventPayload,
  PanicUpdatedEvent,
} from '../panic-events/panic-events.events';

type MonitoringAccess = {
  companyId: string;
  clientId: string | null;
  room: string;
};

type MonitoringSocketData = {
  userId: string;
  companyId: string;
  clientId: string | null;
  name: string;
  role: string;
  room: string;
};

@WebSocketGateway({
  namespace: '/monitoring',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class MonitoringGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(MonitoringGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwtService: JwtService,
    private readonly permissionsService: PermissionsService,
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

  private companyRoom(companyId: string): string {
    return `company:${companyId}`;
  }

  private clientRoom(clientId: string): string {
    return `client:${clientId}`;
  }

  private async assertMonitoringAccess(
    payload: JwtPayload,
  ): Promise<MonitoringAccess | null> {
    const companyId = payload.companyId ?? null;

    if (payload.role === 'client_admin' || payload.role === 'client_operator') {
      const clientId = payload.clientId ?? null;
      if (!clientId || !companyId) return null;
      return {
        companyId,
        clientId,
        room: this.clientRoom(clientId),
      };
    }

    if (!companyId) return null;
    if (payload.role === 'company_admin') {
      return { companyId, clientId: null, room: this.companyRoom(companyId) };
    }
    if (payload.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        payload.role,
        payload.companyUserId,
        'monitoring',
        'can_read',
      );
      return ok
        ? { companyId, clientId: null, room: this.companyRoom(companyId) }
        : null;
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
      const access = await this.assertMonitoringAccess(payload);
      if (!access) {
        client.disconnect(true);
        return;
      }

      const data: MonitoringSocketData = {
        userId: payload.sub,
        companyId: access.companyId,
        clientId: access.clientId,
        name: payload.name ?? payload.email,
        role: payload.role,
        room: access.room,
      };
      client.data = data;
      await client.join(access.room);
      if (!access.clientId) {
        this.broadcastPresence(access.companyId);
      }
      this.logger.log(
        `Operador conectado user=${data.userId} company=${access.companyId}` +
          (access.clientId ? ` client=${access.clientId}` : ''),
      );
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as MonitoringSocketData | undefined;
    if (!data?.companyId) return;
    if (!data.clientId) {
      try {
        this.broadcastPresence(data.companyId);
      } catch (err) {
        this.logger.warn(
          `Falha ao emitir presença no disconnect user=${data.userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    this.logger.log(
      `Operador desconectado user=${data.userId} company=${data.companyId}` +
        (data.clientId ? ` client=${data.clientId}` : ''),
    );
  }

  private broadcastPresence(companyId: string): void {
    if (!this.server?.adapter?.rooms) return;

    const room = this.companyRoom(companyId);
    const sockets = this.server.adapter.rooms.get(room);
    const count = sockets?.size ?? 0;
    this.server.to(room).emit('panic:operators-presence', {
      companyId,
      onlineCount: count,
    });
  }

  emitToCompany(companyId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to(this.companyRoom(companyId)).emit(event, payload);
  }

  emitPanicNew(payload: PanicCreatedEvent): void {
    this.emitToCompany(payload.event.companyId, 'panic:new', payload.event);
  }

  emitPanicUpdated(payload: PanicUpdatedEvent): void {
    this.emitToCompany(payload.event.companyId, 'panic:updated', payload);
  }

  emitReaderOffline(payload: ReaderOfflineDetectedEvent): void {
    if (!this.server) return;
    this.server
      .to(this.clientRoom(payload.clientId))
      .emit('reader:offline', payload);
  }
}

export type { PanicEventPayload };
