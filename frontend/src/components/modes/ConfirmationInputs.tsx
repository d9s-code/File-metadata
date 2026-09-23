export const DEFAULT_CONFIRMATION_QUALITY = 100;
export const DEFAULT_CONFIRMATION_QUANTITY = 2;

/** Confirmation quality (0–100 %) and quantity (1 or more), both written to
 * the PRS export. */
export function ConfirmationInputs({
  quality,
  quantity,
  onQualityChange,
  onQuantityChange,
}: {
  quality: string;
  quantity: string;
  onQualityChange: (v: string) => void;
  onQuantityChange: (v: string) => void;
}) {
  return (
    <div className="form-row param-row">
      <span className="param-row-label">Confirmation</span>
      <label>
        quality (0–100)
        <input
          type="number"
          step="1"
          min="0"
          max="100"
          value={quality}
          onChange={(e) => onQualityChange(e.target.value)}
          required
        />
      </label>
      <label>
        quantity
        <input
          type="number"
          step="1"
          min="1"
          value={quantity}
          onChange={(e) => onQuantityChange(e.target.value)}
          required
        />
      </label>
    </div>
  );
}
