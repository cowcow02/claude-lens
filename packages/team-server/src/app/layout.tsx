import "./globals.css";

export const metadata = {
  title: "Fleetlens",
  description: "Team observability for Claude Code fleets.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
