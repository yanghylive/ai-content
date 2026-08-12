import { SavingsShell } from "@/components/savings/shell";
import { V2BackButton } from "@/components/v2/v2-back-button";

export default function SavingsOrdersPage() {
  return (
    <div>
      <V2BackButton label="返回省钱返利" to="/savings" />
      <SavingsShell initialTab="orders" />
    </div>
  );
}
