import { useEffect, useState } from 'react';
import { SceneEditor, SceneTest, newestScenes, type SceneImage } from './SceneImageEditor';
import type { TemplateImageTag } from '@/lib/our-template-image-tag-types';

/** Keeps detailed scene regressions independent of the parent library workflow. */
export function SceneEditorTestHarness() {
  const [images, setImages] = useState<SceneImage[]>([]);
  const [tags, setTags] = useState<TemplateImageTag[]>([]);
  const [editing, setEditing] = useState<SceneImage | null>(null);
  const [testing, setTesting] = useState<SceneImage | null>(null);
  useEffect(() => {
    let active = true;
    void fetch('/api/our-template-images').then(response => response.json()).then(payload => { if (active) setImages(newestScenes(payload.images)); });
    void fetch('/api/our-template-image-tags').then(response => response.json()).then(payload => { if (active) setTags(payload.tags ?? []); });
    return () => { active = false; };
  }, []);
  function update(image: SceneImage) { setImages(current => newestScenes([...current.filter(saved => saved.id !== image.id), image])); }
  if (editing) return <SceneEditor initial={editing} tagOptions={tags} tagsLoading={false} tagsError={null}
    onReloadTags={() => {}} onTagCreated={tag => setTags(current => [...current, tag])} onCancel={() => setEditing(null)}
    onSaved={image => { update(image); setEditing(null); }} />;
  return <>{images.map(image => <div key={image.id}><button onClick={() => setEditing(image)}>Edit {image.name}</button><button onClick={() => setTesting(image)}>Test {image.name}</button></div>)}
    {testing ? <SceneTest scene={testing} onClose={() => setTesting(null)} onFitted={image => { update(image); setTesting(image); }} /> : null}</>;
}
