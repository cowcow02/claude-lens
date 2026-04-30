import "./globals.css";
import { UpdateBanner } from "../components/update-banner";

export const metadata = {
  title: "Fleetlens",
  description: "Team observability for Claude Code fleets.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UpdateBanner />
        {children}
      </body>
    </html>
  );
}
