import { BossRecruitCenter } from "./boss-recruit-center";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { GrayTestOverlay } from "@/components/v2/gray-test-overlay";

export default function BossRecruitPage() {
  return (
    <GrayTestOverlay feature="BOSS 直聘">
      <div>
        <V2BackButton />
        <BossRecruitCenter />
      </div>
    </GrayTestOverlay>
  );
}
