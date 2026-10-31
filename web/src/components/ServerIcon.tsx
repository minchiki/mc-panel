import { useQuery } from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Bumped after upload/delete so every <ServerIcon> refetches. */
export const iconVersionKey = (serverId: string) => ["icon-version", serverId];

export function ServerIcon({ serverId, className }: { serverId: string; className?: string }) {
  const version = useQuery({ queryKey: iconVersionKey(serverId), queryFn: () => 0, staleTime: Infinity, initialData: 0 });
  const [failedFor, setFailedFor] = useState<number | null>(null);
  const missing = failedFor === version.data;
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted", className)}>
      {missing ? (
        <Boxes className="size-1/2 text-muted-foreground" />
      ) : (
        <img
          src={`/api/servers/${serverId}/icon?v=${version.data}`}
          alt=""
          className="size-full object-cover"
          style={{ imageRendering: "pixelated" }}
          onError={() => setFailedFor(version.data)}
        />
      )}
    </span>
  );
}
