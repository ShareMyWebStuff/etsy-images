export type PinterestEnvironment = 'production' | 'sandbox';
export type PinterestPinStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'PAUSED';
export type PinterestCampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';

export type PinterestPage<T> = { items: T[]; bookmark?: string | null };
export type PinterestAccount = { id: string; username?: string; account_type?: string; profile_image?: string };
export type PinterestBoardApi = { id: string; name: string; description?: string; privacy?: string; pin_count?: number };
export type PinterestPinApi = { id: string; board_id?: string; link?: string; title?: string; description?: string; media?: unknown };

export class PinterestApiError extends Error {
  constructor(message: string, public status: number, public code?: number, public retryAfter?: number) {
    super(message);
    this.name = 'PinterestApiError';
  }
}
