import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sable", template: "%s · Sable" },
  description: "Multi-tenant operations for agencies: clients, delivery, and revenue in one organization boundary.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="steel" data-mode="dark">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('sable-theme')||'steel';var m=localStorage.getItem('sable-mode')||'dark';document.documentElement.dataset.theme=t;document.documentElement.dataset.mode=m;}catch(e){}",
          }}
        />
        <a className="skip" href="#content">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
