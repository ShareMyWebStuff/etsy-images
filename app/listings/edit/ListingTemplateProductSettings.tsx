'use client';

import {
  effectiveListingTemplateSettings,
  type ListingTemplateOverrides,
  type ListingTemplateSettings,
} from '@/lib/listing-template-settings';
import type { ListingCustomisationSettings } from '@/lib/listing-customisation';

type Props = {
  template: (ListingTemplateSettings & Partial<ListingCustomisationSettings>) | null;
  listing: ListingTemplateOverrides;
  saving: boolean;
  onChange: (key: keyof ListingTemplateSettings, checked: boolean) => void;
};

const OPTIONS = [
  { key: 'printsFrames', label: 'Print / Frames' },
  { key: 'customisePrints', label: 'Customised Prints' },
  { key: 'digitalDownload', label: 'Digital Downloads' },
] as const;

export function ListingTemplateProductSettings({ template, listing, saving, onChange }: Props) {
  const settings = effectiveListingTemplateSettings(template, listing);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {OPTIONS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={settings[key]}
              disabled={saving || !template?.[key]}
              title={!template?.[key] ? 'Disabled on the template' : undefined}
              onChange={(event) => onChange(key, event.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Changes save automatically for this listing. Options disabled on the template cannot be enabled here.
      </p>
    </div>
  );
}
