import { useAuth } from './useAuth';
import { importFromDrive, pickerAvailable } from './picker';
import { isSimulation } from '../sim/mode';

/** A "From Google Drive…" button (Google Picker, drive.file). Hidden when Drive is not available (signed out, simulation, no API key). */
export function DriveImportButton({ mimeTypes, title, onFile, onError, disabled }: { mimeTypes: string; title: string; onFile: (f: { bytes: Uint8Array; mime: string; name: string }) => void | Promise<void>; onError: (message: string) => void; disabled?: boolean }) {
  const { profile } = useAuth();
  if (!pickerAvailable() || !profile || isSimulation()) return null;
  return (
    <button
      type="button"
      className="secondary"
      disabled={disabled}
      onClick={async () => {
        try {
          const f = await importFromDrive(mimeTypes, title);
          if (f) await onFile(f);
        } catch (e) {
          onError((e as Error).message);
        }
      }}
    >
      From Google Drive…
    </button>
  );
}
