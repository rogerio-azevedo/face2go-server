import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type PanicEventDocument = HydratedDocument<PanicEvent>;

@Schema({ _id: false })
export class PanicActor {
  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  role!: string;
}

@Schema({ _id: false })
export class PanicLocation {
  @Prop({ type: Number, required: true })
  latitude!: number;

  @Prop({ type: Number, required: true })
  longitude!: number;

  @Prop({ type: Number, default: null })
  accuracy!: number | null;

  @Prop({ type: Date, required: true })
  capturedAt!: Date;

  @Prop({ type: String, required: true, default: 'mobile_gps' })
  source!: string;
}

@Schema({ _id: false })
export class PanicDeviceInfo {
  @Prop({ type: String, default: null })
  os!: string | null;

  @Prop({ type: String, default: null })
  appVersion!: string | null;

  @Prop({ type: String, default: null })
  brand!: string | null;
}

@Schema({ _id: false })
export class PanicHistoryEntry {
  @Prop({ type: String, required: true })
  action!: string;

  @Prop({ type: String, required: true })
  byUserId!: string;

  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  meta!: Record<string, unknown> | null;
}

@Schema({ timestamps: true, collection: 'panic_events' })
export class PanicEvent {
  @Prop({ type: String, required: true, index: true })
  companyId!: string;

  @Prop({ type: String, required: true, index: true })
  clientId!: string;

  @Prop({ type: String, required: true })
  clientName!: string;

  @Prop({ type: String, required: true, default: 'panic' })
  eventType!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['open', 'claimed', 'closed'],
    default: 'open',
    index: true,
  })
  status!: 'open' | 'claimed' | 'closed';

  @Prop({ type: String, required: true })
  requesterUserId!: string;

  @Prop({ type: String, default: null })
  requesterMemberId!: string | null;

  @Prop({ type: String, required: true })
  requesterName!: string;

  @Prop({ type: String, required: true })
  requesterRole!: string;

  @Prop({ type: String, default: null })
  requesterPushToken!: string | null;

  @Prop({ type: PanicLocation, required: true })
  location!: PanicLocation;

  @Prop({ type: PanicDeviceInfo, default: null })
  deviceInfo!: PanicDeviceInfo | null;

  @Prop({ type: Date, required: true, default: () => new Date() })
  receivedAt!: Date;

  @Prop({ type: Date, default: null })
  firstViewedAt!: Date | null;

  @Prop({ type: Date, default: null })
  claimedAt!: Date | null;

  @Prop({ type: Date, default: null })
  releasedAt!: Date | null;

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  @Prop({ type: PanicActor, default: null })
  claimedBy!: PanicActor | null;

  @Prop({ type: PanicActor, default: null })
  closedBy!: PanicActor | null;

  @Prop({ type: String, default: null })
  closingNotes!: string | null;

  @Prop({
    type: String,
    enum: ['resolved', 'false_alarm', 'duplicate', 'other'],
    default: null,
  })
  closingReason!: string | null;

  @Prop({ type: [PanicHistoryEntry], default: [] })
  history!: PanicHistoryEntry[];
}

export const PanicEventSchema = SchemaFactory.createForClass(PanicEvent);

PanicEventSchema.index({ companyId: 1, status: 1, receivedAt: -1 });
PanicEventSchema.index({ companyId: 1, clientId: 1, receivedAt: -1 });
PanicEventSchema.index({ requesterUserId: 1, receivedAt: -1 });
