import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";


import Header from './components/Header'
import Footer from './components/Footer'


const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: 'Sid Lakkoju',
  description: 'Sid Lakkoju\'s personal profile',
}



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

