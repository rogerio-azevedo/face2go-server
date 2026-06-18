import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../common/decorators/roles.decorator';
import { GeocodingService } from './geocoding.service';

@ApiTags('geocoding')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('geocoding')
export class GeocodingController {
  constructor(private readonly geocodingService: GeocodingService) {}

  @Get('autocomplete')
  @ApiOperation({ summary: 'Autocomplete de endereço via HERE (proxy)' })
  autocomplete(
    @Query('q') q: string,
    @Query('at') at?: string,
  ) {
    return this.geocodingService.autocomplete(q, at);
  }

  @Get('geocode')
  @ApiOperation({ summary: 'Geocodificar endereço via HERE (proxy)' })
  geocode(@Query('q') q: string) {
    return this.geocodingService.geocode(q);
  }

  @Get('reverse')
  @ApiOperation({ summary: 'Reverse geocoding via HERE (proxy)' })
  reverse(@Query('at') at: string) {
    return this.geocodingService.reverse(at);
  }

  @Get('lookup')
  @ApiOperation({ summary: 'Lookup de local HERE por id (proxy)' })
  lookup(@Query('id') id: string) {
    return this.geocodingService.lookup(id);
  }
}
