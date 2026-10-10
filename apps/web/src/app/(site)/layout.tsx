import { Header } from "@/components/header";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {children}
      <footer className="mt-24 border-t border-hair/60 py-8 text-center text-xs text-label-2">
        © {new Date().getFullYear()} Retfast · retfast.com
      </footer>
    </>
  );
}
