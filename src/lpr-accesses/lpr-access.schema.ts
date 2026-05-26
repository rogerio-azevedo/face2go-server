import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

@Schema({
  timestamps: true,
  collection: 'lpr_accesses',
})
export class LprAccess {
  @Prop({ type: String, required: true, index: true })
  companyId!: string;

  @Prop({ type: String, required: true, index: true })
  cameraId!: string;

  @Prop({ type: String, required: true })
  cameraName!: string;

  @Prop({ type: String, required: true })
  clientId!: string;

  @Prop({ type: String, required: true })
  clientName!: string;

  @Prop({ type: String, default: null })
  deviceIdReported!: string | null;

  @Prop({ type: String, required: true, index: true })
  plateNumber!: string;

  @Prop({ type: String, default: null })
  plateColor!: string | null;

  @Prop({ type: String, default: null })
  plateType!: string | null;

  @Prop({ type: Number, default: null })
  confidence!: number | null;

  @Prop({ type: String, default: null })
  vehicleColor!: string | null;

  @Prop({ type: String, default: null })
  vehicleType!: string | null;

  @Prop({ type: String, default: null })
  vehicleBrand!: string | null;

  @Prop({ type: Number, default: null })
  speed!: number | null;

  @Prop({ type: String, default: null })
  direction!: string | null;

  @Prop({ type: Number, default: null })
  laneNo!: number | null;

  @Prop({ type: Number, default: null })
  channel!: number | null;

  @Prop({ type: Date, default: null })
  snapTime!: Date | null;

  @Prop({ type: Date, default: null })
  accurateTime!: Date | null;

  @Prop({ type: Boolean, default: null })
  isAllowed!: boolean | null;

  @Prop({ type: Boolean, default: null })
  isBlocked!: boolean | null;

  @Prop({ type: Boolean, default: null })
  openStrobe!: boolean | null;

  /** Chaves R2 (JPEG), quando há multipart. Ordem: corte → veículo → cena completa. */
  @Prop({ type: String, default: null })
  cutoutPicKey!: string | null;

  @Prop({ type: String, default: null })
  vehiclePicKey!: string | null;

  @Prop({ type: String, default: null })
  normalPicKey!: string | null;

  @Prop({ type: SchemaTypes.Mixed, default: null })
  rawPayload!: Record<string, unknown> | null;

  /**
   * ID do evento reportado pela câmera (EventID). Presente nos dois streams
   * (eventManager e snapManager) com o mesmo valor para o mesmo evento físico.
   * Usado como chave de correlação no upsert — garante que dados JSON e imagem
   * do mesmo veículo sempre ficam no mesmo documento.
   */
  @Prop({ type: String, default: null })
  correlationEventId!: string | null;
}

export type LprAccessDocument = HydratedDocument<LprAccess>;

export const LprAccessSchema = SchemaFactory.createForClass(LprAccess);

// Índice unique sparse: impede dois documentos para o mesmo evento físico
// (eventManager + snapManager). sparse=true porque docs legados terão null.
LprAccessSchema.index(
  { cameraId: 1, correlationEventId: 1 },
  { unique: true, sparse: true },
);
