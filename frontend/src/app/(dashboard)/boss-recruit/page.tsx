import { BossRecruitCenter } from "./boss-recruit-center";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { GrayTestBanner } from "@/components/v2/gray-test-banner";

export default function BossRecruitPage() {
  return (
    <div>
      <V2BackButton />
      <GrayTestBanner feature="BOSS 直聘获客" />
      <BossRecruitCenter />
    </div>
  );
}
