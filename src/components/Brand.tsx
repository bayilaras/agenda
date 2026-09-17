import { CalendarDays } from "lucide-react";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <CalendarDays size={23} strokeWidth={1.7} />
      </span>
      <span>
        agenda<span className="brand-dot">.</span>
        <small>ASISTEN SEKRETARIAT</small>
      </span>
    </div>
  );
}
