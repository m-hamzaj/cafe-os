import { inputUnits } from "@/lib/units";

/** Picks the unit an amount is typed in (ml or L, g or kg). Ingredients with
 * only one unit just show it. */
export default function UnitSelect({
  unit,
  value,
  onChange,
  label,
  className = "",
}: {
  /** The ingredient's own unit. */
  unit: string;
  value: string;
  onChange: (unit: string) => void;
  label: string;
  className?: string;
}) {
  const units = inputUnits(unit);
  if (units.length < 2) return <span className={`self-center text-sm text-muted ${className}`}>{unit}</span>;
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border border-line bg-bg px-2 py-1 text-sm text-ink ${className}`}
    >
      {units.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}
