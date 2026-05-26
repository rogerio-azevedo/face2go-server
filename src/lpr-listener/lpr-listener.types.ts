/** Estado in-memory por câmera LPR (stream + digest — senha só em RAM). */
export type CameraStreamContext = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  companyId: string;
  brand: string;
  host: string;
  username: string;
  passwordPlain: string;
};

export type CameraListenerStatus = {
  cameraId: string;
  cameraName: string;
  clientName: string;
  brand: string;
  host: string;
  connected: boolean;
  eventsReceived: number;
  lastEventAt?: Date;
  connectedSince?: Date;
  lastConnectionError?: string;
};

export type CameraMonitorDeviceRow = {
  cameraId: string;
  cameraName: string;
  clientName: string;
  type: string;
  brand: string;
  host: string;
  isActive: boolean;
  hasCredentials: boolean;
  streamSupported: boolean;
  connected: boolean;
  eventsReceived: number;
  lastEventAt: Date | null;
  connectedSince: Date | null;
  lastConnectionError: string | null;
  lastSeenAt: Date | null;
};

export type CameraMonitorStatusReport = {
  devices: CameraMonitorDeviceRow[];
  summary: {
    total: number;
    connected: number;
    disconnected: number;
  };
};
