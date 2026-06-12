import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class SimulateFaceAccessDto {
  @ApiProperty({ description: 'ID do cliente (escola)' })
  @IsUUID()
  clientId!: string;

  @ApiProperty({
    description:
      'ID da pessoa (`students.id`, `responsibles.id` ou `client_members.id`)',
  })
  @IsUUID()
  personId!: string;

  @ApiProperty({ enum: ['student', 'responsible', 'member'] })
  @IsIn(['student', 'responsible', 'member'])
  personType!: 'student' | 'responsible' | 'member';

  @ApiProperty({
    required: false,
    description:
      'Leitor facial da escola (opcional). Sem valor, usa simulador sem direção.',
  })
  @IsOptional()
  @IsUUID()
  readerId?: string;
}
