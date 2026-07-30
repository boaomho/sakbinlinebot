import type { Metadata } from "next";
import DashboardView from "./DashboardView";

export const metadata: Metadata = {
  title: "T-STUDIO · Dashboard ร้านจริง",
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return <DashboardView />;
}
