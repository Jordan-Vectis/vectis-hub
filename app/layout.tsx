import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { ErrorModalProvider } from "@/lib/error-modal";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vectis Hub",
  description: "Vectis Hub — Internal Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <body className="h-full bg-gray-50">
        <Script id="theme-init" strategy="beforeInteractive">{`
          (function() {
            var t = localStorage.getItem('theme');
            if (t !== 'light') document.documentElement.classList.add('dark');
          })();
        `}</Script>
        {/* Polyfills for older iPads (iOS < 17.4) — React 19 requires these */}
        <Script id="polyfills" strategy="beforeInteractive">{`
          if (!Promise.withResolvers) {
            Promise.withResolvers = function() {
              var resolve, reject;
              var p = new Promise(function(res, rej) { resolve = res; reject = rej; });
              return { promise: p, resolve: resolve, reject: reject };
            };
          }
          if (!Array.prototype.toSorted) {
            Array.prototype.toSorted = function(fn) { return [...this].sort(fn); };
          }
          if (!Array.prototype.toReversed) {
            Array.prototype.toReversed = function() { return [...this].reverse(); };
          }
          if (!Array.prototype.toSpliced) {
            Array.prototype.toSpliced = function(start, deleteCount) {
              var a = [...this]; a.splice(start, deleteCount); return a;
            };
          }
          if (!Array.prototype.with) {
            Array.prototype.with = function(i, v) { var a = [...this]; a[i] = v; return a; };
          }
          if (!Object.hasOwn) {
            Object.hasOwn = function(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };
          }
        `}</Script>
        <ErrorModalProvider>
          {children}
        </ErrorModalProvider>
      </body>
    </html>
  );
}
