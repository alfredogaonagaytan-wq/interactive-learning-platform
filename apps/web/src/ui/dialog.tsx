import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<ConfirmFn>(async () => window.confirm('Are you sure?'));

/** Accessible modal confirm built on <dialog> (focus trap + Escape handled by the browser). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => setReq({ ...o, resolve })), []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (req && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, [req]);
  const close = (v: boolean) => {
    req?.resolve(v);
    setReq(null);
    const d = ref.current;
    if (d?.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  };
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <dialog ref={ref} className="dialog" aria-labelledby="dlg-title" onCancel={(e) => { e.preventDefault(); close(false); }}>
        {req && (
          <form method="dialog" onSubmit={(e) => { e.preventDefault(); close(true); }}>
            <h2 id="dlg-title">{req.title}</h2>
            {req.body && <div className="dialog-body">{req.body}</div>}
            <div className="actions end">
              <button type="button" className="ghost" onClick={() => close(false)}>{req.cancelLabel ?? 'Cancel'}</button>
              <button type="submit" className={req.danger ? 'danger-btn' : 'primary'} autoFocus>{req.confirmLabel ?? 'OK'}</button>
            </div>
          </form>
        )}
      </dialog>
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
