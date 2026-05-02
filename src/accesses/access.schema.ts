import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FacialAccessDocument = HydratedDocument<FacialAccess>;

@Schema({ timestamps: true, collection: 'facial_accesses' })
export class FacialAccess {
  @Prop({ required: true, index: true })
  companyId: string;

  @Prop({ required: true, index: true })
  readerId: string;

  @Prop({ required: true })
  readerName: string;

  @Prop({ required: true, index: true })
  clientId: string;

  @Prop({ required: true })
  clientName: string;

  /** Face ID numérico no leitor (mesmo escopo do cliente). */
  @Prop({ required: true })
  userId: number;

  @Prop({ type: String, default: null })
  personName: string | null;

  @Prop({ required: true })
  eventCode: string;

  @Prop({ required: true })
  eventAction: string;

  @Prop({ type: Number, default: null })
  similarity: number | null;

  @Prop({ type: Date, default: null })
  eventDate: Date | null;
}

export const FacialAccessSchema = SchemaFactory.createForClass(FacialAccess);

FacialAccessSchema.index({ companyId: 1, createdAt: -1 });
FacialAccessSchema.index({ companyId: 1, clientId: 1, createdAt: -1 });
