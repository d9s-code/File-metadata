import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { formatDateTime } from "./dates";

interface BuildInfo {
  commit: string | null;
  built_at: string | null;
}

/** Which build the server runs — the commit and when it was built — so you
 * can tell whether it has the latest images. */
export function BuildLabel() {
  const { data } = useQuery({
    queryKey: ["build-info"],
    queryFn: () => api.get<BuildInfo>("/version"),
    staleTime: Infinity,
  });
  if (!data) return null;
  return (
    <span className="build-label hint-text" title="The build this server runs (from scripts/offline/build-images.sh)">
      {data.commit ? `Build ${data.commit}` : "Development build"}
      {data.built_at ? ` · built ${formatDateTime(data.built_at)}` : ""}
    </span>
  );
}
