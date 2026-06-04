"use client"

import { useState } from "react"
import Link from "next/link"

const SITE_PAGES = [
  { label: "Home",              path: "/" },
  { label: "Auctions",          path: "/auctions" },
  { label: "BidJS Live",        path: "/auctions/bidjs" },
  { label: "Login",             path: "/portal/login" },
  { label: "Register",          path: "/portal/register" },
  { label: "My Account",        path: "/account" },
]

type Tab = "website" | "controller" | "bidjs"

export default function WebsitePreviewPage() {
  const [activeTab, setActiveTab]       = useState<Tab>("website")
  const [currentPath, setCurrentPath]   = useState("/")

  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const iframeSrc = activeTab === "controller"
    ? `${origin}/auction-controller`
    : `${origin}${currentPath}`

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>

      {/* ── Top tab bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0 px-0 bg-[#1C1C1E] border-b border-gray-700 shrink-0">

        {/* Website tab */}
        <button
          onClick={() => setActiveTab("website")}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold tracking-wide border-b-2 transition-colors ${
            activeTab === "website"
              ? "border-[#2AB4A6] text-white bg-[#2C2C2E]"
              : "border-transparent text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          🌐 Website
        </button>

        {/* Back End Controller tab */}
        <button
          onClick={() => setActiveTab("controller")}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold tracking-wide border-b-2 transition-colors ${
            activeTab === "controller"
              ? "border-red-500 text-white bg-[#2C2C2E]"
              : "border-transparent text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          🔨 Back End Controller
          {activeTab === "controller" && (
            <span className="flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse inline-block" />
              LIVE
            </span>
          )}
        </button>

        {/* BidJS Setup tab */}
        <button
          onClick={() => setActiveTab("bidjs")}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold tracking-wide border-b-2 transition-colors ${
            activeTab === "bidjs"
              ? "border-[#2AB4A6] text-white bg-[#2C2C2E]"
              : "border-transparent text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          ⚡ BidJS Setup
        </button>

        {/* Banner manager link */}
        <Link
          href="/website/banner"
          className="flex items-center gap-1.5 px-4 py-3 text-xs font-bold tracking-wide border-b-2 border-transparent text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
        >
          🖼 Banner Manager
        </Link>

        {/* Divider */}
        <div className="w-px h-5 bg-gray-700 mx-2" />

        {/* Sub-nav — only shown in website tab */}
        {activeTab === "website" && (
          <div className="flex items-center gap-1">
            {SITE_PAGES.map(p => (
              <button
                key={p.path}
                onClick={() => setCurrentPath(p.path)}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                  currentPath === p.path
                    ? "bg-[#2AB4A6] text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* URL bar */}
        <div className="flex items-center gap-2 bg-[#2C2C2E] border border-gray-700 rounded px-3 py-1.5 mr-2 max-w-sm">
          <span className="text-gray-500 text-xs">
            {activeTab === "controller" ? "🔨" : "🌐"}
          </span>
          <span className="text-gray-300 text-xs font-mono truncate">{iframeSrc}</span>
        </div>

        {/* Open in new tab */}
        <a
          href={activeTab === "controller" ? "/auction-controller" : currentPath}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors border border-gray-700 px-3 py-1.5 rounded hover:border-gray-500 mr-3"
        >
          Open in tab
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* ── BidJS Setup panel ───────────────────────────────────────────── */}
      {activeTab === "bidjs" ? (
        <div className="flex-1 overflow-y-auto p-8 bg-[#1C1C1E]">
          <div className="max-w-3xl mx-auto space-y-6">

            <div>
              <h1 className="text-white text-xl font-bold mb-1">BidJS Integration Setup</h1>
              <p className="text-gray-400 text-sm">Reference guide for embedding BidJS on the Vectis website.</p>
            </div>

            {/* Installation */}
            <div className="bg-[#2C2C2E] rounded-lg p-5 space-y-3">
              <h2 className="text-[#2AB4A6] text-sm font-bold uppercase tracking-wide">Installation</h2>
              <p className="text-gray-300 text-sm">Follow the two-step copy-and-paste guide. Remember to replace the <span className="text-white font-semibold">Server Name</span>, <span className="text-white font-semibold">Server Region</span>, <span className="text-white font-semibold">Client ID</span>, and <span className="text-white font-semibold">Version Number</span> with the demo values first — production values are swapped in after contract sign-off (under 5 minutes).</p>
              <div className="flex flex-col gap-2">
                <a href="https://docs.bidjs.com/" target="_blank" rel="noopener noreferrer" className="text-[#2AB4A6] hover:underline text-sm">📄 Introduction — docs.bidjs.com</a>
                <a href="https://docs.bidjs.com/developer/gettingStarted/installation" target="_blank" rel="noopener noreferrer" className="text-[#2AB4A6] hover:underline text-sm">🚀 Installation guide — docs.bidjs.com/developer/gettingStarted/installation</a>
                <a href="https://docs.bidjs.com/developer/configuration/navigation" target="_blank" rel="noopener noreferrer" className="text-[#2AB4A6] hover:underline text-sm">🔗 Visual hooks / navigation config — docs.bidjs.com/developer/configuration/navigation</a>
              </div>
            </div>

            {/* Sandbox credentials */}
            <div className="bg-[#2C2C2E] rounded-lg p-5 space-y-3">
              <h2 className="text-[#2AB4A6] text-sm font-bold uppercase tracking-wide">Sandbox Admin Credentials</h2>
              <p className="text-gray-400 text-sm">Once logged in, click <span className="text-white">My Account → Admin</span> and log in again with the same details.</p>
              <a href="https://examples-hove.eu-west-2.bidjs.com/5/index.html?clientId=sandbox#!/" target="_blank" rel="noopener noreferrer" className="text-[#2AB4A6] hover:underline text-sm block">🌐 Sandbox login portal</a>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <div className="bg-[#1C1C1E] rounded p-3">
                  <p className="text-gray-500 text-xs mb-1">Username</p>
                  <p className="text-white font-mono text-sm">sandbox_admin</p>
                </div>
                <div className="bg-[#1C1C1E] rounded p-3">
                  <p className="text-gray-500 text-xs mb-1">Password</p>
                  <p className="text-white font-mono text-sm">sandboxadmin</p>
                </div>
              </div>
            </div>

            {/* Support */}
            <div className="bg-[#2C2C2E] rounded-lg p-5 space-y-3">
              <h2 className="text-[#2AB4A6] text-sm font-bold uppercase tracking-wide">Support &amp; Training</h2>
              <div className="flex flex-col gap-2">
                <a href="https://support.bidlogix.net/support/solutions" target="_blank" rel="noopener noreferrer" className="text-[#2AB4A6] hover:underline text-sm">📚 Self-help solutions — support.bidlogix.net</a>
                <a href="https://support.bidlogix.com/en/articles/5831227-bidjs-self-teach-guide" target="_blank" rel="noopener noreferrer" className="text-[#2AB4A6] hover:underline text-sm">🎓 BidJS self-teach guide</a>
              </div>
            </div>

            {/* Contact */}
            <div className="bg-[#2C2C2E] rounded-lg p-5 space-y-1">
              <h2 className="text-[#2AB4A6] text-sm font-bold uppercase tracking-wide">BidJS Contact</h2>
              <p className="text-white text-sm font-semibold">Ross Ciccone — Sales Manager</p>
              <p className="text-gray-400 text-sm">Mob: +44 (0)779 892 1937</p>
              <a href="https://bidjs.com" target="_blank" rel="noopener noreferrer" className="text-[#2AB4A6] hover:underline text-sm">bidjs.com</a>
            </div>

          </div>
        </div>
      ) : (
        /* ── iframe ─────────────────────────────────────────────────────── */
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          className="flex-1 w-full border-0 bg-white"
          title={activeTab === "controller" ? "Back End Controller" : "Website Preview"}
        />
      )}
    </div>
  )
}
