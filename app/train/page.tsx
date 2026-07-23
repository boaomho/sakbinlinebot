import type { Metadata } from "next";
import TrainStudio from "./TrainStudio";

export const metadata: Metadata = {
  title: "T-STUDIO · ห้องซ้อมเทรนปลาทู",
  robots: { index: false, follow: false },
};

export default function TrainPage() {
  return <TrainStudio />;
}
