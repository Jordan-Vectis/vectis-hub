export default function AutoClerkPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Auto Clerk</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Open both panels in separate windows — ideally on separate monitors.
          Start the simulation on the Bidpath side; the Saleroom side updates automatically via BroadcastChannel.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* Bidpath panel */}
        <a
          href="/auto-clerk-bidpath.html"
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-[#0d1117] hover:bg-[#161b22] border border-[#30363d] rounded-xl p-6 transition-colors group"
        >
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🖥</span>
            <div>
              <p className="font-bold text-white text-base">Bidpath Panel</p>
              <p className="text-xs text-[#8b949e]">Monitor 1</p>
            </div>
          </div>
          <p className="text-sm text-[#8b949e] leading-relaxed">
            Simulated Bidpath clerk view. Generates fake bids, calls fair warning, and broadcasts state to the Saleroom panel.
            Playwright reads from here.
          </p>
          <p className="text-xs text-[#58a6ff] mt-4 group-hover:underline">Open in new tab →</p>
        </a>

        {/* Saleroom panel */}
        <a
          href="/auto-clerk-saleroom.html"
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-gray-100 hover:bg-gray-200 dark:bg-[#1C1C1E] dark:hover:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl p-6 transition-colors group"
        >
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">📺</span>
            <div>
              <p className="font-bold text-gray-900 dark:text-white text-base">Saleroom Panel</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Monitor 2</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            Replica of the Saleroom clerking interface. Updates lot and bid info from Bidpath automatically.
            Playwright clicks here — Fair warn, H field, Sell, Pass.
          </p>
          <p className="text-xs text-[#2AB4A6] mt-4 group-hover:underline">Open in new tab →</p>
        </a>

      </div>

      <div className="mt-6 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">How it works</p>
        <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside">
          <li>Open both panels in separate browser windows on different monitors.</li>
          <li>Click <strong className="text-gray-800 dark:text-gray-200">▶ Start</strong> on the Bidpath panel — fake bids begin streaming.</li>
          <li>The Saleroom panel receives each bid via BroadcastChannel and updates automatically.</li>
          <li>When the silence timer expires, Bidpath calls fair warning and the Saleroom panel highlights the Fair warn button.</li>
          <li>Bidpath auto-hammers after the FW delay — the Saleroom H field is pre-filled with the amount.</li>
          <li>Click <strong className="text-gray-800 dark:text-gray-200">Sell</strong> on the Saleroom to confirm (or let Playwright do it).</li>
        </ol>
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <strong>Playwright targets on Bidpath:</strong>{" "}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#state-display[data-state]</code>{" "}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#current-bid[data-current-bid]</code>{" "}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#lot-number-display[data-lot-number]</code>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            <strong>Playwright targets on Saleroom:</strong>{" "}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#bFW</code>{" "}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#fH</code>{" "}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#btn-sell</code>{" "}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">#btn-pass</code>
          </p>
        </div>
      </div>
    </div>
  )
}
