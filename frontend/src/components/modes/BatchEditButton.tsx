import { BatchEditModal } from "./BatchEditModal";
import { modesApi } from "../../api/modes";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface BatchEditButtonProps {
  ewGroupId: string;
  selectedModeIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function BatchEditButton({
  ewGroupId,
  selectedModeIds,
  onSelectionChange,
}: BatchEditButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  async function handleBatchUpdate(fields: any) {
    setIsSubmitting(true);
    try {
      await modesApi.batchUpdate(ewGroupId, {
        mode_ids: selectedModeIds,
        ...fields,
      });
      queryClient.invalidateQueries({ queryKey: ["modes", ewGroupId] });
      onSelectionChange([]);
      setIsModalOpen(false);
    } catch (err: any) {
      alert(err.message || "Failed to perform batch update");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (selectedModeIds.length === 0) return null;

  return (
    <>
      <button
        className="button primary"
        onClick={() => setIsModalOpen(true)}
        disabled={isSubmitting}
      >
        Batch Edit ({selectedModeIds.length})
      </button>

      {isModalOpen && (
        <BatchEditModal
          ewGroupId={ewGroupId}
          selectedModeIds={selectedModeIds}
          onClose={() => setIsModalOpen(false)}
          onApply={handleBatchUpdate}
        />
      )}
    </>
  );
}
