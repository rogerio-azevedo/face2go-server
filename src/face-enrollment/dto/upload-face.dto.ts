import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadFaceDto {
  @ApiProperty({
    description:
      'Imagem JPEG em base64 (opcional prefixo data:image/jpeg;base64,)',
    example: '/9j/4AAQSkZJRg...',
  })
  @IsString()
  @MinLength(64)
  imageBase64!: string;
}
