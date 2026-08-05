import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FacialAccessDocument = HydratedDocument<FacialAccess>;

@Schema({ timestamps: true, collection: 'facial_accesses' })
export class FacialAccess {
  @Prop({ type: String, required: true, index: true })
  companyId!: string;

  @Prop({ type: String, required: true, index: true })
  readerId!: string;

  @Prop({ type: String, required: true })
  readerName!: string;

  @Prop({ type: String, required: true, index: true })
  clientId!: string;

  @Prop({ type: String, required: true })
  clientName!: string;

  /** Face ID numérico no leitor (mesmo escopo do cliente). */
  @Prop({ type: Number, required: true })
  userId!: number;

  @Prop({ type: String, default: null })
  personName!: string | null;

  @Prop({ type: String, default: null })
  personId!: string | null;

  @Prop({ type: String, default: null })
  personType!: 'student' | 'responsible' | 'member' | 'guest' | null;

  @Prop({ type: String, required: true })
  eventCode!: string;

  @Prop({ type: String, required: true })
  eventAction!: string;

  @Prop({ type: Number, default: null })
  similarity!: number | null;

  @Prop({ type: Date, default: null })
  eventDate!: Date | null;

  /** URL/path da captura enviada pelo leitor (Intelbras `SnapPath`). */
  @Prop({ type: String, default: null })
  snapPath!: string | null;

  /** Chave no R2 da foto capturada (stream SnapManager). */
  @Prop({ type: String, default: null })
  snapR2Key!: string | null;

  /** Sentido do leitor no momento do acesso (`in` = entrada, `out` = saída). */
  @Prop({ type: String, default: null })
  readerDirection!: 'in' | 'out' | null;

  /** Id de correlação do evento no leitor (idempotência Start/Pulse). */
  @Prop({ type: String, default: null })
  correlationId!: string | null;
}

export const FacialAccessSchema = SchemaFactory.createForClass(FacialAccess);

FacialAccessSchema.index({ companyId: 1, createdAt: -1 });
FacialAccessSchema.index({ companyId: 1, clientId: 1, createdAt: -1 });
FacialAccessSchema.index(
  { readerId: 1, correlationId: 1 },
  { unique: true, sparse: true },
);
