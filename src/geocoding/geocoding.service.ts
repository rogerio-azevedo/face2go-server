import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvVars } from '../config/env.validation';
import type { NormalizedGeocodingResult } from '../validation/geocoding.schema';

type CacheEntry = {
  expiresAt: number;
  data: unknown;
};

type HereAddress = {
  label?: string;
  postalCode?: string;
  street?: string;
  houseNumber?: string;
  district?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  countryCode?: string;
};

type HerePosition = {
  lat: number;
  lng: number;
};

type HereResultType = 'houseNumber' | 'street' | 'locality' | string;

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 60_000;

  constructor(
    private readonly configService: ConfigService<EnvVars, true>,
  ) {}

  private get apiKey(): string | undefined {
    return this.configService.get('HERE_API_KEY', { infer: true });
  }

  private get discoverBaseUrl(): string {
    return (
      this.configService.get('HERE_DISCOVER_BASE_URL', { infer: true }) ??
      'https://discover.search.hereapi.com/v1'
    );
  }

  private get geocodeBaseUrl(): string {
    return (
      this.configService.get('HERE_GEOCODE_BASE_URL', { infer: true }) ??
      'https://geocode.search.hereapi.com/v1'
    );
  }

  private ensureConfigured(): string {
    const key = this.apiKey;
    if (!key) {
      throw new ServiceUnavailableException(
        'Serviço de geocoding indisponível. Configure HERE_API_KEY no servidor.',
      );
    }
    return key;
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache(key: string, data: unknown): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  private async fetchHere<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(`HERE API error ${response.status}: ${body.slice(0, 300)}`);
      throw new ServiceUnavailableException(
        'Serviço de geocoding temporariamente indisponível.',
      );
    }
    return (await response.json()) as T;
  }

  private mapPrecision(resultType?: HereResultType) {
    if (resultType === 'houseNumber') return 'rooftop' as const;
    if (resultType === 'street') return 'street' as const;
    return 'approximate' as const;
  }

  private normalizeCountryCode(code?: string): string {
    if (!code) return 'BR';
    const upper = code.trim().toUpperCase();
    if (upper === 'BRA' || upper === 'BR') return 'BR';
    return upper.slice(0, 2);
  }

  private normalizeAddress(address?: HereAddress) {
    return {
      cep: address?.postalCode,
      street: address?.street,
      number: address?.houseNumber,
      neighborhood: address?.district,
      city: address?.city,
      state: address?.stateCode ?? address?.state,
      country: this.normalizeCountryCode(address?.countryCode),
    };
  }

  private normalizeItem(item: {
    id?: string;
    title?: string;
    resultType?: HereResultType;
    address?: HereAddress;
    position?: HerePosition;
  }): NormalizedGeocodingResult | null {
    if (!item.id || !item.position) return null;
    return {
      id: item.id,
      label: item.title ?? item.address?.label ?? 'Endereço',
      address: this.normalizeAddress(item.address),
      latitude: item.position.lat,
      longitude: item.position.lng,
      precision: this.mapPrecision(item.resultType),
    };
  }

  async autocomplete(q: string, at?: string) {
    const cacheKey = `autocomplete:${q}:${at ?? ''}`;
    const cached = this.getCached<NormalizedGeocodingResult[]>(cacheKey);
    if (cached) return { items: cached };

    const apiKey = this.ensureConfigured();
    const params = new URLSearchParams({
      q,
      apiKey,
      lang: 'pt-BR',
      in: 'countryCode:BRA',
      limit: '8',
    });
    if (at) params.set('at', at);

    const url = `${this.discoverBaseUrl}/autosuggest?${params.toString()}`;
    const data = await this.fetchHere<{ items?: unknown[] }>(url);
    const items = (data.items ?? [])
      .map((item) =>
        this.normalizeItem(
          item as {
            id?: string;
            title?: string;
            resultType?: HereResultType;
            address?: HereAddress;
            position?: HerePosition;
          },
        ),
      )
      .filter((item): item is NormalizedGeocodingResult => item !== null);

    this.setCache(cacheKey, items);
    return { items };
  }

  async geocode(q: string) {
    const cacheKey = `geocode:${q}`;
    const cached = this.getCached<NormalizedGeocodingResult[]>(cacheKey);
    if (cached) return { items: cached };

    const apiKey = this.ensureConfigured();
    const params = new URLSearchParams({
      q,
      apiKey,
      lang: 'pt-BR',
      in: 'countryCode:BRA',
      limit: '5',
    });
    const url = `${this.geocodeBaseUrl}/geocode?${params.toString()}`;
    const data = await this.fetchHere<{ items?: unknown[] }>(url);
    const items = (data.items ?? [])
      .map((item) =>
        this.normalizeItem(
          item as {
            id?: string;
            title?: string;
            resultType?: HereResultType;
            address?: HereAddress;
            position?: HerePosition;
          },
        ),
      )
      .filter((item): item is NormalizedGeocodingResult => item !== null);

    this.setCache(cacheKey, items);
    return { items };
  }

  async reverse(at: string) {
    const cacheKey = `reverse:${at}`;
    const cached = this.getCached<NormalizedGeocodingResult | null>(cacheKey);
    if (cached !== null) return { item: cached };

    const apiKey = this.ensureConfigured();
    const params = new URLSearchParams({
      at,
      apiKey,
      lang: 'pt-BR',
      limit: '1',
    });
    const url = `${this.geocodeBaseUrl}/revgeocode?${params.toString()}`;
    const data = await this.fetchHere<{ items?: unknown[] }>(url);
    const first = data.items?.[0];
    const item = first
      ? this.normalizeItem(
          first as {
            id?: string;
            title?: string;
            resultType?: HereResultType;
            address?: HereAddress;
            position?: HerePosition;
          },
        )
      : null;

    this.setCache(cacheKey, item);
    return { item };
  }

  async lookup(id: string) {
    const cacheKey = `lookup:${id}`;
    const cached = this.getCached<NormalizedGeocodingResult | null>(cacheKey);
    if (cached !== null) return { item: cached };

    const apiKey = this.ensureConfigured();
    const params = new URLSearchParams({ id, apiKey, lang: 'pt-BR' });
    const url = `${this.geocodeBaseUrl}/lookup?${params.toString()}`;
    const data = await this.fetchHere<{ items?: unknown[] }>(url);
    const first = data.items?.[0];
    const item = first
      ? this.normalizeItem(
          first as {
            id?: string;
            title?: string;
            resultType?: HereResultType;
            address?: HereAddress;
            position?: HerePosition;
          },
        )
      : null;

    this.setCache(cacheKey, item);
    return { item };
  }
}
