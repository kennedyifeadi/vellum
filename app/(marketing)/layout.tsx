import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen overflow-x-hidden">
      <Navbar />
      <main className="flex-1 bg-white">
        {children}
      </main>
      <Footer />
    </div>
  );
}
