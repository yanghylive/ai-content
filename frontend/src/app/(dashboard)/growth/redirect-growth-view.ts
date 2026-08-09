import { redirect } from "next/navigation";

export function redirectToGrowthView(view: string) {
  redirect(`/growth?view=${view}`);
}
