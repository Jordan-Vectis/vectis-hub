"use client"

import { useState } from "react"
import ContentGeneratorTab from "./content-generator-tab"
import PasteGenerateTab from "./paste-generate-tab"
import InsightsTab from "./insights-tab"
import DraftsTab from "./drafts-tab"
import HashtagsTab from "./hashtags-tab"
import WebDescriptionsTab from "./web-descriptions-tab"
import SocialPostsTab from "./social-posts-tab"

type TabKey = "content" | "paste" | "insights" | "drafts" | "hashtags" | "webdesc" | "social"

const TABS: { key: TabKey; label: string }[] = [
  { key: "content",  label: "✍ Content Generator" },
  { key: "paste",    label: "📋 Paste & Generate" },
  { key: "insights", label: "📊 Insights" },
  { key: "drafts",   label: "💾 Saved Drafts" },
  { key: "hashtags", label: "# Hashtag Bank" },
  { key: "webdesc",  label: "🌐 Web Descriptions" },
  { key: "social",   label: "📲 Social Auto Posts" },
]

export default function BcMarketingPage() {
  const [tab, setTab] = useState<TabKey>("content")

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Tab bar */}
      <div className="flex gap-1 px-4 pt-3 border-b border-gray-800 shrink-0 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm rounded-t transition-colors whitespace-nowrap ${
              tab === t.key
                ? "bg-gray-800 text-white border-b-2 border-pink-500"
                : "text-gray-400 hover:text-white hover:bg-gray-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "content"  && <ContentGeneratorTab />}
      {tab === "paste"    && <PasteGenerateTab />}
      {tab === "insights" && <InsightsTab />}
      {tab === "drafts"   && <DraftsTab />}
      {tab === "hashtags" && <HashtagsTab />}
      {tab === "webdesc"  && <WebDescriptionsTab />}
      {tab === "social"   && <SocialPostsTab />}
    </div>
  )
}
