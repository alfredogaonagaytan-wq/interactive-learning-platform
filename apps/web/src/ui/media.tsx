import { useId, useRef, useState, type ImgHTMLAttributes } from 'react';
import type { ImageRef } from '@ilp/core';
import { addImageFile, useAssetUrl } from '../storage/assets';
import { DriveImportButton } from '../google/DriveImportButton';

/** Render a stored image. Missing assets show a visible placeholder instead of a broken image. */
export function AssetImage({ image, className, ...rest }: { image: ImageRef } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>) {
  const { url, missing } = useAssetUrl(image.assetId);
  if (missing) return <span className={`asset-missing ${className ?? ''}`} role="img" aria-label={image.alt || 'Missing image'}>Image not available on this device</span>;
  if (!url) return <span className={`asset-loading ${className ?? ''}`} aria-hidden="true" />;
  return <img src={url} alt={image.decorative ? '' : image.alt} className={className} draggable={false} {...rest} />;
}

/** Upload / replace / remove an image with required alt text. */
export function ImageField({ label, value, onChange, allowDecorative = true }: { label: string; value: ImageRef | null; onChange: (v: ImageRef | null) => void; allowDecorative?: boolean }) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <fieldset className="image-field">
      <legend>{label}</legend>
      {value && <AssetImage image={value} className="image-preview" />}
      <div className="row">
        <button type="button" className="secondary" disabled={busy} onClick={() => file.current?.click()}>{value ? 'Replace image…' : 'Choose image…'}</button>
        <DriveImportButton
          mimeTypes="image/png,image/jpeg,image/gif,image/webp"
          title="Choose an image"
          disabled={busy}
          onError={setError}
          onFile={async (d) => {
            setError(null);
            try {
              const assetId = await addImageFile(new File([d.bytes as Uint8Array<ArrayBuffer>], d.name, { type: d.mime }));
              onChange({ assetId, alt: value?.alt ?? '', decorative: value?.decorative ?? false });
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
        {value && <button type="button" className="ghost danger" onClick={() => onChange(null)}>Remove</button>}
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          aria-label={`${label}: upload`}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            setError(null);
            try {
              const assetId = await addImageFile(f);
              onChange({ assetId, alt: value?.alt ?? '', decorative: value?.decorative ?? false });
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {value && (
        <>
          <div className="field">
            <label htmlFor={`${id}-alt`}>Alt text (describe the image)</label>
            <input id={`${id}-alt`} type="text" value={value.alt} disabled={value.decorative} onChange={(e) => onChange({ ...value, alt: e.target.value })} />
          </div>
          {allowDecorative && (
            <label className="check">
              <input type="checkbox" checked={value.decorative} onChange={(e) => onChange({ ...value, decorative: e.target.checked })} /> Decorative only (screen readers skip it)
            </label>
          )}
        </>
      )}
      <p className="field-hint">PNG, JPEG, GIF or WebP, up to 5 MB. Images are stored on this device and included in exported packages.</p>
    </fieldset>
  );
}
