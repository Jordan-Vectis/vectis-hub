export default function SaleroomTrainerPage() {
  return (
    <div className="h-screen w-full">
      <iframe
        src="/saleroom-trainer.html"
        className="w-full h-full border-0"
        title="Saleroom Trainer"
        // Test Mode offers a "Copy link" button for the bidder URL, which needs
        // the clipboard permission delegated into the frame.
        allow="clipboard-write"
      />
    </div>
  )
}
