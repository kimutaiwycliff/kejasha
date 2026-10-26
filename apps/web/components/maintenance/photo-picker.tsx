'use client';
import { Button } from '@kejasha/ui/components/button';
import { ImagePlus } from 'lucide-react';
import { useState } from 'react';
import { toastError } from '@/lib/hooks';
import { uploadFile } from '@/lib/upload';

/** Uploads photos straight to storage and reports their keys (max 10). */
export function PhotoPicker({
  keys,
  onChange,
  purpose = 'maintenance_photo',
}: {
  keys: string[];
  onChange: (keys: string[]) => void;
  purpose?: 'maintenance_photo' | 'inspection_photo';
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || keys.length >= 10}
        render={<label />}
        nativeButton={false}
      >
        <ImagePlus /> {busy ? 'Uploading…' : 'Add photos'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])].slice(0, 10 - keys.length);
            e.target.value = '';
            setBusy(true);
            try {
              const added: string[] = [];
              for (const f of files) added.push(await uploadFile(f, purpose));
              onChange([...keys, ...added]);
            } catch (err) {
              toastError(err);
            } finally {
              setBusy(false);
            }
          }}
        />
      </Button>
      {keys.length > 0 && <span className="text-muted-foreground">{keys.length} attached</span>}
    </div>
  );
}
