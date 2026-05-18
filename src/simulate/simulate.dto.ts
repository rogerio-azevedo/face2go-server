import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';

export class SimulateFaceAccessDto {
  @ApiProperty({ description: 'ID do cliente (escola)' })
  @IsUUID()
  clientId!: string;

  @ApiProperty({
    description: 'ID da pessoa (`students.id` ou `responsibles.id`)',
  })
  @IsUUID()
  personId!: string;

  @ApiProperty({ enum: ['student', 'responsible'] })
  @IsIn(['student', 'responsible'])
  personType!: 'student' | 'responsible';
}
