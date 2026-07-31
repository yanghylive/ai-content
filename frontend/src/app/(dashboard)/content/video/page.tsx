import { BusinessToolResultContext } from "../../components/business-tool-result-context";
import VideoWorkshopPage from "../../video-workshop/page";

export default function ContentVideoPage() {
  return (
    <div className="flex flex-col gap-4">
      <BusinessToolResultContext allowedTools={["aigc-asset-factory"]} />
      <VideoWorkshopPage />
    </div>
  );
}
