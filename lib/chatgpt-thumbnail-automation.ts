import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { BrowserContext, Download, Locator, Page } from 'playwright';
import { createThumbnailPrintMaster } from '@/lib/thumbnail-print-master';
import { createPersonalisedPrintMaster, type LocalPersonalisationSpec } from '@/lib/thumbnail-personalisation';

export type ThumbnailAutomationStatus =
  | 'opening_browser'
  | 'waiting_for_login'
  | 'submitting_prompt'
  | 'generating'
  | 'downloading'
  | 'completed'
  | 'failed';

export type ThumbnailAutomationWorkflow = 'thumbnail' | 'listing_image' | 'listing_details' | 'listing_detail_step' | 'listing_text';

export type ThumbnailAutomationJob = {
  id: string;
  listingId: string;
  listingName: string;
  workflow: ThumbnailAutomationWorkflow;
  status: ThumbnailAutomationStatus;
  message: string;
  downloadFileName?: string;
  downloadPath?: string;
  detailKey?: string;
  detailStepIndex?: number;
  detailStepCount?: number;
  createdAt: string;
  updatedAt: string;
};

type StoredThumbnailAutomationJob = ThumbnailAutomationJob & {
  prompt: string;
  attachment?: {
    fileName: string;
    mimeType: string;
    contents: Buffer;
  };
  listingDetailPlans?: ListingDetailAutomationPlan[];
  listingContext?: {
    shopId: string;
    sectionId: string;
    subSectionId: string;
    listingId: string;
  };
  fontAttachment?: AutomationAttachment;
  listingDetailIndividual?: {
    key: string;
    label: string;
    position: number;
    stepIndex: number;
    stepCount: number;
    outputBaseName: string;
    step: ListingDetailAutomationPlan['steps'][number];
  };
};

type AutomationAttachment = {
  fileName: string;
  mimeType: string;
  contents: Buffer;
};

type GeneratedOutputKind = 'inline_image' | 'download_file';

export type ListingDetailAutomationPlan = {
  key: string;
  label: string;
  position: number;
  steps: Array<{
    prompt: string;
    includeFont: boolean;
    outputKind?: GeneratedOutputKind;
    processor?: 'chatgpt' | 'local_print_master' | 'local_personalisation';
    localPersonalisation?: LocalPersonalisationSpec;
  }>;
};

type ThumbnailAutomationGlobals = typeof globalThis & {
  __etsyThumbnailAutomationJobs?: Map<string, StoredThumbnailAutomationJob>;
  __etsyThumbnailAutomationContext?: BrowserContext;
  __etsyThumbnailAutomationContextPromise?: Promise<BrowserContext>;
};

const automationGlobals = globalThis as ThumbnailAutomationGlobals;
const jobs = automationGlobals.__etsyThumbnailAutomationJobs
  ?? (automationGlobals.__etsyThumbnailAutomationJobs = new Map());

const TERMINAL_STATUSES = new Set<ThumbnailAutomationStatus>(['completed', 'failed']);
const CHATGPT_URL = process.env.CHATGPT_URL?.trim() || 'https://chatgpt.com/';
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const GENERATION_TIMEOUT_MS = 30 * 60 * 1000;
const STALE_SETUP_JOB_MS = 12 * 60 * 1000;
const STALE_GENERATION_JOB_MS = 5 * 60 * 1000;

function chatGptProfileDirectory() {
  return path.join(process.cwd(), '.playwright', 'chatgpt-profile');
}

function installedBrowserExecutable() {
  const candidates = [
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : '',
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : '',
    process.env['PROGRAMFILES(X86)']
      ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : '',
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : '',
    process.env['PROGRAMFILES(X86)']
      ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : '',
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function publicJob(job: StoredThumbnailAutomationJob): ThumbnailAutomationJob {
  const {
    prompt: _prompt,
    attachment: _attachment,
    listingDetailPlans: _listingDetailPlans,
    listingContext: _listingContext,
    fontAttachment: _fontAttachment,
    listingDetailIndividual: _listingDetailIndividual,
    ...safeJob
  } = job;
  return { ...safeJob, workflow: job.workflow ?? 'thumbnail' };
}

function updateJob(
  jobId: string,
  status: ThumbnailAutomationStatus,
  message: string,
) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (TERMINAL_STATUSES.has(job.status) && status !== job.status) return;
  job.status = status;
  job.message = message;
  job.updatedAt = new Date().toISOString();
}

function touchJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job || TERMINAL_STATUSES.has(job.status)) return;
  job.updatedAt = new Date().toISOString();
}

function cleanOldJobs() {
  const oldestAllowed = Date.now() - 24 * 60 * 60 * 1000;
  for (const [jobId, job] of jobs) {
    if (TERMINAL_STATUSES.has(job.status) && Date.parse(job.updatedAt) < oldestAllowed) {
      jobs.delete(jobId);
    }
  }
}

function expireStaleJobs() {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (TERMINAL_STATUSES.has(job.status)) continue;
    const timeout = job.status === 'generating' ? STALE_GENERATION_JOB_MS : STALE_SETUP_JOB_MS;
    if (now - Date.parse(job.updatedAt) <= timeout) continue;
    updateJob(
      job.id,
      'failed',
      'The ChatGPT image job stopped responding. Close its ChatGPT window and try again.',
    );
  }
}

async function launchPersistentChatGptContext() {
  const { chromium } = await import('playwright');
  const userDataDir = chatGptProfileDirectory();
  const launchOptions = {
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
  };

  const launchErrors: string[] = [];
  for (const channel of ['chrome', 'msedge'] as const) {
    try {
      return await chromium.launchPersistentContext(userDataDir, { ...launchOptions, channel });
    } catch (error) {
      launchErrors.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    return await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (error) {
    launchErrors.push(`bundled Chromium: ${error instanceof Error ? error.message : String(error)}`);
    if (launchErrors.some((message) => /SingletonLock|profile.*in use|process is still running/i.test(message))) {
      throw new Error('Close the separate ChatGPT sign-in browser, then try again.');
    }
    throw new Error(`Unable to open Chrome or Edge for ChatGPT. ${launchErrors.join(' ')}`);
  }
}

async function getChatGptContext() {
  const existing = automationGlobals.__etsyThumbnailAutomationContext;
  if (existing) return existing;

  if (!automationGlobals.__etsyThumbnailAutomationContextPromise) {
    automationGlobals.__etsyThumbnailAutomationContextPromise = launchPersistentChatGptContext()
      .then((context) => {
        automationGlobals.__etsyThumbnailAutomationContext = context;
        context.on('close', () => {
          if (automationGlobals.__etsyThumbnailAutomationContext === context) {
            automationGlobals.__etsyThumbnailAutomationContext = undefined;
          }
          automationGlobals.__etsyThumbnailAutomationContextPromise = undefined;
        });
        return context;
      })
      .catch((error) => {
        automationGlobals.__etsyThumbnailAutomationContextPromise = undefined;
        throw error;
      });
  }

  return automationGlobals.__etsyThumbnailAutomationContextPromise;
}

async function chatGptComposer(page: Page) {
  const candidates = [
    page.locator('#prompt-textarea:visible'),
    page.locator('[data-testid="composer-input"]:visible'),
    page.locator('form [contenteditable="true"]:visible'),
    page.locator('main [contenteditable="true"][role="textbox"]:visible'),
    page.locator('main [contenteditable="true"]:visible'),
    page.locator('form textarea:visible'),
    page.locator('main textarea:visible'),
    page.getByRole('textbox').filter({ visible: true }),
  ];

  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const match = candidate.nth(index);
      if (await isVisible(match)) return match;
    }
  }

  return null;
}

function chatGptSendButton(page: Page) {
  return page.locator([
    'button[data-testid="send-button"]:visible',
    'button[aria-label="Send prompt"]:visible',
    'button[aria-label="Send message"]:visible',
    'button[aria-label^="Send"]:visible',
  ].join(', ')).first();
}

function chatGptStopButton(page: Page) {
  return page.locator([
    'button[data-testid="stop-button"]:visible',
    'button[aria-label="Stop streaming"]:visible',
    'button[aria-label="Stop generating"]:visible',
    'button[aria-label^="Stop"]:visible',
  ].join(', ')).first();
}

async function isVisible(locator: Locator) {
  return locator.isVisible().catch(() => false);
}

async function isEnabled(locator: Locator) {
  return locator.isEnabled().catch(() => false);
}

async function humanVerificationVisible(page: Page) {
  const challengeFrame = page.locator([
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[title*="challenge" i]',
    'iframe[title*="verification" i]',
  ].join(', '));
  if (await challengeFrame.count().catch(() => 0) > 0) return true;

  if (await page.getByText(/verify you are human|checking if the site connection is secure/i)
    .first()
    .isVisible()
    .catch(() => false)) return true;

  const title = await page.title().catch(() => '');
  return /just a moment|security verification|verify you are human/i.test(title);
}

async function waitForComposer(page: Page, jobId: string) {
  updateJob(
    jobId,
    'waiting_for_login',
    'ChatGPT is open. Locating the prompt box.',
  );

  const startedAt = Date.now();
  while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
    if (page.isClosed()) throw new Error('The ChatGPT browser was closed before sign-in completed.');
    if (await humanVerificationVisible(page)) {
      updateJob(
        jobId,
        'waiting_for_login',
        'Cloudflare needs human verification. Click “Verify you are human” in the open browser; this job will continue automatically afterwards.',
      );
      await page.bringToFront().catch(() => undefined);
      await page.waitForTimeout(2_000);
      continue;
    }
    const composer = await chatGptComposer(page);
    if (composer) return composer;

    if (/accounts\.google\./i.test(page.url())) {
      const googleBlockedSignIn = await page.getByText(/couldn.t sign you in|browser or app may not be secure/i)
        .count()
        .catch(() => 0);
      if (googleBlockedSignIn > 0) {
        throw new Error('Google blocked sign-in inside Playwright. Use Sign in to ChatGPT on the Start tab, finish signing in in the normal browser, close it, then try again.');
      }
      updateJob(jobId, 'waiting_for_login', 'Complete the Google sign-in shown in the browser.');
    } else if (/chatgpt\.com/i.test(page.url())) {
      updateJob(jobId, 'waiting_for_login', 'ChatGPT is signed in. Waiting for its prompt box to become ready.');
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error('ChatGPT was not ready within 10 minutes. Use Sign in to ChatGPT on the Start tab, then try again.');
}

async function attachFileToComposer(
  page: Page,
  composer: Locator,
  attachments: AutomationAttachment[],
) {
  if (attachments.length === 0) return;
  const filePayloads = attachments.map((attachment) => ({
    name: attachment.fileName,
    mimeType: attachment.mimeType,
    buffer: attachment.contents,
  }));
  let fileInput = page.locator('input[type="file"]').last();

  if (await fileInput.count().catch(() => 0) === 0) {
    const addFilesButton = page.getByRole('button', { name: /add files and more/i }).last();
    if (!await isVisible(addFilesButton)) {
      throw new Error('The ChatGPT file attachment button could not be found. The browser has been left open.');
    }
    await addFilesButton.click();
    await page.waitForTimeout(250);
    fileInput = page.locator('input[type="file"]').last();
  }

  if (await fileInput.count().catch(() => 0) > 0) {
    await fileInput.setInputFiles(filePayloads);
  } else {
    const uploadFromComputer = page.getByText(/upload from computer/i, { exact: true }).last();
    if (!await isVisible(uploadFromComputer)) {
      throw new Error('The ChatGPT Upload from computer option could not be found. The browser has been left open.');
    }
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 });
    await uploadFromComputer.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePayloads);
  }

  const composerForm = composer.locator('xpath=ancestor::form[1]');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    const uploadError = page.getByText(/failed to upload|upload failed|couldn.t upload/i).last();
    if (await isVisible(uploadError)) {
      throw new Error(`ChatGPT could not upload ${attachments.map((attachment) => attachment.fileName).join(', ')}. The browser has been left open.`);
    }

    const allNamedAttachmentsVisible = (await Promise.all(attachments.map(async (attachment) => {
      const namedAttachment = page.getByText(attachment.fileName, { exact: true }).last();
      const namedImage = page.getByAltText(attachment.fileName, { exact: true }).last();
      return await isVisible(namedAttachment) || await isVisible(namedImage);
    }))).every(Boolean);
    const attachmentPreviews = composerForm.locator([
      '[data-testid*="attachment" i]:visible',
      '[data-testid*="file-thumbnail" i]:visible',
      'img:visible',
    ].join(', '));
    if (
      allNamedAttachmentsVisible
      || await attachmentPreviews.count().catch(() => 0) >= attachments.length
    ) {
      return;
    }
    await page.waitForTimeout(500);
  }

  throw new Error(`ChatGPT did not finish attaching ${attachments.map((attachment) => attachment.fileName).join(', ')}. The browser has been left open.`);
}

async function submitPrompt(page: Page, composer: Locator, prompt: string) {
  const initialUserMessages = await page.locator('[data-message-author-role="user"]').count().catch(() => 0);
  let activeComposer = composer;
  if (!await isVisible(activeComposer)) {
    activeComposer = await chatGptComposer(page)
      ?? (() => { throw new Error('ChatGPT replaced its prompt box after attaching the image. The browser has been left open.'); })();
  }
  await activeComposer.click();
  try {
    await activeComposer.fill(prompt);
  } catch {
    activeComposer = await chatGptComposer(page) ?? activeComposer;
    await activeComposer.pressSequentially(prompt, { delay: 1 });
  }

  const sendButton = chatGptSendButton(page);
  let submitted = false;
  const sendButtonDeadline = Date.now() + 60_000;
  while (Date.now() < sendButtonDeadline) {
    if (await isVisible(sendButton) && await isEnabled(sendButton)) {
      await sendButton.click();
      submitted = true;
      break;
    }
    await page.waitForTimeout(250);
  }

  if (!submitted) {
    const composerForm = activeComposer.locator('xpath=ancestor::form[1]');
    const enabledComposerButtons = composerForm.locator('button:visible:not([disabled])');
    if (await composerForm.count().catch(() => 0) > 0 && await enabledComposerButtons.count().catch(() => 0) > 0) {
      await enabledComposerButtons.last().click();
      submitted = true;
    }
  }

  if (!submitted) {
    await activeComposer.press('Control+Enter');
  }

  const submissionDeadline = Date.now() + 15_000;
  const userMessages = page.locator('[data-message-author-role="user"]');
  const stopButton = chatGptStopButton(page);
  while (Date.now() < submissionDeadline) {
    const userMessageCount = await userMessages.count().catch(() => 0);
    if (userMessageCount > initialUserMessages || await isVisible(stopButton)) return;
    await page.waitForTimeout(250);
  }

  throw new Error('The prompt was added to ChatGPT, but its Send arrow did not submit it. Close the browser and try again.');
}

function generatedImagePreviews(page: Page) {
  return page.locator([
    'button[data-testid="generated-image-preview"]',
    'button[aria-label^="Generated image" i]',
  ].join(', '));
}

function assistantMessages(page: Page) {
  return page.locator('[data-message-author-role="assistant"]');
}

function generatedFileTargets(page: Page) {
  return page.locator([
    'a[download]:visible',
    'a[href*="/mnt/data/"]:visible',
    'a[href*="/backend-api/files/"]:visible',
    'a[href*="download"]:visible',
    'button[data-testid*="download" i]:visible',
    '[role="button"][data-testid*="download" i]:visible',
    'button[aria-label*="download" i]:visible',
    '[role="button"][aria-label*="download" i]:visible',
    'button[title*="download" i]:visible',
    '[role="button"][title*="download" i]:visible',
    'a:visible:has-text(".png")',
    'button:visible:has-text(".png")',
    '[role="button"]:visible:has-text(".png")',
  ].join(', '));
}

function generatedFileNameLabels(page: Page) {
  return page.getByText(/\.(?:png|jpe?g|webp)\s*$/i);
}

async function monitorGeneration(
  jobId: string,
  page: Page,
  initialGeneratedImages: number,
  initialAssistantMessages: number,
  initialGeneratedFiles: number,
  initialGeneratedFileNames: number,
  outputKind: GeneratedOutputKind,
) {
  const stopButton = chatGptStopButton(page);
  const startedAt = Date.now();
  let responseStarted = false;
  let consecutiveCompleteChecks = 0;

  while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
    if (page.isClosed()) throw new Error('The ChatGPT browser tab was closed before generation finished.');
    touchJob(jobId);

    const stopVisible = await isVisible(stopButton);
    const generatedImageCount = await generatedImagePreviews(page).count().catch(() => 0);
    const assistantMessageCount = await assistantMessages(page).count().catch(() => 0);
    const generatedFileCount = await generatedFileTargets(page).count().catch(() => 0);
    const generatedFileNameCount = await generatedFileNameLabels(page).count().catch(() => 0);
    const newGeneratedImageVisible = generatedImageCount > initialGeneratedImages
      && await isVisible(generatedImagePreviews(page).last());
    const newGeneratedFileTargetVisible = generatedFileCount > initialGeneratedFiles
      && await isVisible(generatedFileTargets(page).last());
    const newGeneratedFileNameVisible = generatedFileNameCount > initialGeneratedFileNames
      && await isVisible(generatedFileNameLabels(page).last());
    const newGeneratedFileVisible = newGeneratedFileTargetVisible || newGeneratedFileNameVisible;
    const newAssistantResponseVisible = assistantMessageCount > initialAssistantMessages
      && await isVisible(assistantMessages(page).last());
    const expectedOutputVisible = outputKind === 'download_file'
      ? newGeneratedFileVisible
      : newGeneratedImageVisible;

    if (stopVisible || expectedOutputVisible || newAssistantResponseVisible) {
      responseStarted = true;
    }

    if (
      responseStarted
      && !stopVisible
      && expectedOutputVisible
    ) {
      consecutiveCompleteChecks += 1;
      if (consecutiveCompleteChecks >= 3) return;
    } else {
      consecutiveCompleteChecks = 0;
    }

    await page.waitForTimeout(2_000);
  }

  throw new Error('ChatGPT did not report completion within 30 minutes. The browser has been left open for inspection.');
}

async function waitForGeneratedListingText(
  jobId: string,
  page: Page,
  initialAssistantMessages: number,
) {
  const stopButton = chatGptStopButton(page);
  const startedAt = Date.now();
  let lastText = '';
  let consecutiveCompleteChecks = 0;

  while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
    if (page.isClosed()) throw new Error('The ChatGPT browser tab was closed before the listing details finished.');
    touchJob(jobId);
    const messages = assistantMessages(page);
    const messageCount = await messages.count().catch(() => 0);
    if (messageCount > initialAssistantMessages && await isVisible(messages.last())) {
      const text = (await messages.last().innerText().catch(() => '')).trim();
      const hasCompleteEnvelope = /<ETSY_LISTING_DATA>[\s\S]*<\/ETSY_LISTING_DATA>/i.test(text);
      if (!await isVisible(stopButton) && hasCompleteEnvelope && text === lastText) {
        consecutiveCompleteChecks += 1;
        if (consecutiveCompleteChecks >= 2) return text;
      } else {
        consecutiveCompleteChecks = 0;
      }
      lastText = text;
    }
    await page.waitForTimeout(2_000);
  }

  throw new Error('ChatGPT did not return the completed Etsy listing details within 30 minutes. The browser has been left open for inspection.');
}

function safeDownloadFileName(fileName: string) {
  const safeName = path.basename(fileName).replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-').trim();
  return safeName || 'generated-thumbnail.png';
}

function availableDownloadPath(directory: string, requestedFileName: string) {
  const fileName = safeDownloadFileName(requestedFileName);
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let candidate = path.join(directory, fileName);
  let copyNumber = 1;

  while (existsSync(candidate)) {
    candidate = path.join(directory, `${baseName} (${copyNumber})${extension}`);
    copyNumber += 1;
  }

  return candidate;
}

async function createLocalPrintMasterDownload(
  jobId: string,
  label: string,
  source: AutomationAttachment,
  requestedBaseName: string,
) {
  updateJob(jobId, 'generating', `Creating ${label} locally with deterministic TypeScript image processing.`);
  touchJob(jobId);
  const result = await createThumbnailPrintMaster(source.contents);
  const downloadsDirectory = path.join(homedir(), 'Downloads');
  mkdirSync(downloadsDirectory, { recursive: true });
  const destination = availableDownloadPath(
    downloadsDirectory,
    `${safeDownloadFileName(requestedBaseName).replace(/\.[^.]+$/, '')}.png`,
  );
  writeFileSync(destination, result.buffer);
  updateJob(
    jobId,
    'downloading',
    `Verified ${result.width} × ${result.height}px at ${result.density} DPI. `
      + `Margins: ${result.margins.left}px left, ${result.margins.right}px right, `
      + `${result.margins.top}px top and ${result.margins.bottom}px bottom.`,
  );
  return destination;
}

async function createLocalPersonalisationDownload(
  jobId: string,
  label: string,
  source: AutomationAttachment,
  font: AutomationAttachment,
  personalisation: LocalPersonalisationSpec,
  requestedBaseName: string,
) {
  updateJob(jobId, 'generating', `Adding the curved Nunito lettering for ${label} with deterministic TypeScript rendering.`);
  touchJob(jobId);
  const result = await createPersonalisedPrintMaster(
    source.contents,
    font.contents,
    personalisation,
  );
  const downloadsDirectory = path.join(homedir(), 'Downloads');
  mkdirSync(downloadsDirectory, { recursive: true });
  const destination = availableDownloadPath(
    downloadsDirectory,
    `${safeDownloadFileName(requestedBaseName).replace(/\.[^.]+$/, '')}.png`,
  );
  writeFileSync(destination, result.buffer);
  updateJob(
    jobId,
    'downloading',
    `Verified ${result.width} × ${result.height}px at ${result.density} DPI with Nunito Regular `
      + `${result.fontSize}px lettering in ${result.textColour}.`,
  );
  return destination;
}

function imageExtension(contentType: string, source: string) {
  const normalizedContentType = contentType.toLowerCase().split(';', 1)[0].trim();
  if (normalizedContentType === 'image/jpeg') return '.jpg';
  if (normalizedContentType === 'image/webp') return '.webp';
  if (normalizedContentType === 'image/gif') return '.gif';
  if (normalizedContentType === 'image/png') return '.png';

  try {
    const extension = path.extname(new URL(source).pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)) {
      return extension === '.jpeg' ? '.jpg' : extension;
    }
  } catch {
    // Blob and data URLs do not always have a useful pathname.
  }
  return '.png';
}

async function generatedImageContents(page: Page, source: string) {
  if (source.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(source);
    if (!match) throw new Error('The generated image data URL was invalid.');
    return {
      contents: match[2]
        ? Buffer.from(match[3], 'base64')
        : Buffer.from(decodeURIComponent(match[3])),
      contentType: match[1] || 'image/png',
    };
  }

  if (source.startsWith('blob:')) {
    const result = await page.evaluate(async (imageUrl) => {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`Unable to read generated image (${response.status}).`);
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      const chunkSize = 32_768;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      return { base64: btoa(binary), contentType: blob.type || 'image/png' };
    }, source);
    return { contents: Buffer.from(result.base64, 'base64'), contentType: result.contentType };
  }

  const absoluteUrl = new URL(source, page.url()).toString();
  const response = await page.request.get(absoluteUrl, { timeout: 60_000 });
  if (!response.ok()) {
    throw new Error(`Unable to read the generated image (${response.status()}).`);
  }
  return {
    contents: await response.body(),
    contentType: response.headers()['content-type'] || 'image/png',
  };
}

async function saveGeneratedImagePreview(page: Page, preview: Locator, requestedBaseName: string) {
  const image = preview.locator('img').last();
  if (await image.count().catch(() => 0) === 0) return null;
  const source = await image.getAttribute('src');
  if (!source) return null;

  const downloadedImage = await generatedImageContents(page, source);
  if (downloadedImage.contents.length === 0) {
    throw new Error('ChatGPT returned an empty generated image.');
  }

  const downloadsDirectory = path.join(homedir(), 'Downloads');
  mkdirSync(downloadsDirectory, { recursive: true });
  const baseName = safeDownloadFileName(requestedBaseName).replace(/\.[^.]+$/, '');
  const destination = availableDownloadPath(
    downloadsDirectory,
    `${baseName}${imageExtension(downloadedImage.contentType, source)}`,
  );
  writeFileSync(destination, downloadedImage.contents);
  return destination;
}

async function persistBrowserDownload(download: Download, requestedBaseName: string) {
  const failure = await download.failure();
  if (failure) throw new Error(`ChatGPT started the download, but Chrome could not save it: ${failure}`);

  const downloadsDirectory = path.join(homedir(), 'Downloads');
  mkdirSync(downloadsDirectory, { recursive: true });
  const suggestedExtension = path.extname(download.suggestedFilename()) || '.png';
  const requestedFileName = `${safeDownloadFileName(requestedBaseName).replace(/\.[^.]+$/, '')}${suggestedExtension}`;
  const destination = availableDownloadPath(downloadsDirectory, requestedFileName);
  await download.saveAs(destination);
  return destination;
}

async function captureBrowserDownload(
  page: Page,
  activate: () => Promise<void>,
  requestedBaseName: string,
  timeout = 12_000,
) {
  const downloadPromise = page.waitForEvent('download', { timeout }).catch(() => null);
  try {
    await activate();
  } catch {
    // The caller may try another activation method when ChatGPT changes its
    // file-card layout or another element covers the control.
  }
  const download = await downloadPromise;
  return download ? persistBrowserDownload(download, requestedBaseName) : null;
}

async function saveBrowserDownload(
  page: Page,
  target: Locator,
  requestedBaseName: string,
) {
  const pointerDownload = await captureBrowserDownload(
    page,
    async () => {
      await target.scrollIntoViewIfNeeded();
      await target.click({ timeout: 5_000 });
    },
    requestedBaseName,
  );
  if (pointerDownload) return pointerDownload;

  // Keyboard activation is a real Playwright input event and is not affected
  // by the full-card preview overlay intercepting pointer events.
  return captureBrowserDownload(
    page,
    async () => {
      await target.focus();
      await page.keyboard.press('Enter');
    },
    requestedBaseName,
  );
}

async function fileCardHoverTarget(page: Page, target: Locator) {
  const targetIsPreview = await target.getAttribute('aria-label')
    .then((label) => /^open preview of /i.test(label ?? ''))
    .catch(() => false);
  if (targetIsPreview && await isVisible(target)) return target;

  const containingCard = target.locator(
    'xpath=ancestor::*[.//button[starts-with(@aria-label, "Open preview of ")]][1]',
  );
  if (await containingCard.count().catch(() => 0) > 0) {
    const cardPreview = containingCard.locator('button[aria-label^="Open preview of "]').first();
    if (await isVisible(cardPreview)) return cardPreview;
  }

  const latestPreview = page.locator('button[aria-label^="Open preview of "]:visible').last();
  return await isVisible(latestPreview) ? latestPreview : null;
}

async function saveHoveredFileCardDownload(
  page: Page,
  target: Locator,
  requestedBaseName: string,
) {
  const hoverTarget = await fileCardHoverTarget(page, target);
  if (!hoverTarget) return null;

  await hoverTarget.scrollIntoViewIfNeeded().catch(() => undefined);
  // Reveal the control once and make exactly one download request. Repeated
  // pointer/keyboard attempts can obscure the original network failure and can
  // contribute to an unrelated 429 response while diagnosing ChatGPT.
  await hoverTarget.hover({ timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(750);

  const latestAssistant = assistantMessages(page).last();
  const assistantDownload = latestAssistant.locator([
    'button[aria-label="Download file" i]:visible',
    '[role="button"][aria-label="Download file" i]:visible',
    'button[title*="download" i]:visible',
    '[role="button"][title*="download" i]:visible',
  ].join(', ')).last();
  const pageDownload = page.locator([
    'button[aria-label="Download file" i]:visible',
    '[role="button"][aria-label="Download file" i]:visible',
    'button[title*="download" i]:visible',
    '[role="button"][title*="download" i]:visible',
  ].join(', ')).last();
  const downloadButton = await isVisible(assistantDownload) ? assistantDownload : pageDownload;
  if (!await isVisible(downloadButton)) return null;

  return captureBrowserDownload(
    page,
    async () => {
      await downloadButton.scrollIntoViewIfNeeded();
      await downloadButton.click({ timeout: 8_000 });
    },
    requestedBaseName,
    15_000,
  );
}

async function saveGeneratedFileDownload(
  page: Page,
  target: Locator,
  requestedBaseName: string,
) {
  // ChatGPT reveals the working file-card Download button only while the card
  // is hovered. Its separate preview can fail to load the same generated file,
  // so keep the browser in the conversation and press the revealed button.
  const hoveredDownload = await saveHoveredFileCardDownload(page, target, requestedBaseName);
  if (hoveredDownload) return hoveredDownload;

  // The original target may be ChatGPT's full-card "Open preview" overlay.
  // Never activate it as a fallback: the preview can show "Couldn't load this
  // file" even when the response card's own Download file control works.
  return null;
}

async function assistantDownloadTarget(page: Page, initialAssistantMessages: number) {
  const messages = assistantMessages(page);
  const messageCount = await messages.count().catch(() => 0);
  if (messageCount <= initialAssistantMessages) return null;
  const assistant = messages.last();
  const candidates = assistant.locator([
    'a[download]:visible',
    'a[href*="/mnt/data/"]:visible',
    'a[href*="/backend-api/files/"]:visible',
    'a[href*="download"]:visible',
    'button[aria-label*="download" i]:visible',
    'button[title*="download" i]:visible',
  ].join(', '));
  const candidateCount = await candidates.count().catch(() => 0);
  for (let index = candidateCount - 1; index >= 0; index -= 1) {
    const candidate = candidates.nth(index);
    if (await isVisible(candidate)) return candidate;
  }
  return null;
}

async function generatedFileTarget(
  page: Page,
  initialGeneratedFiles: number,
  initialGeneratedFileNames: number,
) {
  const targets = generatedFileTargets(page);
  const targetCount = await targets.count().catch(() => 0);
  if (targetCount > initialGeneratedFiles) {
    const target = targets.last();
    if (await isVisible(target)) return target;
  }

  const fileNames = generatedFileNameLabels(page);
  const fileNameCount = await fileNames.count().catch(() => 0);
  if (fileNameCount <= initialGeneratedFileNames) return null;
  const fileName = fileNames.last();
  for (const clickable of [
    fileName.locator('xpath=ancestor::a[1]'),
    fileName.locator('xpath=ancestor::button[1]'),
    fileName.locator('xpath=ancestor::*[@role="button"][1]'),
    fileName,
  ]) {
    if (await isVisible(clickable)) return clickable;
  }
  return null;
}

async function downloadGeneratedImage(
  page: Page,
  requestedBaseName: string,
  initialGeneratedImages: number,
  initialAssistantMessages: number,
  initialGeneratedFiles: number,
  initialGeneratedFileNames: number,
  outputKind: GeneratedOutputKind,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (outputKind === 'download_file') {
      const fileTarget = await generatedFileTarget(
        page,
        initialGeneratedFiles,
        initialGeneratedFileNames,
      );
      if (fileTarget) {
        const fileDownload = await saveGeneratedFileDownload(page, fileTarget, requestedBaseName);
        if (fileDownload) return fileDownload;
      }
    }

    const previews = generatedImagePreviews(page);
    const previewCount = await previews.count().catch(() => 0);
    if (previewCount > initialGeneratedImages) {
      const preview = previews.last();
      const previewDownload = await saveGeneratedImagePreview(page, preview, requestedBaseName)
        .catch(() => null);
      if (previewDownload) return previewDownload;

      await preview.click().catch(() => undefined);
      const viewerDownloadButton = page.getByRole('button', { name: 'Download', exact: true }).last();
      await viewerDownloadButton.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
      if (await isVisible(viewerDownloadButton)) {
        const viewerDownload = await saveBrowserDownload(page, viewerDownloadButton, requestedBaseName);
        if (viewerDownload) return viewerDownload;
      }
    }

    const downloadTarget = await assistantDownloadTarget(page, initialAssistantMessages);
    if (downloadTarget) {
      const fileDownload = await saveBrowserDownload(page, downloadTarget, requestedBaseName);
      if (fileDownload) return fileDownload;
    }

    const assistant = assistantMessages(page).last();
    if (await assistantMessages(page).count().catch(() => 0) > initialAssistantMessages) {
      const assistantImageDownload = await saveGeneratedImagePreview(page, assistant, requestedBaseName)
        .catch(() => null);
      if (assistantImageDownload) return assistantImageDownload;
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error('ChatGPT finished, but its generated image or downloadable PNG could not be found. The ChatGPT browser has been left open.');
}

async function runThumbnailAutomation(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;
  const outputLabel = job.workflow === 'listing_image' ? 'listing image' : 'thumbnail';
  const promptLabel = job.workflow === 'listing_image' ? 'Images / Listing Image' : 'Thumbnail prompt 1';

  try {
    updateJob(jobId, 'opening_browser', 'Opening a new ChatGPT browser tab.');
    const context = await getChatGptContext();
    const page = await context.newPage();
    await page.bringToFront();
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    let composer = await waitForComposer(page, jobId);
    const initialGeneratedImages = await generatedImagePreviews(page).count().catch(() => 0);
    const initialAssistantMessages = await assistantMessages(page).count().catch(() => 0);

    if (job.attachment) {
      updateJob(jobId, 'submitting_prompt', `Attaching ${job.attachment.fileName} to ChatGPT.`);
      await attachFileToComposer(page, composer, [job.attachment]);
      job.attachment = undefined;
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(250);
      composer = await chatGptComposer(page)
        ?? await waitForComposer(page, jobId);
    }

    updateJob(jobId, 'submitting_prompt', `Submitting ${promptLabel} to ChatGPT.`);
    await submitPrompt(page, composer, job.prompt);
    await page.waitForTimeout(500);
    const initialGeneratedFiles = await generatedFileTargets(page).count().catch(() => 0);
    const initialGeneratedFileNames = await generatedFileNameLabels(page).count().catch(() => 0);

    updateJob(jobId, 'generating', `ChatGPT is generating the ${outputLabel}. The browser will remain open.`);
    await monitorGeneration(
      jobId,
      page,
      initialGeneratedImages,
      initialAssistantMessages,
      initialGeneratedFiles,
      initialGeneratedFileNames,
      'inline_image',
    );

    updateJob(jobId, 'downloading', `ChatGPT has finished. Downloading the generated ${outputLabel}.`);
    const downloadPath = await downloadGeneratedImage(
      page,
      `${job.listingName}-${job.workflow === 'listing_image' ? 'listing-image' : 'thumbnail'}`,
      initialGeneratedImages,
      initialAssistantMessages,
      initialGeneratedFiles,
      initialGeneratedFileNames,
      'inline_image',
    );
    const completedJob = jobs.get(jobId);
    if (completedJob) {
      completedJob.downloadFileName = path.basename(downloadPath);
      completedJob.downloadPath = downloadPath;
    }
    updateJob(jobId, 'completed', `${job.workflow === 'listing_image' ? 'Listing image' : 'Thumbnail'} downloaded to ${downloadPath}.`);
    await page.bringToFront().catch(() => undefined);
  } catch (error) {
    updateJob(
      jobId,
      'failed',
      error instanceof Error ? error.message : `Unable to generate the ${outputLabel} in ChatGPT.`,
    );
  }
}

async function runListingTextAutomation(jobId: string) {
  const job = jobs.get(jobId);
  if (!job?.listingContext) return;
  const context = await getChatGptContext();
  const page = await context.newPage();
  let completed = false;
  try {
    await page.bringToFront();
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const composer = await waitForComposer(page, jobId);
    const initialAssistantMessages = await assistantMessages(page).count().catch(() => 0);
    updateJob(jobId, 'submitting_prompt', 'Submitting the combined Print and Digital Download details prompt to ChatGPT.');
    await submitPrompt(page, composer, job.prompt);
    updateJob(jobId, 'generating', 'ChatGPT is creating the Print and Digital Download titles, descriptions and Etsy tags.');
    const responseText = await waitForGeneratedListingText(jobId, page, initialAssistantMessages);
    updateJob(jobId, 'downloading', 'Validating and saving the generated listing details.');
    const [{ parseGeneratedListingDetails }, { saveGeneratedListingDetails }] = await Promise.all([
      import('@/lib/combined-listing-details-prompt'),
      import('@/lib/listing-editor'),
    ]);
    const generated = parseGeneratedListingDetails(responseText);
    await saveGeneratedListingDetails(job.listingContext, generated);
    completed = true;
    updateJob(jobId, 'completed', 'Print and Digital Download titles and descriptions, plus Etsy tags, were saved and verified.');
  } catch (error) {
    updateJob(
      jobId,
      'failed',
      error instanceof Error ? error.message : 'Unable to create the Etsy listing details in ChatGPT.',
    );
  } finally {
    if (completed) await page.close().catch(() => undefined);
    else await page.bringToFront().catch(() => undefined);
  }
}

async function runListingDetailStep(
  jobId: string,
  label: string,
  prompt: string,
  attachments: AutomationAttachment[],
  requestedBaseName: string,
  outputKind: GeneratedOutputKind,
) {
  const context = await getChatGptContext();
  const page = await context.newPage();
  let completed = false;
  try {
    await page.bringToFront();
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    let composer = await waitForComposer(page, jobId);
    const initialGeneratedImages = await generatedImagePreviews(page).count().catch(() => 0);
    const initialAssistantMessages = await assistantMessages(page).count().catch(() => 0);

    updateJob(jobId, 'submitting_prompt', `Attaching the source files for ${label}.`);
    await attachFileToComposer(page, composer, attachments);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(250);
    composer = await chatGptComposer(page) ?? await waitForComposer(page, jobId);

    updateJob(jobId, 'submitting_prompt', `Submitting the ${label} prompt to ChatGPT.`);
    await submitPrompt(page, composer, prompt);
    await page.waitForTimeout(500);
    const initialGeneratedFiles = await generatedFileTargets(page).count().catch(() => 0);
    const initialGeneratedFileNames = await generatedFileNameLabels(page).count().catch(() => 0);
    updateJob(jobId, 'generating', `ChatGPT is generating ${label}.`);
    await monitorGeneration(
      jobId,
      page,
      initialGeneratedImages,
      initialAssistantMessages,
      initialGeneratedFiles,
      initialGeneratedFileNames,
      outputKind,
    );
    updateJob(jobId, 'downloading', `Downloading ${label}.`);
    const downloadPath = await downloadGeneratedImage(
      page,
      requestedBaseName,
      initialGeneratedImages,
      initialAssistantMessages,
      initialGeneratedFiles,
      initialGeneratedFileNames,
      outputKind,
    );
    completed = true;
    return downloadPath;
  } finally {
    if (completed) {
      await page.close().catch(() => undefined);
    } else {
      // Keep a failed stage visible so its generated response, DevTools network
      // requests and download control can be inspected or retried manually.
      await page.bringToFront().catch(() => undefined);
    }
  }
}

async function runListingDetailAutomation(jobId: string) {
  const job = jobs.get(jobId);
  if (!job?.listingContext || !job.attachment || !job.listingDetailPlans) return;

  try {
    const { replaceListingImageAtPosition } = await import('@/lib/listing-editor');
    const thumbnailAttachment = job.attachment;
    const plans: ListingDetailAutomationPlan[] = job.listingDetailPlans;
    const totalStages = plans.reduce(
      (count: number, plan: ListingDetailAutomationPlan) => count + plan.steps.length,
      0,
    );
    let completedStages = 0;

    for (const plan of plans) {
      let sourceAttachment = thumbnailAttachment;
      let finalPath = '';
      for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex += 1) {
        const step = plan.steps[stepIndex];
        const stepLabel = plan.steps.length > 1
          ? `${plan.label} (stage ${stepIndex + 1} of ${plan.steps.length})`
          : plan.label;
        const requestedBaseName = `${job.listingName}-${plan.position}-${plan.key}-stage-${stepIndex + 1}`;
        if (step.processor === 'local_print_master') {
          finalPath = await createLocalPrintMasterDownload(
            jobId,
            `${stepLabel}; ${completedStages + 1} of ${totalStages} stages`,
            sourceAttachment,
            requestedBaseName,
          );
        } else if (step.processor === 'local_personalisation') {
          if (!step.localPersonalisation) throw new Error(`${stepLabel} is missing its local personalisation settings.`);
          if (!job.fontAttachment) throw new Error(`${stepLabel} requires Nunito-Regular.ttf.`);
          finalPath = await createLocalPersonalisationDownload(
            jobId,
            `${stepLabel}; ${completedStages + 1} of ${totalStages} stages`,
            sourceAttachment,
            job.fontAttachment,
            step.localPersonalisation,
            requestedBaseName,
          );
        } else {
          const attachments = [sourceAttachment];
          if (step.includeFont && job.fontAttachment) attachments.push(job.fontAttachment);
          finalPath = await runListingDetailStep(
            jobId,
            `${stepLabel}; ${completedStages + 1} of ${totalStages} stages`,
            step.prompt,
            attachments,
            requestedBaseName,
            step.outputKind ?? 'inline_image',
          );
        }
        completedStages += 1;
        sourceAttachment = {
          fileName: path.basename(finalPath),
          mimeType: finalPath.toLowerCase().endsWith('.jpg') || finalPath.toLowerCase().endsWith('.jpeg')
            ? 'image/jpeg'
            : finalPath.toLowerCase().endsWith('.webp')
              ? 'image/webp'
              : 'image/png',
          contents: readFileSync(finalPath),
        };
      }

      if (!finalPath) throw new Error(`${plan.label} did not produce an image.`);
      updateJob(jobId, 'downloading', `Uploading ${plan.label} to image position ${plan.position}.`);
      await replaceListingImageAtPosition(
        job.listingContext,
        plan.position,
        readFileSync(finalPath),
        path.basename(finalPath),
      );
      const currentJob = jobs.get(jobId);
      if (currentJob) {
        currentJob.downloadPath = finalPath;
        currentJob.downloadFileName = path.basename(finalPath);
      }
    }

    job.attachment = undefined;
    job.fontAttachment = undefined;
    job.listingDetailPlans = undefined;
    updateJob(
      jobId,
      'completed',
      `${plans.length} listing image${plans.length === 1 ? '' : 's'} created and verified in S3 and the database.`,
    );
  } catch (error) {
    updateJob(
      jobId,
      'failed',
      error instanceof Error ? error.message : 'Unable to create the listing images in ChatGPT.',
    );
  }
}

function safeStagePathSegment(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'listing';
}

function listingDetailStageDirectory(listingId: string, detailKey: string) {
  return path.join(
    process.cwd(),
    '.playwright',
    'listing-detail-stages',
    safeStagePathSegment(listingId),
    safeStagePathSegment(detailKey),
  );
}

function listingDetailStagePath(listingId: string, detailKey: string, stepIndex: number) {
  const directory = listingDetailStageDirectory(listingId, detailKey);
  if (!existsSync(directory)) return null;
  const prefix = `stage-${stepIndex + 1}.`;
  const fileName = readdirSync(directory).find((candidate) => candidate.startsWith(prefix));
  return fileName ? path.join(directory, fileName) : null;
}

function clearListingDetailStageOutputsFrom(listingId: string, detailKey: string, stepIndex: number) {
  const directory = listingDetailStageDirectory(listingId, detailKey);
  if (!existsSync(directory)) return;
  for (const fileName of readdirSync(directory)) {
    const match = /^stage-(\d+)\./.exec(fileName);
    if (!match || Number(match[1]) < stepIndex + 1) continue;
    unlinkSync(path.join(directory, fileName));
  }
}

function preserveListingDetailStageOutput(
  listingId: string,
  detailKey: string,
  stepIndex: number,
  sourcePath: string,
) {
  const directory = listingDetailStageDirectory(listingId, detailKey);
  mkdirSync(directory, { recursive: true });
  const extension = path.extname(sourcePath).toLowerCase() || '.png';
  const destination = path.join(directory, `stage-${stepIndex + 1}${extension}`);
  copyFileSync(sourcePath, destination);
  return destination;
}

async function runListingDetailIndividualAutomation(jobId: string) {
  const job = jobs.get(jobId);
  if (!job?.listingContext || !job.attachment || !job.listingDetailIndividual) return;

  const individual = job.listingDetailIndividual;
  try {
    const stepLabel = `${individual.label} (individual stage ${individual.stepIndex + 1} of ${individual.stepCount})`;
    let finalPath: string;
    if (individual.step.processor === 'local_print_master') {
      finalPath = await createLocalPrintMasterDownload(
        jobId,
        stepLabel,
        job.attachment,
        `${job.listingName}-${individual.outputBaseName}`,
      );
    } else if (individual.step.processor === 'local_personalisation') {
      if (!individual.step.localPersonalisation) throw new Error(`${stepLabel} is missing its local personalisation settings.`);
      if (!job.fontAttachment) throw new Error(`${stepLabel} requires Nunito-Regular.ttf.`);
      finalPath = await createLocalPersonalisationDownload(
        jobId,
        stepLabel,
        job.attachment,
        job.fontAttachment,
        individual.step.localPersonalisation,
        `${job.listingName}-${individual.outputBaseName}`,
      );
    } else {
      const attachments = [job.attachment];
      if (individual.step.includeFont && job.fontAttachment) attachments.push(job.fontAttachment);
      finalPath = await runListingDetailStep(
        jobId,
        stepLabel,
        individual.step.prompt,
        attachments,
        `${job.listingName}-${individual.outputBaseName}`,
        individual.step.outputKind ?? 'inline_image',
      );
    }
    const preservedPath = preserveListingDetailStageOutput(
      job.listingId,
      individual.key,
      individual.stepIndex,
      finalPath,
    );

    if (individual.stepIndex === individual.stepCount - 1) {
      const { replaceListingImageAtPosition } = await import('@/lib/listing-editor');
      updateJob(jobId, 'downloading', `Uploading ${individual.label} to image position ${individual.position}.`);
      await replaceListingImageAtPosition(
        job.listingContext,
        individual.position,
        readFileSync(preservedPath),
        path.basename(finalPath),
      );
    }

    job.downloadPath = finalPath;
    job.downloadFileName = path.basename(finalPath);
    job.attachment = undefined;
    job.fontAttachment = undefined;
    job.listingDetailIndividual = undefined;
    updateJob(
      jobId,
      'completed',
      individual.stepIndex === individual.stepCount - 1
        ? `${individual.label} stage ${individual.stepIndex + 1} completed and the Etsy image was verified in S3 and the database.`
        : `${individual.label} stage ${individual.stepIndex + 1} completed. The downloaded result is ready for stage ${individual.stepIndex + 2}.`,
    );
  } catch (error) {
    updateJob(
      jobId,
      'failed',
      error instanceof Error ? error.message : `Unable to complete ${individual.label} stage ${individual.stepIndex + 1}.`,
    );
  }
}

export function startThumbnailAutomation(input: {
  listingId: string;
  listingName: string;
  prompt: string;
}) {
  cleanOldJobs();
  expireStaleJobs();
  const activeJob = [...jobs.values()].find((job) => !TERMINAL_STATUSES.has(job.status));
  if (activeJob) {
    throw new Error(`ChatGPT is already working on ${activeJob.listingName}. Wait for that image to finish.`);
  }

  const now = new Date().toISOString();
  const job: StoredThumbnailAutomationJob = {
    id: randomUUID(),
    listingId: input.listingId,
    listingName: input.listingName,
    workflow: 'thumbnail',
    prompt: input.prompt,
    status: 'opening_browser',
    message: 'Preparing to open ChatGPT.',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  void runThumbnailAutomation(job.id);
  return publicJob(job);
}

export function startListingImageAutomation(input: {
  listingId: string;
  listingName: string;
  prompt: string;
  attachment: {
    fileName: string;
    mimeType: string;
    contents: Buffer;
  };
}) {
  cleanOldJobs();
  expireStaleJobs();
  const activeJob = [...jobs.values()].find((job) => !TERMINAL_STATUSES.has(job.status));
  if (activeJob) {
    throw new Error(`ChatGPT is already working on ${activeJob.listingName}. Wait for that image to finish.`);
  }

  const now = new Date().toISOString();
  const job: StoredThumbnailAutomationJob = {
    id: randomUUID(),
    listingId: input.listingId,
    listingName: input.listingName,
    workflow: 'listing_image',
    prompt: input.prompt,
    attachment: input.attachment,
    status: 'opening_browser',
    message: 'Preparing to open ChatGPT and attach the thumbnail.',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  void runThumbnailAutomation(job.id);
  return publicJob(job);
}

export function startListingTextAutomation(input: {
  listingId: string;
  listingName: string;
  listingContext: NonNullable<StoredThumbnailAutomationJob['listingContext']>;
  prompt: string;
}) {
  cleanOldJobs();
  expireStaleJobs();
  const activeJob = [...jobs.values()].find((job) => !TERMINAL_STATUSES.has(job.status));
  if (activeJob) {
    throw new Error(`ChatGPT is already working on ${activeJob.listingName}. Wait for that job to finish.`);
  }

  const now = new Date().toISOString();
  const job: StoredThumbnailAutomationJob = {
    id: randomUUID(),
    listingId: input.listingId,
    listingName: input.listingName,
    workflow: 'listing_text',
    prompt: input.prompt,
    listingContext: input.listingContext,
    status: 'opening_browser',
    message: 'Preparing the combined Print and Digital Download details prompt.',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  void runListingTextAutomation(job.id);
  return publicJob(job);
}

export function startListingDetailAutomation(input: {
  listingId: string;
  listingName: string;
  listingContext: NonNullable<StoredThumbnailAutomationJob['listingContext']>;
  thumbnailAttachment: AutomationAttachment;
  fontAttachment: AutomationAttachment;
  plans: ListingDetailAutomationPlan[];
}) {
  cleanOldJobs();
  expireStaleJobs();
  const activeJob = [...jobs.values()].find((job) => !TERMINAL_STATUSES.has(job.status));
  if (activeJob) {
    throw new Error(`ChatGPT is already working on ${activeJob.listingName}. Wait for that image to finish.`);
  }
  if (input.plans.length === 0) throw new Error('Choose at least one listing image to create.');

  const now = new Date().toISOString();
  const job: StoredThumbnailAutomationJob = {
    id: randomUUID(),
    listingId: input.listingId,
    listingName: input.listingName,
    workflow: 'listing_details',
    prompt: '',
    attachment: input.thumbnailAttachment,
    fontAttachment: input.fontAttachment,
    listingDetailPlans: input.plans,
    listingContext: input.listingContext,
    status: 'opening_browser',
    message: `Preparing ${input.plans.length} listing image${input.plans.length === 1 ? '' : 's'}.`,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  void runListingDetailAutomation(job.id);
  return publicJob(job);
}

export function getListingDetailIndividualProgress(
  listingId: string,
  detailKey: string,
  stepCount: number,
) {
  return Array.from({ length: stepCount }, (_, stepIndex) => {
    const outputPath = listingDetailStagePath(listingId, detailKey, stepIndex);
    return {
      stepIndex,
      completed: Boolean(outputPath && existsSync(outputPath)),
      fileName: outputPath ? path.basename(outputPath) : null,
    };
  });
}

export function getListingDetailIndividualStageOutput(
  listingId: string,
  detailKey: string,
  stepIndex: number,
) {
  const outputPath = listingDetailStagePath(listingId, detailKey, stepIndex);
  if (!outputPath || !existsSync(outputPath)) return null;
  return {
    path: outputPath,
    fileName: path.basename(outputPath),
    contents: readFileSync(outputPath),
  };
}

export function startListingDetailIndividualAutomation(input: {
  listingId: string;
  listingName: string;
  listingContext: NonNullable<StoredThumbnailAutomationJob['listingContext']>;
  sourceAttachment: AutomationAttachment;
  fontAttachment?: AutomationAttachment;
  key: string;
  label: string;
  position: number;
  stepIndex: number;
  stepCount: number;
  outputBaseName: string;
  step: ListingDetailAutomationPlan['steps'][number];
}) {
  cleanOldJobs();
  expireStaleJobs();
  const activeJob = [...jobs.values()].find((job) => !TERMINAL_STATUSES.has(job.status));
  if (activeJob) {
    throw new Error(`ChatGPT is already working on ${activeJob.listingName}. Wait for that image to finish.`);
  }

  clearListingDetailStageOutputsFrom(input.listingId, input.key, input.stepIndex);
  const now = new Date().toISOString();
  const job: StoredThumbnailAutomationJob = {
    id: randomUUID(),
    listingId: input.listingId,
    listingName: input.listingName,
    workflow: 'listing_detail_step',
    prompt: input.step.prompt,
    attachment: input.sourceAttachment,
    fontAttachment: input.fontAttachment,
    listingContext: input.listingContext,
    listingDetailIndividual: {
      key: input.key,
      label: input.label,
      position: input.position,
      stepIndex: input.stepIndex,
      stepCount: input.stepCount,
      outputBaseName: input.outputBaseName,
      step: input.step,
    },
    detailKey: input.key,
    detailStepIndex: input.stepIndex,
    detailStepCount: input.stepCount,
    status: 'opening_browser',
    message: `Preparing ${input.label} stage ${input.stepIndex + 1} of ${input.stepCount}.`,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  void runListingDetailIndividualAutomation(job.id);
  return publicJob(job);
}

export function getCompletedThumbnailAutomationResult(jobId: string) {
  const job = jobs.get(jobId);
  if (!job || job.workflow !== 'thumbnail' || job.status !== 'completed' || !job.downloadPath) return null;
  if (!existsSync(job.downloadPath)) return null;
  return {
    listingId: job.listingId,
    path: job.downloadPath,
    fileName: job.downloadFileName ?? path.basename(job.downloadPath),
    contents: readFileSync(job.downloadPath),
  };
}

export function discardThumbnailAutomationResult(jobId: string) {
  const result = getCompletedThumbnailAutomationResult(jobId);
  if (!result) return false;
  unlinkSync(result.path);
  const job = jobs.get(jobId);
  if (job) {
    job.downloadPath = undefined;
    job.downloadFileName = undefined;
    job.message = 'Generated thumbnail discarded.';
    job.updatedAt = new Date().toISOString();
  }
  return true;
}

export function getThumbnailAutomationJob(jobId: string) {
  expireStaleJobs();
  const job = jobs.get(jobId);
  return job ? publicJob(job) : null;
}

export function getLatestThumbnailAutomationJob(listingId: string) {
  expireStaleJobs();
  const matchingJobs = [...jobs.values()]
    .filter((job) => job.listingId === listingId)
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
  return matchingJobs[0] ? publicJob(matchingJobs[0]) : null;
}

export async function openChatGptSignInBrowser() {
  for (const job of jobs.values()) {
    if (!TERMINAL_STATUSES.has(job.status)) {
      updateJob(
        job.id,
        'failed',
        'Thumbnail generation stopped so ChatGPT can be signed in through a normal browser.',
      );
    }
  }

  const existingContext = automationGlobals.__etsyThumbnailAutomationContext;
  if (existingContext) {
    await existingContext.close().catch(() => undefined);
    automationGlobals.__etsyThumbnailAutomationContext = undefined;
    automationGlobals.__etsyThumbnailAutomationContextPromise = undefined;
  }

  const executable = installedBrowserExecutable();
  if (!executable) throw new Error('Google Chrome or Microsoft Edge could not be found on this computer.');

  const child = spawn(executable, [
    `--user-data-dir=${chatGptProfileDirectory()}`,
    '--no-first-run',
    '--no-default-browser-check',
    CHATGPT_URL,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}
