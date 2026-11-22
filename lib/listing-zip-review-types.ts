import type { SubSectionListingsPageData } from '@/lib/listing-table';

export type ListingZipReviewItem = {
  index: number;
  rowNumber: number;
  title: string;
  description: string;
  relativeFilename: string;
  originalFileName: string;
  width: number | null;
  height: number | null;
  orientation: 'portrait' | 'landscape' | null;
  error: string | null;
};

export type ListingZipReviewState = {
  sessionId: string;
  templateName: string;
  total: number;
  cursor: number;
  insertedCount: number;
  skippedCount: number;
  expiresAt: string;
  current: ListingZipReviewItem | null;
};

export type ListingZipReviewResponse = {
  review: ListingZipReviewState;
  data?: SubSectionListingsPageData | null;
  refreshError?: string;
};

export type ListingZipReviewSummary = {
  insertedCount: number;
  skippedCount: number;
  totalCount: number;
  unconfirmed?: boolean;
};
