'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { KeyboardEvent, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ETSY_PRIMARY_COLOURS } from '@/lib/etsy-colours';
import type { MultiListingWizardData } from '@/lib/multi-listing';
import { getMultiBedroomPrompt, getMultiPlayroomPrompt } from '@/lib/multi-listing-prompts';

type Props = { data: MultiListingWizardData | null; shopId: string; sectionId: string; subSectionId: string };
type Group = { groupNumber: number; sourceDirectoryName: string; fileCount: number };
type Zip = { groupNumber: number; sourceDirectoryName: string; fileName: string; sizeBytes: number };
type PromptStep = { title: string; names: string[]; note: string; artworkNumbers?: number[] };
const MAX_PROMPT_UPLOADS = 64;
const CATALOGUE_BATCH_SIZE = 16;

export function MultiListingWizard({ data, shopId, sectionId, subSectionId }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [listingName, setListingName] = useState('');
  const [sourceSectionId, setSourceSectionId] = useState(data?.defaultSourceSectionId ?? '');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [uploadedImages, setUploadedImages] = useState<Array<File | null>>(Array(MAX_PROMPT_UPLOADS).fill(null));
  const [existingImageNames, setExistingImageNames] = useState<Array<string | null>>(Array(MAX_PROMPT_UPLOADS).fill(null));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('8.33');
  const [quantity, setQuantity] = useState('999');
  const [primaryColour, setPrimaryColour] = useState('');
  const [secondaryColour, setSecondaryColour] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createdListingId, setCreatedListingId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [zips, setZips] = useState<Zip[]>([]);
  const [groupedFilesChanged, setGroupedFilesChanged] = useState(false);
  const [dropbox, setDropbox] = useState<{ folderPath: string; sharedUrl: string | null } | null>(null);
  const [pdfCreated, setPdfCreated] = useState(false);
  const [infoCopied, setInfoCopied] = useState(false);

  const downloadCount = data?.subSection.numberOfDownloads ?? 0;
  const isAll = data?.subSection.includeAllDownloads ?? false;
  const isThree = downloadCount === 3;
  const isSix = downloadCount === 6;
  const isTwelve = downloadCount === 12;
  const isDropboxMulti = isSix || isTwelve || isAll;
  const isSupported = downloadCount === 3 || isDropboxMulti;
  const selectedSourceSection = data?.sourceSections.find((section) => section.id === sourceSectionId) ?? null;
  const sources = selectedSourceSection?.sources ?? [];
  const requiredCount = data?.subSection.includeAllDownloads ? sources.length : downloadCount;
  const selectedSources = useMemo(
    () => selectedIds.map((id) => sources.find((source) => source.id === id)).filter(Boolean) as NonNullable<typeof data>['sourceSections'][number]['sources'],
    [sources, selectedIds]
  );
  const names = selectedSources.map((source) => source.name);
  const cataloguePrompts: PromptStep[] = isAll
    ? Array.from({ length: Math.ceil(names.length / CATALOGUE_BATCH_SIZE) }, (_, batchIndex) => {
        const startIndex = batchIndex * CATALOGUE_BATCH_SIZE;
        const batchNames = names.slice(startIndex, startIndex + CATALOGUE_BATCH_SIZE);
        return {
          title: 'Run PROMPT_60_1_20_images',
          names: batchNames,
          note: `Display listings from ${startIndex + 1}–${startIndex + batchNames.length}.`,
          artworkNumbers: batchNames.map((_, index) => startIndex + index + 1),
        };
      })
    : [];
  const prompts: PromptStep[] = isAll
    ? [
        { title: 'Run PROMPT_70_12_images_on_plain_wall', names: names.slice(0, 12), note: 'Upload the best 12 images.' },
        ...cataloguePrompts,
        { title: 'Run PROMPT_40_multi_bedroom', names: names.slice(0, 3), note: 'Upload the first group of 3 images.' },
        { title: 'Run PROMPT_40_multi_bedroom', names: names.slice(3, 6), note: 'Upload a second group of 3 images.' },
        { title: 'Run PROMPT_40_multi_bedroom', names: names.slice(6, 9), note: 'Upload another group of 3 images.' },
        { title: 'Run PROMPT_40_multi_playroom', names: names.slice(9, 15), note: 'Upload a group of 6 images.' },
        { title: 'Run PROMPT_40_multi_playroom', names: names.slice(15, 21), note: 'Upload the following 6 images.' },
      ]
    : isTwelve
    ? [
        { title: 'Run PROMPT_50_12_images_bedroom', names, note: '' },
        { title: 'Run PROMPT_51_12_images_on_plain_wall', names, note: '' },
        { title: 'Run PROMPT_40_multi_bedroom', names: names.slice(0, 3), note: 'Upload the first group of 3 images.' },
        { title: 'Run PROMPT_40_multi_bedroom', names: names.slice(3, 6), note: 'Upload the second group of 3 images.' },
        { title: 'Run PROMPT_40_multi_bedroom', names: names.slice(6, 9), note: 'Upload the third group of 3 images.' },
        { title: 'Run PROMPT_40_multi_bedroom', names: names.slice(9, 12), note: 'Upload the fourth group of 3 images.' },
        { title: 'Run PROMPT_52_12_images_bedroom_diff_sizes', names, note: '' },
        { title: 'Run PROMPT_53_what_you_receive', names: [], note: '' },
      ]
    : isSix
    ? [
        { title: 'Run PROMPT_40_multi_bedroom', names, note: '' },
        { title: 'Run PROMPT_40_multi_playroom', names, note: '' },
        { title: 'Run PROMPT_40_multi_playroom', names: names.slice(0, 3), note: 'Choose the best three images.' },
        { title: 'Run PROMPT_40_multi_playroom', names: names.slice(3, 6), note: 'Choose another good selection of three.' },
      ]
    : [
        { title: 'Run PROMPT_40_multi_bedroom', names, note: '' },
        { title: 'Run PROMPT_40_multi_playroom', names, note: '' },
      ];
  const promptUploadStartStep = 3;
  const infoStep = prompts.length + promptUploadStartStep;
  const downloadsStep = infoStep + 1;
  const finalStep = infoStep + 2;
  const totalSteps = isDropboxMulti ? prompts.length + 6 : isThree ? 6 : isSupported ? prompts.length + 4 : 2;
  const infoPromptTitle = isAll ? 'PROMPT_74_All_etsy_info' : isTwelve ? 'PROMPT_54_12_etsy_info' : isSix ? 'PROMPT_42_6_etsy_info' : 'PROMPT_41_multi_etsy_info';
  const infoPromptUrl = isAll
    ? '/prompts/PROMPT_74_All_etsy_info.txt'
    : isTwelve
      ? '/prompts/PROMPT_54_12_etsy_info.txt'
      : isSix
        ? '/prompts/PROMPT_42_6_etsy_info.txt'
        : '/prompts/PROMPT_41_multi_etsy_info.txt';
  const backHref = `/listings?shopId=${encodeURIComponent(shopId)}&sectionId=${encodeURIComponent(sectionId)}&subSectionId=${encodeURIComponent(subSectionId)}`;

  if (!data) return <p className="text-destructive">Unable to load this section.</p>;

  async function validateListingName() {
    setError(null);
    setBusy('validate-name');
    try {
      const query = new URLSearchParams({ shopId, sectionId, subSectionId, sourceSectionId, listingName: listingName.trim() });
      const response = await fetch(`/api/shops/listings/multi?${query}`);
      const payload = await response.json() as {
        error?: string;
        existing?: {
          sourceIds: string[];
          title: string;
          description: string;
          price: string;
          quantity: string;
          primaryColour: string;
          secondaryColour: string;
          tags: string[];
          imageNames: Array<string | null>;
        } | null;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to validate listing name.');
      if (payload.existing) {
        const availableSourceIds = new Set(sources.map((source) => source.id));
        setSelectedIds(data?.subSection.includeAllDownloads
          ? sources.map((source) => source.id)
          : payload.existing.sourceIds.filter((id) => availableSourceIds.has(id)));
        setTitle(payload.existing.title);
        setDescription(payload.existing.description);
        setPrice(payload.existing.price);
        setQuantity(payload.existing.quantity);
        setPrimaryColour(payload.existing.primaryColour);
        setSecondaryColour(payload.existing.secondaryColour);
        setTags(payload.existing.tags);
        setExistingImageNames([...payload.existing.imageNames, ...Array(MAX_PROMPT_UPLOADS).fill(null)].slice(0, MAX_PROMPT_UPLOADS));
        setUploadedImages(Array(MAX_PROMPT_UPLOADS).fill(null));
      } else {
        setSelectedIds(data?.subSection.includeAllDownloads ? sources.map((source) => source.id) : []);
        setTitle('');
        setDescription('');
        setPrice('8.33');
        setQuantity('999');
        setPrimaryColour('');
        setSecondaryColour('');
        setTags([]);
        setExistingImageNames(Array(MAX_PROMPT_UPLOADS).fill(null));
        setUploadedImages(Array(MAX_PROMPT_UPLOADS).fill(null));
      }
      setStep(1);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to validate listing name.');
    } finally {
      setBusy(null);
    }
  }

  function toggleSource(id: string) {
    if (data?.subSection.includeAllDownloads) return;
    setSelectedIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < requiredCount ? [...current, id] : current);
  }

  function setPopularColours() {
    const counts = new Map<string, number>();
    selectedSources.forEach((source) => [source.primaryColour, source.secondaryColour].forEach((colour) => {
      if (colour) counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }));
    const popular = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([colour]) => colour);
    setPrimaryColour(popular[0] ?? '');
    setSecondaryColour(popular[1] ?? '');
  }

  function addTag() {
    const additions = tagInput.split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean);
    setTags((current) => [...new Set([...current, ...additions])].slice(0, 13));
    setTagInput('');
  }

  function tagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag();
    }
  }

  async function createListing() {
    setError(null);
    setBusy('create');
    try {
      const formData = new FormData();
      Object.entries({ shopId, sectionId, subSectionId, sourceSectionId, listingName, title, description, price, quantity, primaryColour, secondaryColour })
        .forEach(([key, value]) => formData.set(key, value));
      formData.set('sourceIds', JSON.stringify(selectedIds));
      formData.set('tags', JSON.stringify(tags));
      const imageKeys = isAll
        ? prompts.map((_, index) => `image${index + 1}`)
        : isTwelve
        ? ['image1', 'image2', 'image3', 'image4', 'image5', 'image6', 'image7', 'image8']
        : ['bedroomImage', 'playroomImage', 'bestThreeImage', 'otherThreeImage'];
      formData.set('flowType', isAll ? 'all' : isTwelve ? 'twelve' : isSix ? 'six' : 'three');
      imageKeys.forEach((key, index) => {
        if (uploadedImages[index]) formData.set(key, uploadedImages[index]!);
      });
      const response = await fetch('/api/shops/listings/multi', { method: 'POST', body: formData });
      const payload = await response.json() as {
        listingId?: string;
        groups?: Group[];
        zips?: Zip[];
        filesChanged?: boolean;
        dropbox?: { folderPath: string; sharedUrl: string | null } | null;
        pdfCreated?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.listingId) throw new Error(payload.error ?? 'Unable to create listing.');
      if (!isDropboxMulti) {
        router.push(`/listings/edit?shopId=${encodeURIComponent(shopId)}&sectionId=${encodeURIComponent(sectionId)}&subSectionId=${encodeURIComponent(subSectionId)}&listingId=${encodeURIComponent(payload.listingId)}&tab=downloads`);
        return;
      }
      setCreatedListingId(payload.listingId);
      setGroups(payload.groups ?? []);
      setZips(payload.zips ?? []);
      setGroupedFilesChanged(payload.filesChanged ?? false);
      setDropbox(payload.dropbox ?? null);
      setPdfCreated(payload.pdfCreated ?? false);
      setStep(downloadsStep);
      setBusy(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create listing.');
      setBusy(null);
    }
  }

  async function bundleAction(action: 'zip' | 'dropbox' | 'pdf') {
    if (!createdListingId) return;
    setError(null);
    setBusy(action);
    try {
      const response = await fetch('/api/shops/listings/dropbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, sectionId, subSectionId, listingId: createdListingId, action }),
      });
      const payload = await response.json() as {
        zips?: Zip[]; folderPath?: string; sharedUrl?: string | null; fileName?: string; error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to complete the action.');
      if (action === 'zip') {
        setZips(payload.zips ?? []);
        setGroupedFilesChanged(false);
      }
      if (action === 'dropbox') setDropbox({ folderPath: payload.folderPath ?? '', sharedUrl: payload.sharedUrl ?? null });
      if (action === 'pdf') setPdfCreated(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to complete the action.');
    } finally {
      setBusy(null);
    }
  }

  async function completeListing() {
    if (!createdListingId) return;
    setError(null);
    setBusy('complete');
    try {
      const response = await fetch('/api/shops/listings/multi', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, sectionId, subSectionId, listingId: createdListingId }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to complete listing.');
      router.push(backHref as Route);
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to complete listing.');
      setBusy(null);
    }
  }

  async function copyEtsyInfoPrompt(promptUrl: string) {
    setError(null);
    try {
      const response = await fetch(promptUrl);
      if (!response.ok) throw new Error('Unable to load the Etsy information prompt.');
      const template = await response.text();
      const animals = selectedSources.map((source) => `${source.name} – ${source.description}`).join('\n');
      const prompt = template.replace(/^ANIMALS:.*?^ROOM_THEME:/ms, `ANIMALS:\n${animals}\nROOM_THEME:`);
      await navigator.clipboard.writeText(prompt);
      setInfoCopied(true);
      window.setTimeout(() => setInfoCopied(false), 2000);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to copy prompt.');
    }
  }

  function promptCopyText(prompt: PromptStep) {
    if (prompt.title === 'Run PROMPT_40_multi_bedroom') return getMultiBedroomPrompt(prompt.names);
    if (prompt.title === 'Run PROMPT_40_multi_playroom') return getMultiPlayroomPrompt(prompt.names);
    return null;
  }

  function promptCopyUrl(prompt: PromptStep) {
    if (prompt.title === 'Run PROMPT_50_12_images_bedroom') return '/prompts/PROMPT_50_12_images_bedroom.txt';
    if (prompt.title === 'Run PROMPT_51_12_images_on_plain_wall') return '/prompts/PROMPT_51_12_images_on_plain_wall.txt';
    if (prompt.title === 'Run PROMPT_52_12_images_bedroom_diff_sizes') return '/prompts/PROMPT_52_12_images_bedroom_diff_sizes.txt';
    if (prompt.title === 'Run PROMPT_53_what_you_receive') return '/prompts/PROMPT_53_what_you_receive.txt';
    if (prompt.title === 'Run PROMPT_70_12_images_on_plain_wall') return '/prompts/PROMPT_70_12_images_on_plain_wall.txt';
    if (prompt.title === 'Run PROMPT_60_1_20_images') return '/prompts/PROMPT_60_1_20_images.txt';
    return null;
  }

  return (
    <>
      <Button asChild variant="outline" className="mb-4"><Link href={backHref as Route}><ArrowLeft className="h-4 w-4" />Back to Listings</Link></Button>
      <Card>
        <CardHeader><CardTitle>Create {data.subSection.name} Listing — Step {step + 1} of {totalSteps}</CardTitle></CardHeader>
        <CardContent className="grid gap-6">
          {step === 0 ? <>
            <div>
              <h2 className="font-semibold">Listing name</h2>
              <p className="text-sm text-muted-foreground">This will be used for the directory and local listing name.</p>
            </div>
            <label className="grid gap-2 text-sm font-medium">
              Listing name
              <Input value={listingName} onChange={(event) => setListingName(event.target.value)} autoFocus />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Source section
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={sourceSectionId}
                onChange={(event) => {
                  setSourceSectionId(event.target.value);
                  setSelectedIds([]);
                  setError(null);
                }}
              >
                <option value="">Select a one-download section</option>
                {data.sourceSections.map((section) => (
                  <option key={section.id} value={section.id}>{section.name} ({section.sources.length} listings)</option>
                ))}
              </select>
            </label>
            {error ? <ErrorText text={error} /> : null}
            <div className="flex justify-end">
              <Button onClick={validateListingName} disabled={!listingName.trim() || !sourceSectionId || busy !== null}>
                {busy === 'validate-name' ? 'Checking…' : 'Next'}
              </Button>
            </div>
          </> : null}

          {step === 1 ? <>
            <div><h2 className="font-semibold">Select source listings</h2><p className="text-sm text-muted-foreground">Select {requiredCount} items.</p></div>
            <div className="grid max-h-[50vh] gap-2 overflow-y-auto pr-2 sm:grid-cols-2 lg:grid-cols-3">
              {sources.map((source) => {
                const selected = selectedIds.includes(source.id);
                return <button key={source.id} type="button" onClick={() => toggleSource(source.id)} disabled={data.subSection.includeAllDownloads} className={`flex items-center justify-between rounded-md border p-3 text-left text-sm ${selected ? 'border-primary bg-primary/10' : 'border-input'}`}><span>{source.name}</span>{selected ? <Check className="h-4 w-4" /> : null}</button>;
              })}
            </div>
            {selectedIds.length !== requiredCount ? <p className="text-sm font-medium text-destructive">Select {requiredCount} items</p> : null}
            <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(0)}>Back</Button><Button disabled={selectedIds.length !== requiredCount} onClick={() => setStep(2)}>Next</Button></div>
          </> : null}

          {!isSupported && step === 2 ? <>
            <div><h2 className="font-semibold">Coming later</h2><p className="text-sm text-muted-foreground">Creation for this number of downloads will be added later.</p></div>
            <div><Button variant="outline" onClick={() => setStep(1)}>Back</Button></div>
          </> : null}

          {isSupported && step === 2 ? <>
            <div>
              <h2 className="font-semibold">Run all prompts</h2>
              <p className="mt-1 text-sm text-muted-foreground">Copy and run these prompts at the same time. You will upload their results in the following steps.</p>
            </div>
            <div className="grid gap-6">
              {prompts.map((prompt, promptIndex) => <div key={`${prompt.title}-${promptIndex}`} className="rounded-md border p-4">
                <PromptUpload
                  {...prompt}
                  copyPrompt={promptCopyText(prompt)}
                  copyPromptUrl={promptCopyUrl(prompt)}
                  artworkNumbers={prompt.artworkNumbers ?? null}
                  file={null}
                  existingFileName={null}
                  setFile={() => undefined}
                  showUpload={false}
                />
              </div>)}
              <div className="rounded-md border p-4">
                <h2 className="font-semibold">Run {infoPromptTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">Enter the following items into the prompt:</p>
                <ul className="mt-3 grid gap-2 text-sm">{selectedSources.map((source) => <li key={source.id}><strong>{source.name}</strong> â€” {source.description}</li>)}</ul>
                <Button type="button" variant="outline" className="mt-4" onClick={() => copyEtsyInfoPrompt(infoPromptUrl)}><Copy className="h-4 w-4" />{infoCopied ? 'Prompt copied' : 'Copy prompt'}</Button>
              </div>
            </div>
            <Navigation back={() => setStep(1)} next={() => setStep(3)} nextDisabled={false} nextLabel="Next" />
          </> : null}

          {isSupported && step >= promptUploadStartStep && step < infoStep ? <>
            <PromptUpload
              {...prompts[step - promptUploadStartStep]}
              copyPrompt={promptCopyText(prompts[step - promptUploadStartStep])}
              copyPromptUrl={promptCopyUrl(prompts[step - promptUploadStartStep])}
              artworkNumbers={prompts[step - promptUploadStartStep].artworkNumbers ?? null}
              file={uploadedImages[step - promptUploadStartStep]}
              existingFileName={existingImageNames[step - promptUploadStartStep]}
              setFile={(file) => setUploadedImages((current) => current.map((value, index) => index === step - promptUploadStartStep ? file : value))}
              showPrompt={false}
            />
            <Navigation back={() => setStep(step - 1)} next={() => {
              if (step === infoStep - 1) setPopularColours();
              setStep(step + 1);
            }} nextDisabled={!uploadedImages[step - promptUploadStartStep] && !existingImageNames[step - promptUploadStartStep]} nextLabel="Next" />
          </> : null}

          {step === infoStep ? <>
            {false ? <div>
              <h2 className="font-semibold">Run {isAll ? 'PROMPT_74_All_etsy_info' : isTwelve ? 'PROMPT_54_12_etsy_info' : isSix ? 'PROMPT_42_6_etsy_info' : 'PROMPT_41_multi_etsy_info'}</h2>
              <p className="mt-1 text-sm text-muted-foreground">Enter the following items into the prompt:</p>
              <ul className="mt-3 grid gap-2 text-sm">{selectedSources.map((source) => <li key={source.id}><strong>{source.name}</strong> — {source.description}</li>)}</ul>
              {isAll ? <Button type="button" variant="outline" className="mt-4" onClick={() => copyEtsyInfoPrompt('/prompts/PROMPT_74_All_etsy_info.txt')}><Copy className="h-4 w-4" />{infoCopied ? 'Prompt copied' : 'Copy prompt'}</Button> : null}
              {isThree ? <Button type="button" variant="outline" className="mt-4" onClick={() => copyEtsyInfoPrompt('/prompts/PROMPT_41_multi_etsy_info.txt')}><Copy className="h-4 w-4" />{infoCopied ? 'Prompt copied' : 'Copy prompt'}</Button> : null}
              {isSix ? <Button type="button" variant="outline" className="mt-4" onClick={() => copyEtsyInfoPrompt('/prompts/PROMPT_42_6_etsy_info.txt')}><Copy className="h-4 w-4" />{infoCopied ? 'Prompt copied' : 'Copy prompt'}</Button> : null}
              {isTwelve ? <Button type="button" variant="outline" className="mt-4" onClick={() => copyEtsyInfoPrompt('/prompts/PROMPT_54_12_etsy_info.txt')}><Copy className="h-4 w-4" />{infoCopied ? 'Prompt copied' : 'Copy prompt'}</Button> : null}
            </div> : <div><h2 className="font-semibold">Enter Etsy listing information</h2></div>}
            <p className="text-sm">Once you have run the prompt, enter the listing information below.</p>
            <label className="grid gap-2 text-sm font-medium">Title<Input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="grid gap-2 text-sm font-medium">Description<textarea className="min-h-36 rounded-md border border-input bg-background p-3 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">Price (£)<Input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
              <label className="grid gap-2 text-sm font-medium">Quantity<Input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
              <ColourSelect label="Primary Colour" value={primaryColour} setValue={setPrimaryColour} />
              <ColourSelect label="Secondary Colour" value={secondaryColour} setValue={setSecondaryColour} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Tags</label>
              <div className="flex gap-2"><Input value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={tagKeyDown} placeholder="Enter a tag" /><Button variant="outline" onClick={addTag} disabled={!tagInput.trim()}>Add</Button></div>
              <div className="flex flex-wrap gap-2">{tags.map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm">{tag}<button onClick={() => setTags((current) => current.filter((value) => value !== tag))}><X className="h-3 w-3" /></button></span>)}</div>
            </div>
            {busy === 'create' ? <Progress /> : null}
            {error ? <ErrorText text={error} /> : null}
            <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(infoStep - 1)} disabled={busy !== null}>Back</Button><Button onClick={createListing} disabled={busy !== null || !title.trim() || !description.trim() || !price || !quantity}>{busy === 'create' ? 'Creating…' : 'Create'}</Button></div>
          </> : null}

          {isDropboxMulti && step === downloadsStep ? <>
            <div><h2 className="text-lg font-semibold">Downloads</h2><p className="text-sm text-muted-foreground">The files are automatically grouped by their source listing.</p></div>
            <div className="grid gap-2">
              <div className="flex justify-between rounded-md border p-3 text-sm"><span>HowToPrintGuide.txt</span><span>Separate file</span></div>
              {groups.map((group) => <div key={group.groupNumber} className="flex justify-between rounded-md border p-3 text-sm"><span>{group.groupNumber}. {group.sourceDirectoryName}</span><span>{group.fileCount} files</span></div>)}
            </div>
            {zips.length > 0 ? <div className="grid gap-2">
              <div className="flex justify-between rounded-md bg-green-50 p-3 text-sm"><span>HowToPrintGuide.txt</span><span>Not zipped — uploaded separately</span></div>
              {zips.map((zip) => <div key={zip.groupNumber} className="flex justify-between rounded-md bg-green-50 p-3 text-sm"><span>{zip.fileName}</span><span>{(zip.sizeBytes / (1024 * 1024)).toFixed(2)} MB</span></div>)}
            </div> : null}
            {error ? <ErrorText text={error} /> : null}
            {groupedFilesChanged ? <p className="text-sm font-medium text-destructive">Please zip the files, as they have changed</p> : null}
            <p className="text-sm text-muted-foreground">We are grouping the files as shown above. Click Zip to zip them into the collections.</p>
            <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(infoStep)} disabled={busy !== null}>Back</Button><div className="flex gap-2"><Button onClick={() => bundleAction('zip')} disabled={busy !== null}>{busy === 'zip' ? 'Creating ZIPs…' : 'Zip →'}</Button><Button onClick={() => setStep(finalStep)} disabled={zips.length !== requiredCount || busy !== null}>Next</Button></div></div>
          </> : null}

          {isDropboxMulti && step === finalStep ? <>
            <div><h2 className="text-lg font-semibold">Dropbox Creation</h2><p className="text-sm text-muted-foreground">Create or update the Dropbox folder for this product.</p></div>
            <div className="rounded-md border p-4"><Button onClick={() => bundleAction('dropbox')} disabled={busy !== null}>{busy === 'dropbox' ? 'Uploading…' : dropbox ? 'Update Dropbox' : 'Create Dropbox'}</Button>{dropbox ? <div className="mt-3 text-sm"><p>{dropbox.folderPath}</p>{dropbox.sharedUrl ? <a className="text-primary underline" href={dropbox.sharedUrl} target="_blank" rel="noreferrer">Open shared link</a> : null}</div> : null}</div>
            <div className="rounded-md border p-4"><p className="mb-3 text-sm">Create the PDF customers will download from Etsy. It contains the Dropbox link.</p><Button onClick={() => bundleAction('pdf')} disabled={!dropbox || busy !== null}>{busy === 'pdf' ? 'Creating PDF…' : pdfCreated ? 'Recreate PDF' : 'Create PDF'}</Button>{pdfCreated ? <p className="mt-2 text-sm text-green-700">CosyHousePrints_Download_Instructions.pdf has been created in Downloads.</p> : null}</div>
            {error ? <ErrorText text={error} /> : null}
            <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(downloadsStep)} disabled={busy !== null}>Back</Button><Button onClick={completeListing} disabled={!dropbox || !pdfCreated || busy !== null}>{busy === 'complete' ? 'Completing…' : 'Complete'}</Button></div>
          </> : null}
        </CardContent>
      </Card>
    </>
  );
}

function PromptUpload({ title, names, note, copyPrompt, copyPromptUrl, artworkNumbers, file, existingFileName, setFile, showPrompt = true, showUpload = true }: { title: string; names: string[]; note: string; copyPrompt: string | null; copyPromptUrl: string | null; artworkNumbers: number[] | null; file: File | null; existingFileName: string | null; setFile: (file: File | null) => void; showPrompt?: boolean; showUpload?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    let prompt = copyPrompt;
    if (!prompt && copyPromptUrl) {
      const response = await fetch(copyPromptUrl);
      if (!response.ok) return;
      prompt = await response.text();
      if (artworkNumbers) {
        const formattedNumbers = artworkNumbers.map((number) => String(number).padStart(2, '0'));
        prompt = prompt.replace(
          /attachment (\d+) = position \d+/g,
          (line, attachmentNumber: string) => {
            const position = formattedNumbers[Number(attachmentNumber) - 1];
            return position ? `attachment ${attachmentNumber} = position ${position}` : line;
          }
        );
        const numberRows = Array.from({ length: 4 }, (_, rowIndex) =>
          formattedNumbers.slice(rowIndex * 4, rowIndex * 4 + 4).join(', ')
        ).filter(Boolean).join('\n');
        prompt = prompt.replace(
          /(Place these exact numbers beneath the corresponding frames:\r?\n\r?\n)(?:\d{2}(?:, \d{2}){3}\r?\n){3}\d{2}(?:, \d{2}){3}/,
          `$1${numberRows}`
        );
      } else {
        prompt = prompt.replace(/^ANIMALS:.*$/m, `ANIMALS: ${names.join(', ')}`);
      }
    }
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  return <>{showPrompt ? <div><h2 className="font-semibold">{title}</h2>{note ? <p className="mt-1 text-sm font-medium">{note}</p> : null}{names.length > 0 ? <><p className="mt-1 text-sm text-muted-foreground">Upload the following {names.length} images:</p><p className="mt-3 text-sm">{names.join(', ')}</p></> : null}{copyPrompt || copyPromptUrl ? <Button type="button" variant="outline" className="mt-4" onClick={copy}><Copy className="h-4 w-4" />{copied ? 'Prompt copied' : 'Copy prompt'}</Button> : null}</div> : null}{showUpload ? <div className="rounded-md border border-dashed p-6">{!showPrompt ? <h2 className="mb-2 font-semibold">Upload result from {title.replace(/^Run /, '')}</h2> : null}<p className="mb-3 text-sm">{existingFileName && !file ? 'The existing image will be retained unless you upload a replacement.' : 'Once you have generated the image, please upload it.'}</p><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"><Upload className="h-4 w-4" />{existingFileName ? 'Replace image' : 'Upload image'}<input type="file" accept="image/*" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>{file ? <p className="mt-3 text-sm font-medium">{file.name}</p> : existingFileName ? <p className="mt-3 text-sm font-medium">Existing: {existingFileName}</p> : null}</div> : null}</>;
}

function Navigation({ back, next, nextDisabled, nextLabel = 'Next' }: { back: () => void; next: () => void; nextDisabled: boolean; nextLabel?: string }) {
  return <div className="flex justify-between"><Button variant="outline" onClick={back}>Back</Button><Button onClick={next} disabled={nextDisabled}>{nextLabel}</Button></div>;
}

function ColourSelect({ label, value, setValue }: { label: string; value: string; setValue: (value: string) => void }) {
  return <label className="grid gap-2 text-sm font-medium">{label}<select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={value} onChange={(event) => setValue(event.target.value)}><option value="">Select colour</option>{ETSY_PRIMARY_COLOURS.map((colour) => <option key={colour.value} value={colour.value}>{colour.label}</option>)}</select></label>;
}

function ErrorText({ text }: { text: string }) {
  return <p className="text-sm font-medium text-destructive">{text}</p>;
}

function Progress() {
  return <div className="rounded-md border bg-muted/40 p-4"><p className="font-medium">Creating listing…</p><ul className="mt-2 text-sm text-muted-foreground"><li>• Creating directory and database record</li><li>• Copying downloads and images</li><li>• Creating title, description, and tag files</li></ul></div>;
}
