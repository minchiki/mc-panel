import { AlertTriangle } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { Input } from "./primitives";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "./overlays";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  destructive?: boolean;
  /** Require typing this exact text (e.g. server name) before confirming. */
  typeToConfirm?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Promise-based confirmation dialog for dangerous actions: `if (await confirm({...})) ...` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState("");
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setTyped("");
    setOpts(o);
    return new Promise((resolve) => (resolver.current = resolve));
  }, []);

  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  };

  const blocked = Boolean(opts?.typeToConfirm && typed !== opts.typeToConfirm);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={opts !== null} onOpenChange={(o) => !o && close(false)}>
        <AlertDialogContent>
          <div className="flex gap-4">
            {opts?.destructive && (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <AlertTriangle className="size-5" />
              </div>
            )}
            <div className="space-y-2">
              <AlertDialogTitle className="text-lg font-semibold">{opts?.title}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="text-sm text-muted-foreground">{opts?.description}</div>
              </AlertDialogDescription>
            </div>
          </div>
          {opts?.typeToConfirm && (
            <div className="space-y-1.5">
              <p className="text-sm">
                Введите <span className="font-mono font-semibold">{opts.typeToConfirm}</span> для подтверждения
              </p>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel asChild>
              <Button variant="outline">Отмена</Button>
            </AlertDialogCancel>
            <Button variant={opts?.destructive ? "destructive" : "default"} disabled={blocked} onClick={() => close(true)}>
              {opts?.confirmText ?? "Подтвердить"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm outside ConfirmProvider");
  return ctx;
}
