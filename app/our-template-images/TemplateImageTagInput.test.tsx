import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TemplateImageTag } from '@/lib/our-template-image-tag-types';
import { TemplateImageTagInput, type TemplateImageTagInputProps } from './TemplateImageTagInput';

const tags: TemplateImageTag[] = [
  { id: 'nursery', name: 'Nursery' }, { id: 'nursery-room', name: 'Nursery room' },
  { id: 'minimal', name: 'Minimal' }, { id: 'bedroom', name: 'Bedroom' },
];
const fetchTag = vi.fn();

function Controlled({ initial = [], onChange = vi.fn(), ...props }: Partial<Omit<TemplateImageTagInputProps, 'selected'>> & { initial?: TemplateImageTag[] }) {
  const [selected, setSelected] = useState(initial);
  return <TemplateImageTagInput tags={tags} {...props} selected={selected} onChange={(next) => { setSelected(next); onChange(next); }} />;
}
function response(tag: TemplateImageTag) { return { ok: true, json: async () => ({ tag }) }; }

beforeEach(() => { fetchTag.mockReset(); vi.stubGlobal('fetch', fetchTag); });
afterEach(() => vi.unstubAllGlobals());

describe('template image tag picker', () => {
  it('filters case-insensitively, selects the active keyboard option and removes chips', async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.type(input, 'NUR');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Nursery', 'Nursery room']);
    await user.keyboard('{ArrowDown}');
    const active = screen.getByRole('option', { name: 'Nursery room' });
    expect(input.getAttribute('aria-activedescendant')).toBe(active.id);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith([tags[1]]);
    expect(screen.getByText('1 of 10 tags')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove tag Nursery room' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove tag Nursery room' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('supports click selection, excludes selected tags and prevents duplicate creation by name', async () => {
    const user = userEvent.setup();
    render(<Controlled allowCreate initial={[tags[0]]} />);
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.type(input, 'nursery');
    expect(screen.queryByRole('option', { name: 'Nursery' })).toBeNull();
    expect(screen.queryByRole('option', { name: /Create tag/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Nursery room' }));
    expect(screen.getByText('2 of 10 tags')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove tag Nursery' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove tag Nursery room' })).toBeTruthy();
  });

  it('starts at the first empty-query option with ArrowDown and wraps backwards with ArrowUp', async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.click(input); await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Nursery' }).id);
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith([tags[3]]);
  });

  it('closes suggestions with Escape, leaves Tab navigation free and prevents outer form submission', async () => {
    const user = userEvent.setup(), submit = vi.fn((event) => event.preventDefault()), escape = vi.fn();
    render(<form onSubmit={submit} onKeyDown={(event) => { if (event.key === 'Escape') escape(); }}><Controlled /><button type="button">Next field</button></form>);
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.type(input, 'missing'); await user.keyboard('{Enter}');
    expect(submit).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull(); expect(escape).not.toHaveBeenCalled();
    await user.click(input); await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next field' }));
  });

  it('disables adding at ten tags while keeping removal available', async () => {
    const user = userEvent.setup(), initial = Array.from({ length: 10 }, (_, index) => ({ id: String(index), name: `Tag ${index}` }));
    render(<Controlled initial={initial} tags={[...initial, { id: 'extra', name: 'Extra' }]} />);
    const input = screen.getByRole('combobox', { name: 'Tags' }) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText(/10 of 10 tags/).textContent).toContain('Remove a tag');
    const remove = screen.getByRole('button', { name: 'Remove tag Tag 0' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    await user.click(remove);
    expect(input.disabled).toBe(false);
    await user.type(input, 'Extra'); await user.keyboard('{Enter}');
    expect(input.disabled).toBe(true); expect(screen.getByRole('button', { name: 'Remove tag Extra' })).toBeTruthy();
  });

  it('does not offer creation in search-only mode and respects a disabled picker', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Controlled label="Search by tags" />);
    await user.type(screen.getByRole('combobox', { name: 'Search by tags' }), 'New tag');
    expect(screen.queryByRole('option', { name: /Create tag/ })).toBeNull();
    expect(screen.getByText('No matching tags.')).toBeTruthy();
    rerender(<Controlled label="Search by tags" initial={[tags[0]]} disabled />);
    expect((screen.getByRole('combobox', { name: 'Search by tags' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('creates explicitly, locks duplicate Enter requests and reports busy state through assignment', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    fetchTag.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const user = userEvent.setup(), onCreated = vi.fn(), onChange = vi.fn(), onBusyChange = vi.fn();
    render(<Controlled allowCreate onCreated={onCreated} onChange={onChange} onBusyChange={onBusyChange} />);
    const input = screen.getByRole('combobox', { name: 'Tags' }) as HTMLInputElement;
    await user.type(input, 'Coastal');
    expect(screen.getByRole('option', { name: 'Create tag "Coastal"' })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(fetchTag).toHaveBeenCalledTimes(1);
    expect(fetchTag).toHaveBeenCalledWith('/api/our-template-image-tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Coastal' }) });
    expect(input.readOnly).toBe(true); expect(onBusyChange.mock.calls).toEqual([[true]]);
    const tag = { id: 'coastal', name: 'Coastal' };
    await act(async () => { resolve(response(tag)); });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(tag); expect(onChange).toHaveBeenLastCalledWith([tag]);
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    expect(input.readOnly).toBe(false); expect(screen.getByRole('button', { name: 'Remove tag Coastal' })).toBeTruthy();
  });

  it('surfaces creation errors, keeps selection and releases busy state for retry', async () => {
    fetchTag.mockResolvedValue({ ok: false, json: async () => ({ error: 'A tag name must be shorter.' }) });
    const user = userEvent.setup(), onBusyChange = vi.fn(), onChange = vi.fn();
    render(<Controlled allowCreate initial={[tags[0]]} onBusyChange={onBusyChange} onChange={onChange} />);
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'Too long'); await user.keyboard('{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe('A tag name must be shorter.');
    expect(onChange).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Remove tag Nursery' })).toBeTruthy();
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    fetchTag.mockResolvedValue(response({ id: 'retry', name: 'Too long' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove tag Too long' })).toBeTruthy());
  });

  it('keeps a selected catalogue tag when the create endpoint returns that existing tag', async () => {
    fetchTag.mockResolvedValue(response(tags[0]));
    const user = userEvent.setup(), onCreated = vi.fn(), onChange = vi.fn();
    render(<Controlled allowCreate initial={[tags[0]]} onCreated={onCreated} onChange={onChange} />);
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'An alias'); await user.keyboard('{Enter}');
    await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith(tags[0]));
    expect(onChange).not.toHaveBeenCalled(); expect(screen.getByText('1 of 10 tags')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove tag Nursery' })).toHaveLength(1);
  });

  it('uses the latest controlled selection when a create request resolves', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    fetchTag.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const user = userEvent.setup(), onChange = vi.fn(), onCreated = vi.fn();
    const { rerender } = render(<TemplateImageTagInput allowCreate tags={tags} selected={[tags[0]]} onChange={onChange} onCreated={onCreated} />);
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'Coastal'); await user.keyboard('{Enter}');
    rerender(<TemplateImageTagInput allowCreate tags={tags} selected={[tags[2]]} onChange={onChange} onCreated={onCreated} />);
    const tag = { id: 'coastal', name: 'Coastal' };
    await act(async () => { resolve(response(tag)); });
    expect(onChange).toHaveBeenLastCalledWith([tags[2], tag]); expect(onCreated).toHaveBeenCalledExactlyOnceWith(tag);
  });

  it('keeps the limit when the parent fills the last slot while creation is pending', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    fetchTag.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const user = userEvent.setup(), onChange = vi.fn(), onCreated = vi.fn();
    const selected = Array.from({ length: 10 }, (_, index) => ({ id: String(index), name: `Tag ${index}` }));
    const { rerender } = render(<TemplateImageTagInput allowCreate tags={selected} selected={selected.slice(0, 9)} onChange={onChange} onCreated={onCreated} />);
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'Coastal'); await user.keyboard('{Enter}');
    rerender(<TemplateImageTagInput allowCreate tags={selected} selected={selected} onChange={onChange} onCreated={onCreated} />);
    const tag = { id: 'coastal', name: 'Coastal' };
    await act(async () => { resolve(response(tag)); });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(tag); expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('up to 10 tags');
    expect((screen.getByRole('combobox', { name: 'Tags' }) as HTMLInputElement).disabled).toBe(true);
  });
});
