import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";


import Header from './components/Header'
import Footer from './components/Footer'


const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: 'My Profile',
  description: 'Personal profile webpage',
}

// export default function RootLayout({
//   children,
// }: Readonly<{
//   children: React.ReactNode;
// }>) {
//   return (
//     <html lang="en">
//       <body className={inter.className}>{children}</body>
//     </html>
//   );
// }


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-grow container mx-auto p-4">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  )
}

